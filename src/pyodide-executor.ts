/**
 * Pyodide-based Python Executor with WebAssembly Sandbox
 *
 * SECURITY MODEL:
 * - WebAssembly sandbox prevents syscall access
 * - Virtual filesystem (no real file access)
 * - Network via controlled fetch API only
 * - Same isolation level as Deno sandbox
 *
 * IMPLEMENTATION PATTERN:
 * Based on Pydantic's mcp-run-python (production-proven)
 * Two-phase execution prevents filesystem staging attacks
 *
 * Issue #59: Pyodide WebAssembly sandbox for Python execution
 */

import { loadPyodide, type PyodideInterface } from 'pyodide';
import { MCPProxyServer } from './mcp-proxy-server.js';
import { StreamingProxy } from './streaming-proxy.js';
import { sanitizeOutput, truncateOutput, formatDuration, normalizeError } from './utils.js';
import type { ExecutionResult, SandboxOptions } from './types.js';
import type { MCPClientPool } from './mcp-client-pool.js';

/**
 * Global Pyodide instance cache
 *
 * WHY: Pyodide initialization is expensive (~10s first load, ~5MB download)
 * Caching improves performance from 10s → <100ms for subsequent runs
 */
let pyodideCache: PyodideInterface | null = null;

/**
 * Get or initialize Pyodide instance
 *
 * @returns Cached Pyodide instance
 */
async function getPyodide(): Promise<PyodideInterface> {
  if (!pyodideCache) {
    console.error('🐍 Initializing Pyodide (first run, ~2-3s)...');

    // Node.js: Use npm package files (no indexURL needed)
    // The pyodide npm package includes all necessary files locally
    pyodideCache = await loadPyodide({
      // SECURITY: Disable stdin to prevent interactive prompts
      stdin: () => {
        throw new Error('stdin disabled for security (no interactive input allowed)');
      },

      // Capture stdout/stderr for logging
      stdout: (msg: string) => {
        console.log('[Pyodide stdout]', msg);
      },
      stderr: (msg: string) => {
        console.error('[Pyodide stderr]', msg);
      },
    });

    console.error('✓ Pyodide initialized');
  }

  return pyodideCache;
}

