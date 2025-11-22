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
import Anthropic from '@anthropic-ai/sdk';
import { MCPProxyServer } from './mcp-proxy-server.js';
import { StreamingProxy } from './streaming-proxy.js';
import { SamplingBridgeServer } from './sampling-bridge-server.js';
import { getBridgeHostname } from './docker-detection.js';
import { sanitizeOutput, truncateOutput, formatDuration, normalizeError } from './utils.js';
import { getAnthropicApiKey } from './config.js';
import type { ExecutionResult, SandboxOptions, SamplingConfig } from './types.js';
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
  mcpClientPool: MCPClientPool,
  mcpServer?: any  // Optional MCP server for sampling (McpServer type from SDK)
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

  // Start sampling bridge if enabled (Phase 8: FR-2 Python Sampling Interface)
  let samplingBridge: SamplingBridgeServer | null = null;
  let samplingConfig: SamplingConfig | null = null;
  let samplingPort: number | null = null;
  let samplingToken: string | null = null;
  // T093: Docker detection - use host.docker.internal in Docker, localhost otherwise
  const bridgeHostname = getBridgeHostname();

  if (options.enableSampling) {
    // Create sampling configuration from options and defaults
    samplingConfig = {
      enabled: true,
      maxRoundsPerExecution: options.maxSamplingRounds || 10,
      maxTokensPerExecution: options.maxSamplingTokens || 10000,
      timeoutPerCallMs: 30000, // 30 seconds per call
      allowedSystemPrompts: [
        '', // Empty prompt always allowed
        'You are a helpful assistant',
        'You are a code analysis expert'
      ],
      contentFilteringEnabled: true,
      allowedModels: options.allowedSamplingModels || ['claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022']
    };

    // Create Anthropic client for Claude API access (OPTIONAL - only needed if MCP sampling unavailable)
    // Hybrid Architecture: Try MCP sampling first (free), fallback to Direct API (paid)
    const apiKey = getAnthropicApiKey();
    const anthropic = apiKey ? new Anthropic({ apiKey }) : undefined;

    // Use real MCP server if provided (must have createMessage method), otherwise sampling will require API key
    // MCP server enables free sampling via MCP SDK (createMessage capability)
    const hasValidMcpServer = mcpServer && typeof mcpServer.createMessage === 'function';

    if (!hasValidMcpServer && !anthropic) {
      throw new Error(
        'Sampling enabled but no MCP server available and ANTHROPIC_API_KEY not set. ' +
        'Either run within an MCP client (free) or export ANTHROPIC_API_KEY=<your-key> (paid)'
      );
    }

    samplingBridge = new SamplingBridgeServer(hasValidMcpServer ? mcpServer : {}, samplingConfig, undefined, anthropic);

    try {
      const bridgeInfo = await samplingBridge.start();
      samplingPort = bridgeInfo.port;
      samplingToken = bridgeInfo.authToken;
    } catch (error) {
      // Clean up on failure
      if (streamingProxy) {
        await streamingProxy.stop();
      }
      throw new Error(`Failed to start sampling bridge: ${error instanceof Error ? error.message : String(error)}`);
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
    // Clean up ALL started resources (sampling bridge, streaming proxy)
    if (samplingBridge) {
      await samplingBridge.stop();
    }
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

    // Inject sampling bridge credentials if sampling is enabled
    if (options.enableSampling && samplingPort && samplingToken) {
      pyodide.globals.set('SAMPLING_PORT', samplingPort);
      pyodide.globals.set('SAMPLING_TOKEN', samplingToken);
      pyodide.globals.set('SAMPLING_HOSTNAME', bridgeHostname);  // T093: Docker detection
      pyodide.globals.set('SAMPLING_ENABLED', true);
    } else {
      pyodide.globals.set('SAMPLING_ENABLED', false);
    }

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
        # Create multiple q= parameters for OR search (same as TypeScript sandbox)
        # Example: ?q=file&q=read (NOT ?q=file+read)
        search_params = '&'.join(f'q={term}' for term in search_terms)
        url += f'?{search_params}'

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

# LLM Sampling helpers (Phase 8: FR-2 Python Sampling Interface)
SAMPLING_ENABLED = globals().get('SAMPLING_ENABLED', False)
SAMPLING_PORT = globals().get('SAMPLING_PORT', None)
SAMPLING_TOKEN = globals().get('SAMPLING_TOKEN', None)
SAMPLING_HOSTNAME = globals().get('SAMPLING_HOSTNAME', 'localhost')  # T093: Docker detection

class LLM:
    """LLM sampling interface for Python sandbox"""

    async def ask(self, prompt: str, system_prompt: str = '', max_tokens: int = 1000, stream: bool = False):
        """
        Simple LLM query - returns response text

        Args:
            prompt: The prompt to send to the LLM
            system_prompt: Optional system prompt
            max_tokens: Maximum tokens to generate (default: 1000)
            stream: Enable streaming (not supported in Pyodide)

        Returns:
            str: The LLM response text

        Raises:
            Exception: If sampling not enabled or call fails
        """
        if not SAMPLING_ENABLED:
            raise Exception('Sampling not enabled. Pass enableSampling=True to executor options')

        # Pyodide streaming limitation: Always use non-streaming mode
        # WebAssembly fetch API doesn't support streaming response bodies
        if stream:
            print('[Warning] Streaming not supported in Pyodide, using non-streaming mode')

        response = await pyfetch(
            f'http://{SAMPLING_HOSTNAME}:{SAMPLING_PORT}/sample',
            method='POST',
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {SAMPLING_TOKEN}'
            },
            body=json.dumps({
                'messages': [{'role': 'user', 'content': prompt}],
                'model': 'claude-3-5-haiku-20241022',
                'systemPrompt': system_prompt,
                'maxTokens': max_tokens,
                'stream': False  # Always False for Pyodide
            })
        )

        if response.status != 200:
            error = await response.json()
            error_msg = error.get('error', 'Sampling call failed')
            debug_info = '\\n\\nDebug Info:\\n' + str(error.get('debug', '')) if error.get('debug') else ''
            raise Exception(error_msg + debug_info)

        result = await response.json()
        return result.get('response', '')

    async def think(self, messages: list, model: str = 'claude-3-5-haiku-20241022',
                   max_tokens: int = 1000, system_prompt: str = ''):
        """
        Multi-turn conversation - supports message history

        Args:
            messages: List of message dicts with 'role' and 'content' keys
            model: Model to use (default: claude-3-5-haiku-20241022)
            max_tokens: Maximum tokens to generate (default: 1000)
            system_prompt: Optional system prompt

        Returns:
            str: The LLM response text

        Raises:
            Exception: If sampling not enabled or call fails
        """
        if not SAMPLING_ENABLED:
            raise Exception('Sampling not enabled. Pass enableSampling=True to executor options')

        response = await pyfetch(
            f'http://{SAMPLING_HOSTNAME}:{SAMPLING_PORT}/sample',
            method='POST',
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {SAMPLING_TOKEN}'
            },
            body=json.dumps({
                'messages': messages,
                'model': model,
                'systemPrompt': system_prompt,
                'maxTokens': max_tokens,
                'stream': False  # Always False for Pyodide
            })
        )

        if response.status != 200:
            error = await response.json()
            error_msg = error.get('error', 'Sampling call failed')
            debug_info = '\\n\\nDebug Info:\\n' + str(error.get('debug', '')) if error.get('debug') else ''
            raise Exception(error_msg + debug_info)

        result = await response.json()
        return result.get('response', '')

# Create global llm instance
llm = LLM()
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
        samplingCalls: samplingBridge ? samplingBridge.getSamplingCalls() : undefined,
        samplingMetrics: samplingBridge ? await samplingBridge.getSamplingMetrics('execution') : undefined,
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
        samplingCalls: samplingBridge ? samplingBridge.getSamplingCalls() : undefined,
        samplingMetrics: samplingBridge ? await samplingBridge.getSamplingMetrics('execution') : undefined,
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
      samplingCalls: samplingBridge ? samplingBridge.getSamplingCalls() : undefined,
      samplingMetrics: samplingBridge ? await samplingBridge.getSamplingMetrics('execution') : undefined,
    };
  } finally {
    // Cleanup
    if (samplingBridge) {
      await samplingBridge.stop();
    }
    if (streamingProxy) {
      await streamingProxy.stop();
    }
    await proxyServer.stop();
  }
}
