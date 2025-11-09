/**
 * Sandbox Code Executor with MCP Proxy
 *
 * Executes TypeScript/Python code in Deno sandbox with injected callMCPTool() function.
 * Uses HTTP server for sandbox-to-parent communication.
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { getDenoPath } from './config.js';
import { sanitizeOutput, truncateOutput, formatDuration, normalizeError } from './utils.js';
import { MCPProxyServer } from './mcp-proxy-server.js';
import { StreamingProxy } from './streaming-proxy.js';
import type { ExecutionResult, SandboxOptions } from './types.js';
import type { MCPClientPool } from './mcp-client-pool.js';

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
  let authToken: string;

  try {
    const proxyInfo = await proxyServer.start();
    proxyPort = proxyInfo.port;
    authToken = proxyInfo.authToken;
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

    // SECURITY: Verify temp file integrity (defense-in-depth)
    // Ensures file wasn't modified between write and execution
    const writtenContent = await fs.readFile(userCodeFile, 'utf-8');
    const originalHash = crypto.createHash('sha256').update(options.code).digest('hex');
    const writtenHash = crypto.createHash('sha256').update(writtenContent).digest('hex');

    if (originalHash !== writtenHash) {
      throw new Error(
        'Temp file integrity check failed - file may have been tampered with. ' +
        'This is a critical security violation.'
      );
    }

    // Create wrapper code that injects callMCPTool() and imports user code
    const wrappedCode = `
// Injected callMCPTool function with authentication
globalThis.callMCPTool = async (toolName: string, params: unknown) => {
  const response = await fetch('http://localhost:${proxyPort}', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ${authToken}'
    },
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

    // SECURITY: Environment variable access blocked by default (no --allow-env)
    // Deno denies access to environment variables unless explicitly granted
    // This prevents leakage of secrets (AWS_ACCESS_KEY_ID, DATABASE_URL, etc.)

    // SECURITY: Add V8 memory limit to prevent memory exhaustion attacks
    // Limits heap to 128MB - prevents allocation bombs
    denoArgs.push('--v8-flags=--max-old-space-size=128');

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