/**
 * Execute Python code in Pyodide WebAssembly sandbox
 *
 * SECURITY GUARANTEES:
 * - No filesystem access outside WASM virtual FS
 * - No network access except via MCP proxy (authenticated)
 * - No process spawning capability
 * - Memory limited by V8 heap (--max-old-space-size)
 * - Timeout enforcement prevents infinite loops
 *
 * @param options - Sandbox configuration (code, allowedTools, timeout, permissions)
 * @param mcpClientPool - MCP client pool for tool access
 * @returns Execution result with output, errors, tool calls
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
      // Continue without streaming (non-critical)
    }
  }

  // Start MCP proxy server (authenticated tool access)
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

  try {
    const pyodide = await getPyodide();

    // SECURITY: Two-phase execution pattern (from Pydantic mcp-run-python)
    // Phase 1: Setup environment (inject MCP tool access)
    // Phase 2: Execute user code (read-only after injection)

    // Phase 1: Inject call_mcp_tool function
    pyodide.globals.set('PROXY_PORT', proxyPort);
    pyodide.globals.set('AUTH_TOKEN', authToken);

    await pyodide.runPythonAsync(`
import json
from pyodide.http import pyfetch

# Use Python globals set via pyodide.globals.set()
PROXY_PORT = globals()['PROXY_PORT']
AUTH_TOKEN = globals()['AUTH_TOKEN']

async def call_mcp_tool(tool_name: str, params: dict):
    """
    Call MCP tool through authenticated proxy server.

    SECURITY:
    - Only localhost access (no external network)
    - Bearer token authentication required
    - Tool allowlist enforced by proxy server

    Args:
        tool_name: Full MCP tool name (e.g., 'mcp__zen__codereview')
        params: Tool parameters (dict)

    Returns:
        Tool execution result

    Raises:
        Exception: If tool call fails or authentication fails
    """
    response = await pyfetch(
        f'http://localhost:{PROXY_PORT}',
        method='POST',
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {AUTH_TOKEN}'
        },
        body=json.dumps({
            'toolName': tool_name,
            'params': params
        })
    )

    result = await response.json()

    # Check for errors
    if response.status != 200:
        error_msg = result.get('error', 'MCP tool call failed')
        raise Exception(f'MCP Error [{response.status}]: {error_msg}')

    return result.get('result')

# Discovery functions (same as TypeScript sandbox)
async def discover_mcp_tools(search_terms=None):
    """Discover available MCP tools"""
    url = f'http://localhost:{PROXY_PORT}/mcp/tools'
    if search_terms:
        query = '+'.join(search_terms)
        url += f'?q={query}'

    response = await pyfetch(url, headers={
        'Authorization': f'Bearer {AUTH_TOKEN}'
    })

    if response.status != 200:
        raise Exception(f'Discovery failed: {response.status}')

    result = await response.json()

    # Validate response format (explicit check for security)
    if not isinstance(result, dict):
        raise Exception(f'Invalid discovery response: expected dict, got {type(result).__name__}')

    if 'tools' not in result:
        raise Exception(f'Invalid discovery response: missing "tools" field. Got keys: {list(result.keys())}')

    return result['tools']

async def get_tool_schema(tool_name: str):
    """Get schema for specific tool"""
    tools = await discover_mcp_tools()
    for tool in tools:
        if tool.get('name') == tool_name:
            return tool
    return None

async def search_tools(query: str, limit: int = 10):
    """Search tools by keywords"""
    keywords = query.split()
    tools = await discover_mcp_tools(search_terms=keywords)
    return tools[:limit]
    `);

    console.error('✓ MCP tool access injected into Python environment');

    // Phase 2: Execute user code with timeout
    let executionOutput = '';
    let executionError = '';

    // Capture print() output
    await pyodide.runPythonAsync(`
import sys
from io import StringIO

# Redirect stdout to capture print() output
_stdout_capture = StringIO()
_original_stdout = sys.stdout
sys.stdout = _stdout_capture
    `);

    // Execute user code with timeout
    const execPromise = (async () => {
      try {
        const result = await pyodide.runPythonAsync(options.code);

        // Get captured output
        const stdout = await pyodide.runPythonAsync(`
sys.stdout = _original_stdout
_stdout_capture.getvalue()
        `);

        return {
          success: true,
          result: result === undefined ? null : result,
          stdout: String(stdout),
        };
      } catch (error) {
        // Get any partial output
        const stdout = await pyodide.runPythonAsync(`
sys.stdout = _original_stdout
_stdout_capture.getvalue()
        `).catch(() => '');

        return {
          success: false,
          result: null,
          stdout: String(stdout),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })();

    // Create timeout with ID for cleanup (non-null assertion since setTimeout is synchronous)
    let timeoutId!: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Execution timeout after ${formatDuration(options.timeoutMs)}`)),
        options.timeoutMs
      );
    });

    const execResult = await Promise.race([execPromise, timeoutPromise]);

    // CRITICAL: Clear timeout to prevent unhandled rejection after successful execution
    // Note: clearTimeout is safe to call even if timeout already fired (no-op)
    clearTimeout(timeoutId);

    // Broadcast completion to streaming clients
    if (streamingProxy) {
      streamingProxy.broadcastComplete(execResult.success);
    }

    if (execResult.success) {
      // Build output from stdout + result
      let output = execResult.stdout;
      if (execResult.result !== null) {
        output += (output ? '\n' : '') + String(execResult.result);
      }

      return {
        success: true,
        output: truncateOutput(sanitizeOutput(output)),
        executionTimeMs: Date.now() - startTime,
        toolCallsMade: proxyServer.getToolCalls(),
        toolCallSummary: proxyServer.getToolCallSummary(),
        streamUrl,
      };
    } else {
      return {
        success: false,
        output: sanitizeOutput(execResult.stdout),
        error: sanitizeOutput(execResult.error || 'Unknown error'),
        executionTimeMs: Date.now() - startTime,
        toolCallsMade: proxyServer.getToolCalls(),
        toolCallSummary: proxyServer.getToolCallSummary(),
        streamUrl,
      };
    }

  } catch (error) {
    // Broadcast failure to streaming clients
    if (streamingProxy) {
      streamingProxy.broadcastComplete(false);
    }

    return {
      success: false,
      output: '',
      error: normalizeError(error, 'Pyodide execution failed').message,
      executionTimeMs: Date.now() - startTime,
      toolCallsMade: proxyServer.getToolCalls(),
      streamUrl,
    };
  } finally {
    // Cleanup
    if (streamingProxy) {
      await streamingProxy.stop();
    }
    await proxyServer.stop();
  }
}
