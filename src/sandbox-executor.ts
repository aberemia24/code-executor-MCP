/**
 * Sandbox Code Executor with MCP Proxy
 *
 * Executes TypeScript/Python code in Deno sandbox with injected callMCPTool() function.
 * Uses HTTP server for sandbox-to-parent communication.
 */

import { spawn } from 'child_process';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { getDenoPath } from './config.js';
import { sanitizeOutput, truncateOutput, formatDuration, normalizeError } from './utils.js';
import { AllowlistValidator, ToolCallTracker } from './proxy-helpers.js';
import { StreamingProxy } from './streaming-proxy.js';
import { ErrorType } from './types.js';
import type { ExecutionResult, SandboxOptions } from './types.js';
import type { MCPClientPool } from './mcp-client-pool.js';

/**
 * MCP proxy server that handles callMCPTool requests from sandbox
 *
 * Architecture:
 * - Deno sandbox → HTTP POST → MCPProxyServer → MCPClientPool → MCP tools
 * - Provides callMCPTool() function injected into sandbox global scope
 * - Validates tool access against allowlist before proxying
 * - Tracks all tool calls for audit logging
 *
 * Refactored to follow SRP:
 * - AllowlistValidator: Tool allowlist validation
 * - ToolCallTracker: Tool call tracking
 * - MCPProxyServer: HTTP routing only
 *
 * @example
 * const proxy = new MCPProxyServer(clientPool, ['mcp__zen__codereview']);
 * const port = await proxy.start();
 * // Sandbox can now call: callMCPTool('mcp__zen__codereview', {...})
 * await proxy.stop();
 */
class MCPProxyServer {
  private server: http.Server | null = null;
  private port = 0;
  private validator: AllowlistValidator;
  private tracker: ToolCallTracker;

  /**
   * Create MCP proxy server
   *
   * @param mcpClientPool - Pool of MCP clients to proxy requests to
   * @param allowedTools - Whitelist of allowed MCP tool names
   */
  constructor(
    private mcpClientPool: MCPClientPool,
    allowedTools: string[]
  ) {
    this.validator = new AllowlistValidator(allowedTools);
    this.tracker = new ToolCallTracker();
  }

  /**
   * Start proxy server on random port
   */
  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // Only accept POST requests
        if (req.method !== 'POST') {
          res.writeHead(405);
          res.end();
          return;
        }

        try {
          // Read request body
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(chunk as Buffer);
          }
          const body = Buffer.concat(chunks).toString();
          const { toolName, params } = JSON.parse(body) as {
            toolName: string;
            params: unknown;
          };

          // Validate against allowlist
          if (!this.validator.isAllowed(toolName)) {
            res.writeHead(403);
            res.end(JSON.stringify({
              error: `Tool '${toolName}' not in allowlist`,
              suggestion: `Add '${toolName}' to allowedTools array`
            }));
            return;
          }

          // Track tool call
          this.tracker.track(toolName);

          // Call MCP tool through pool
          const result = await this.mcpClientPool.callTool(toolName, params);

          // Return result
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result }));
        } catch (error) {
          res.writeHead(500);
          res.end(JSON.stringify({
            error: normalizeError(error, 'MCP tool call failed').message
          }));
        }
      });

      this.server.listen(0, 'localhost', () => {
        const address = this.server!.address();
        if (address && typeof address !== 'string') {
          this.port = address.port;
          resolve(this.port);
        } else {
          reject(new Error('Failed to get server port'));
        }
      });
    });
  }

  /**
   * Stop proxy server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  getPort(): number {
    return this.port;
  }

  getToolCalls(): string[] {
    return this.tracker.getCalls();
  }
}

/**
 * Execute TypeScript code in Deno sandbox with MCP access
 */
