/**
 * Sandbox Code Executor with MCP Proxy
 *
 * Executes TypeScript/Python code in Deno sandbox with injected callMCPTool() function.
 * Uses HTTP server for sandbox-to-parent communication.
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { homedir } from 'os';
import { getDenoPath } from './config.js';
import { sanitizeOutput, truncateOutput, formatDuration, normalizeError } from './utils.js';
import { MCPProxyServer } from './mcp-proxy-server.js';
import { StreamingProxy } from './streaming-proxy.js';
import type { ExecutionResult, SandboxOptions } from './types.js';
import type { MCPClientPool } from './mcp-client-pool.js';

const WRAPPERS_DIR = path.join(homedir(), '.code-executor', 'wrappers');

/**
 * Load wrapper code for allowed MCP tools
 */
async function loadWrappers(allowedTools: string[]): Promise<string> {
  console.log('[DEBUG] loadWrappers called with:', allowedTools);

  try {
    // Check if wrappers directory exists
    await fs.access(WRAPPERS_DIR);
    console.log('[DEBUG] Wrappers directory exists:', WRAPPERS_DIR);
  } catch {
    // No wrappers generated yet
    console.log('[DEBUG] Wrappers directory not found');
    return '';
  }

  const wrapperCode: string[] = [];

  // Extract server names from allowed tools (mcp__<server>__<tool>)
  const servers = new Set<string>();
  for (const tool of allowedTools) {
    const match = tool.match(/^mcp__([^_]+)__/);
    if (match && match[1]) {
      servers.add(match[1]);
    }
  }
  console.log('[DEBUG] Extracted servers:', Array.from(servers));

  // Load wrapper files for each server
  for (const server of servers) {
    const wrapperFile = path.join(WRAPPERS_DIR, `${server}.ts`);

    try {
      const content = await fs.readFile(wrapperFile, 'utf-8');

      // Extract only the function implementations (strip comments and exports)
      let functionCode = content
        .replace(/\/\*\*[\s\S]*?\*\//g, '') // Remove JSDoc comments
        .replace(/^export\s+/gm, '') // Remove export keywords
        .replace(/^declare\s+global[\s\S]*?^}/gm, '') // Remove global declarations
        .trim();

      // Remove export default block at the end
      functionCode = functionCode.replace(/\/\/ Export all wrappers[\s\S]*$/g, '');

      // Convert function declarations to globalThis assignments
      functionCode = functionCode.replace(
        /^(async )?function (\w+)/gm,
        'globalThis.$2 = $1function'
      );

      if (functionCode) {
        wrapperCode.push(`// Wrappers for ${server}`);
        wrapperCode.push(functionCode);
        console.log(`[DEBUG] Loaded wrapper for ${server}, length:`, functionCode.length);
      }
    } catch (error) {
      // Wrapper file doesn't exist for this server - skip silently
      console.log(`[DEBUG] Failed to load wrapper for ${server}:`, error);
      continue;
    }
  }

  const result = wrapperCode.length > 0 ? '\n' + wrapperCode.join('\n\n') + '\n' : '';
  console.log('[DEBUG] Total wrapper code length:', result.length);
  return result;
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

    // Load MCP tool wrappers for allowed tools
    const wrappers = await loadWrappers(options.allowedTools || []);

    // DEBUG: Write wrappers to file for inspection
    await fs.writeFile('/tmp/debug-wrappers.txt',
      `Wrappers length: ${wrappers.length}\nAllowedTools: ${JSON.stringify(options.allowedTools)}\n\n${wrappers}`,
      'utf-8'
    );

    // Create wrapper code that injects callMCPTool() + state functions + MCP wrappers and imports user code
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

// T067-T073: Injected discovery functions for in-sandbox MCP tool discovery (FR-1, FR-2, FR-3)
// WHY: Enable AI agents to discover available tools without top-level schema bloat
// Constitutional Principle 1 (Progressive Disclosure): Functions injected into sandbox,
// not exposed as top-level MCP tools to preserve ~1.6k token budget

// Type definition for tool schema (inline - no imports available in sandbox)
interface ToolSchema {
  name: string;
  description: string;
  parameters: unknown;
}

/**
 * Discover available MCP tools from all connected servers.
 *
 * @param options - Optional discovery options
 * @param options.search - Array of keywords to filter tools (OR logic, case-insensitive)
 * @returns Array of tool schemas matching search criteria (all tools if no search provided)
 * @throws Error if authentication fails (401) or request times out (500ms)
 *
 * @example
 * // Discover all tools
 * const allTools = await discoverMCPTools();
 *
 * // Search for specific tools
 * const fileTools = await discoverMCPTools({ search: ['file', 'read'] });
 */
globalThis.discoverMCPTools = async (options?: { search?: string[] }): Promise<ToolSchema[]> => {
  // T068: Build URL with localhost proxy port
  let url = 'http://localhost:${proxyPort}/mcp/tools';

  // T071: Parse options.search array and append as ?q query parameters
  if (options?.search && options.search.length > 0) {
    const searchParams = options.search.map(keyword => \`q=\${encodeURIComponent(keyword)}\`).join('&');
    url += \`?\${searchParams}\`;
  }

  try {
    // T070: Add 500ms timeout using AbortSignal.timeout(500)
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        // T069: Add Authorization header with Bearer token
        'Authorization': 'Bearer ${authToken}'
      },
      // PERFORMANCE (Constitutional Principle 8): 500ms timeout prevents hanging
      // Meets NFR-2 requirement (<100ms P95 latency for normal case, 500ms max)
      signal: AbortSignal.timeout(500)
    });

    // T073: Throw descriptive error if response not ok
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('MCP tool discovery failed: Authentication required (401 Unauthorized)');
      }
      if (response.status === 429) {
        throw new Error('MCP tool discovery failed: Rate limit exceeded (429 Too Many Requests)');
      }
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(\`MCP tool discovery failed (\${response.status}): \${errorData.error || response.statusText}\`);
    }

    // T072: Parse JSON response and return ToolSchema[] array
    const tools = await response.json();
    return tools;
  } catch (error: unknown) {
    // FIX: Proper error handling pattern (catch with unknown type)
    // Normalize error to Error instance before accessing properties
    const normalizedError = error instanceof Error ? error : new Error(String(error));

    // Handle timeout errors with clear message
    if (normalizedError.name === 'AbortError' || normalizedError.name === 'TimeoutError') {
      throw new Error('MCP tool discovery timed out after 500ms');
    }

    // Re-throw normalized error
    throw normalizedError;
  }
};

/**
 * Get detailed schema for a specific MCP tool by name.
 *
 * @param toolName - The name of the tool to inspect
 * @returns Tool schema if found, null if tool doesn't exist
 * @throws Error if discovery fails (authentication, timeout, etc.)
 *
 * @example
 * const schema = await getToolSchema('mcp__filesystem__read_file');
 * if (schema) {
 *   console.log('Tool description:', schema.description);
 *   console.log('Tool parameters:', schema.parameters);
 * }
 */
globalThis.getToolSchema = async (toolName: string): Promise<ToolSchema | null> => {
  // T085-T087: Leverage discoverMCPTools (DRY principle)
  const allTools = await globalThis.discoverMCPTools();
  // FIX: Use proper type (ToolSchema) instead of any
  const tool = allTools.find((t: ToolSchema) => t.name === toolName);
  return tool || null;
};

/**
 * Search for MCP tools using keyword query.
 *
 * @param query - Search query string (will be split by whitespace into keywords)
 * @param limit - Maximum number of results to return (default: 10)
 * @returns Array of tool schemas matching query, limited to specified count
 * @throws Error if discovery fails (authentication, timeout, etc.)
 *
 * @example
 * // Search for file-related tools, get top 5
 * const fileTools = await searchTools('file read write', 5);
 *
 * // Search with default limit (10)
 * const networkTools = await searchTools('network http fetch');
 */
globalThis.searchTools = async (query: string, limit: number = 10): Promise<ToolSchema[]> => {
  // T099-T102: Split query into keywords and leverage discoverMCPTools (DRY principle)
  const keywords = query.split(/\\s+/).filter(k => k.length > 0);
  const tools = await globalThis.discoverMCPTools({ search: keywords });
  // T101: Apply result limit
  return tools.slice(0, limit);
};

${wrappers}
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
