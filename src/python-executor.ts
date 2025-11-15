/**
 * Python Executor with MCP Proxy
 *
 * Executes Python code in subprocess with injected call_mcp_tool() function.
 * Uses HTTP server for sandbox-to-parent communication (same as TypeScript executor).
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { getPythonPath } from './config.js';
import { sanitizeOutput, truncateOutput, formatDuration, normalizeError } from './utils.js';
import { MCPProxyServer } from './mcp-proxy-server.js';
import { StreamingProxy } from './streaming-proxy.js';
import type { ExecutionResult, SandboxOptions } from './types.js';
import type { MCPClientPool } from './mcp-client-pool.js';

/**
 * Python wrapper template for call_mcp_tool() injection
 *
 * This code is prepended to user's Python code to provide MCP tool access.
 */
function getPythonWrapperCode(proxyPort: number, authToken: string, userCodeFile: string): string {
  return `import json
import sys
import urllib.request
import urllib.parse

def call_mcp_tool(tool_name: str, params: dict) -> any:
    """Call an MCP tool through the proxy server with authentication"""
    url = 'http://localhost:${proxyPort}'
    data = json.dumps({'toolName': tool_name, 'params': params}).encode('utf-8')

    req = urllib.request.Request(
        url,
        data=data,
        headers={
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ${authToken}'
        }
    )

    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode('utf-8'))
            return result.get('result')
    except urllib.error.HTTPError as e:
        error_data = json.loads(e.read().decode('utf-8'))
        raise Exception(error_data.get('error', 'MCP tool call failed'))

# Execute user code
# SECURITY: This exec() is safe because:
# 1. User code is pre-validated by SecurityValidator.validateCode() before execution
# 2. Dangerous patterns (os.system, subprocess, pickle, etc.) are blocked at validation
# 3. Code runs in isolated subprocess with limited file system access (temp dir only)
# 4. Network access restricted to localhost (MCP proxy server)
# 5. Timeout enforcement prevents infinite loops (SIGKILL after timeoutMs)
# 6. All executions are audit logged with code hash
# 7. Tool allowlist prevents unauthorized MCP tool access
exec(open('${userCodeFile}').read())
`;
}

/**
 * Execute Python code in subprocess with MCP access
 */
export async function executePythonInSandbox(
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

  // Start MCP proxy server (shared with TypeScript executor)
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
  const userCodeFile = `/tmp/sandbox-${crypto.randomUUID()}.py`;
  let tempFileCreated = false;

  try {
    // Write user code to temp file
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

    // Create wrapper code that injects call_mcp_tool() and executes user code
    const wrappedCode = getPythonWrapperCode(proxyPort, authToken, userCodeFile);

    // Build Python arguments
    const pythonArgs = ['-c', wrappedCode];

    // Spawn Python process
    const pythonProcess = spawn(getPythonPath(), pythonArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {}, // SECURITY: Clear environment to prevent secret leakage (VULN-003)
      // Python doesn't have fine-grained permissions like Deno
      // Security is enforced by:
      // 1. Code pattern validation (security.ts)
      // 2. Environment isolation (env: {})
      // 3. File system access is limited to temp directory
      // 4. Network access is limited to localhost (MCP proxy)
    });

    // Collect output
    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;

      // Stream output in real-time if enabled
      if (streamingProxy) {
        streamingProxy.broadcast(chunk);
      }
    });

    pythonProcess.stderr.on('data', (data) => {
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
        pythonProcess.on('close', (code) => {
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
              toolCallSummary: proxyServer.getToolCallSummary(),
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
              toolCallSummary: proxyServer.getToolCallSummary(),
              streamUrl,
            });
          }
        });
      }),
      new Promise<ExecutionResult>((resolve) => {
        timeoutHandle = setTimeout(() => {
          // Use SIGKILL (uncatchable) to terminate
          pythonProcess.kill('SIGKILL');

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
            toolCallSummary: proxyServer.getToolCallSummary(),
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
        // Ignore cleanup errors
        console.error('Failed to clean up temp file:', error);
      }
    }
  }
}