export async function executeTypescriptInSandbox(
  options: SandboxOptions,
  mcpClientPool: MCPClientPool
): Promise<ExecutionResult> {
  const startTime = Date.now();

  // Start streaming proxy if enabled
  let streamingProxy: StreamingProxy | null = null;
  let streamUrl: string | undefined;

  if (options.streaming) {
    streamingProxy = new StreamingProxy();
    try {
      await streamingProxy.start();
      streamUrl = streamingProxy.getUrl();
    } catch (error) {
      console.error('Failed to start streaming proxy:', error);
      // Continue without streaming (non-critical failure)
    }
  }

  // Start MCP proxy server (will track tool calls)
  const proxyServer = new MCPProxyServer(mcpClientPool, options.allowedTools);
  let proxyPort: number;

  try {
    proxyPort = await proxyServer.start();
  } catch (error) {
    if (streamingProxy) {
      await streamingProxy.stop();
    }
    return {
      success: false,
      output: '',
      error: normalizeError(error, 'Failed to start MCP proxy server').message,
      executionTimeMs: Date.now() - startTime,
      streamUrl,
    };
  }

  // Temp file for user code (will be cleaned up in finally)
  // Use crypto.randomUUID() for guaranteed uniqueness (no race condition)
  const userCodeFile = `/tmp/sandbox-${crypto.randomUUID()}.ts`;
  let tempFileCreated = false;

  try {
    // Write user code to temp file (avoids eval() security violation)
    await fs.writeFile(userCodeFile, options.code, 'utf-8');
    tempFileCreated = true;

    // Create wrapper code that injects callMCPTool() and imports user code
    const wrappedCode = `
// Injected callMCPTool function
globalThis.callMCPTool = async (toolName: string, params: unknown) => {
  const response = await fetch('http://localhost:${proxyPort}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolName, params })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'MCP tool call failed');
  }

  const result = await response.json();
  return result.result;
};

// Import and execute user code from temp file
await import('file://${userCodeFile}');
`;

    // Build Deno arguments
    const denoArgs = ['run'];

    // Add permissions
    // Always allow TMPDIR env var (required for temp file resolution)
    denoArgs.push('--allow-env=TMPDIR');

    // Always allow /tmp for temp file storage
    const readPaths = [...new Set([...(options.permissions.read ?? []), '/tmp'])];
    for (const readPath of readPaths) {
      denoArgs.push(`--allow-read=${readPath}`);
    }

    // Always allow /tmp for temp file storage
    const writePaths = [...new Set([...(options.permissions.write ?? []), '/tmp'])];
    for (const writePath of writePaths) {
      denoArgs.push(`--allow-write=${writePath}`);
    }

    if (options.permissions.net && options.permissions.net.length > 0) {
      // Always allow localhost for MCP proxy
      const netHosts = [...new Set([...options.permissions.net, 'localhost'])];
      // Deno requires comma-separated hosts in single --allow-net flag
      denoArgs.push(`--allow-net=${netHosts.join(',')}`);
    } else {
      // If no net permissions specified, only allow localhost for MCP proxy
      denoArgs.push('--allow-net=localhost');
    }

    // Add code as stdin
    denoArgs.push('-');

    // Spawn Deno process
    const denoProcess = spawn(getDenoPath(), denoArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Write code to stdin
    denoProcess.stdin.write(wrappedCode);
    denoProcess.stdin.end();

    // Collect output
    let stdout = '';
    let stderr = '';

    denoProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;

      // Stream output in real-time if enabled
      if (streamingProxy) {
        streamingProxy.broadcast(chunk);
      }
    });

    denoProcess.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;

      // Stream errors in real-time if enabled
      if (streamingProxy) {
        streamingProxy.broadcast(`[stderr] ${chunk}`);
      }
    });

    // Wait for process with timeout
    let timeoutHandle: NodeJS.Timeout | null = null;

    const result = await Promise.race([
      new Promise<ExecutionResult>((resolve) => {
        denoProcess.on('close', (code) => {
          // Clear timeout when process exits normally
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }

          const executionTimeMs = Date.now() - startTime;

          if (code === 0) {
            // Broadcast completion to streaming clients
            if (streamingProxy) {
              streamingProxy.broadcastComplete(true);
            }

            resolve({
              success: true,
              output: truncateOutput(sanitizeOutput(stdout)),
              executionTimeMs,
              toolCallsMade: proxyServer.getToolCalls(),
              streamUrl,
            });
          } else {
            // Broadcast failure to streaming clients
            if (streamingProxy) {
              streamingProxy.broadcastComplete(false);
            }

            resolve({
              success: false,
              output: sanitizeOutput(stdout),
              error: sanitizeOutput(stderr) || `Process exited with code ${code}`,
              executionTimeMs,
              toolCallsMade: proxyServer.getToolCalls(),
              streamUrl,
            });
          }
        });
      }),
      new Promise<ExecutionResult>((resolve) => {
        timeoutHandle = setTimeout(() => {
          // Use SIGKILL (uncatchable) instead of SIGTERM
          denoProcess.kill('SIGKILL');

          // Broadcast timeout to streaming clients
          if (streamingProxy) {
            streamingProxy.broadcastComplete(false);
          }

          resolve({
            success: false,
            output: sanitizeOutput(stdout),
            error: `Execution timeout after ${formatDuration(options.timeoutMs)}`,
            executionTimeMs: Date.now() - startTime,
            toolCallsMade: proxyServer.getToolCalls(),
            streamUrl,
          });
        }, options.timeoutMs);
      }),
    ]);

    return result;
  } finally {
    // Stop streaming proxy
    if (streamingProxy) {
      await streamingProxy.stop();
    }

    // Stop MCP proxy server
    await proxyServer.stop();

    // Clean up temp file
    if (tempFileCreated) {
      try {
        await fs.unlink(userCodeFile);
      } catch (error) {
        // Ignore cleanup errors (file may not exist or already deleted)
        console.error('Failed to clean up temp file:', error);
      }
    }
  }
}

// Python execution removed (YAGNI) - can be added later if needed with Pyodide
