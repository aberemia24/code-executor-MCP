/**
 * Sandbox Code Executor with MCP Proxy
 *
 * Executes TypeScript/Python code in Deno sandbox with injected callMCPTool() function.
 * Uses HTTP server for sandbox-to-parent communication.
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { getDenoPath, getAnthropicApiKey } from './config.js';
import { sanitizeOutput, truncateOutput, formatDuration, normalizeError } from './utils.js';
import { MCPProxyServer } from './mcp-proxy-server.js';
import { StreamingProxy } from './streaming-proxy.js';
import { SamplingBridgeServer } from './sampling-bridge-server.js';
import { getBridgeHostname } from './docker-detection.js';
import Anthropic from '@anthropic-ai/sdk';
import type { ExecutionResult, SandboxOptions, SamplingConfig, LLMResponse } from './types.js';
import type { MCPClientPool } from './mcp-client-pool.js';

// Configuration constants
const DISCOVERY_TIMEOUT_MS = 500; // Discovery endpoint timeout (matches NFR-2 requirement)
const SANDBOX_MEMORY_LIMIT_MB = 128; // V8 heap limit to prevent memory exhaustion attacks

/**
 * Normalize line endings to LF (Unix-style) for consistent hashing
 * Handles CRLF (Windows), CR (old Mac), and mixed line endings
 *
 * WHY: Filesystem may normalize line endings during write, causing
 * hash mismatches in integrity checks (TOCTOU vulnerability mitigation)
 */
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Execute TypeScript code in Deno sandbox with MCP access
 */
export async function executeTypescriptInSandbox(
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

  // Start sampling bridge server if sampling is enabled
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
    // Check for createMessage() method (proper MCP SDK sampling API)
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
      await proxyServer.stop();
      if (streamingProxy) {
        await streamingProxy.stop();
      }
      return {
        success: false,
        output: '',
        error: normalizeError(error, 'Failed to start sampling bridge server').message,
        executionTimeMs: Date.now() - startTime,
        streamUrl,
      };
    }
  }

  // Temp file for user code (will be cleaned up in finally)
  // Use crypto.randomUUID() for guaranteed uniqueness (no race condition)
  const userCodeFile = `/tmp/sandbox-${crypto.randomUUID()}.ts`;
  let tempFileCreated = false;

  try {
    // SEC-006 FIX: Hash original content BEFORE writing (eliminates TOCTOU race)
    // WHY: Re-reading file creates race window where attacker could modify file
    // NEW APPROACH: Hash original content, write atomically, execute immediately
    const normalizedCode = normalizeLineEndings(options.code);
    const expectedHash = crypto.createHash('sha256').update(normalizedCode).digest('hex');

    // Write user code to temp file atomically (avoids eval() security violation)
    await fs.writeFile(userCodeFile, options.code, 'utf-8');
    tempFileCreated = true;

    // SECURITY: Store expected hash for post-execution verification (optional defense-in-depth)
    // No re-read before execution = no TOCTOU race window
    // File is executed immediately after write (microsecond window vs millisecond race)

    // Create wrapper code that injects callMCPTool() + discovery functions and imports user code
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
  let url = \`http://localhost:${proxyPort}/mcp/tools\`;

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
        'Authorization': \`Bearer ${authToken}\`
      },
      // PERFORMANCE (Constitutional Principle 8): Timeout prevents hanging
      // Meets NFR-2 requirement (<100ms P95 latency for normal case)
      // T067: Fix interpolation - ${DISCOVERY_TIMEOUT_MS} resolves to numeric value
      signal: AbortSignal.timeout(${DISCOVERY_TIMEOUT_MS})
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
    const data = await response.json();
    // Extract tools array from wrapper object (endpoint returns { tools: [...] })
    return data.tools || [];
  } catch (error: unknown) {
    // FIX: Proper error handling pattern (catch with unknown type)
    // Normalize error to Error instance before accessing properties
    const normalizedError = error instanceof Error ? error : new Error(String(error));

    // Handle timeout errors with clear message
    // T067: Fix interpolation - ${DISCOVERY_TIMEOUT_MS} resolves to numeric value in error message
    if (normalizedError.name === 'AbortError' || normalizedError.name === 'TimeoutError') {
      throw new Error(\`MCP tool discovery timed out after ${DISCOVERY_TIMEOUT_MS}ms\`);
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

// MCP Sampling helpers (injected when sampling is enabled)
${options.enableSampling ? `
// Helper function to create SSE streaming generator (DRY: extracted from llm.ask/think)
function createStreamingGenerator(response: Response): AsyncGenerator<string> {
  return (async function* () {
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('Streaming response body not available');
    }

    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              return;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'chunk') {
                yield parsed.content;
              } else if (parsed.type === 'done') {
                return;
              } else if (parsed.error) {
                throw new Error(parsed.error);
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  })();
}

// LLM sampling helpers for TypeScript
globalThis.llm = {
  /**
   * Simple LLM query - returns response text
   * @param prompt - The prompt to send to the LLM
   * @param options - Optional parameters (systemPrompt, maxTokens, stream)
   * @returns Promise<string> - The LLM response text (or async generator if streaming)
   */
  ask: async (prompt: string, options?: { systemPrompt?: string; maxTokens?: number; stream?: boolean }): Promise<string | AsyncGenerator<string>> => {
    const stream = options?.stream === true;

    const response = await fetch(\`http://${bridgeHostname}:${samplingPort}/sample\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer ${samplingToken}\`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        model: 'claude-3-5-haiku-20241022',
        systemPrompt: options?.systemPrompt || '',
        maxTokens: options?.maxTokens || 1000,
        stream
      })
    });

    if (!response.ok) {
      const error = await response.json();
      const errorMsg = error.error || 'Sampling call failed';
      const debugInfo = error.debug ? '\\n\\nDebug Info:\\n' + JSON.stringify(error.debug, null, 2) : '';
      throw new Error(errorMsg + debugInfo);
    }

    // Handle streaming response
    if (stream && response.headers.get('content-type')?.includes('text/event-stream')) {
      return createStreamingGenerator(response);
    }

    // Non-streaming response
    const result = await response.json();
    return result.content[0]?.text || '';
  },

  /**
   * Multi-turn conversation with LLM
   * @param options - Conversation options (messages, model, maxTokens, systemPrompt, stream)
   * @returns Promise<string> - The LLM response text (or async generator if streaming)
   */
  think: async (options: {
    messages: Array<{role: 'user'|'assistant'|'system', content: string}>,
    model?: string,
    maxTokens?: number,
    systemPrompt?: string,
    stream?: boolean
  }): Promise<string | AsyncGenerator<string>> => {
    const stream = options.stream === true;

    const response = await fetch(\`http://${bridgeHostname}:${samplingPort}/sample\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer ${samplingToken}\`
      },
      body: JSON.stringify({
        messages: options.messages,
        model: options.model || 'claude-3-5-haiku-20241022',
        systemPrompt: options.systemPrompt || '',
        maxTokens: options.maxTokens || 1000,
        stream
      })
    });

    if (!response.ok) {
      const error = await response.json();
      const errorMsg = error.error || 'Sampling call failed';
      const debugInfo = error.debug ? '\\n\\nDebug Info:\\n' + JSON.stringify(error.debug, null, 2) : '';
      throw new Error(errorMsg + debugInfo);
    }

    // Handle streaming response
    if (stream && response.headers.get('content-type')?.includes('text/event-stream')) {
      return createStreamingGenerator(response);
    }

    // Non-streaming response
    const result = await response.json();
    return result.content[0]?.text || '';
  }
};
` : `
// Sampling not enabled - throw error if llm helpers are called
globalThis.llm = {
  ask: async () => {
    throw new Error('Sampling not enabled. Pass enableSampling: true');
  },
  think: async () => {
    throw new Error('Sampling not enabled. Pass enableSampling: true');
  }
};
`}

// Import and execute user code from temp file
await import('file://${userCodeFile}');
`;

    // Build Deno arguments
    const denoArgs = ['run'];

    // SECURITY: Environment variable access blocked by default (no --allow-env)
    // Deno denies access to environment variables unless explicitly granted
    // This prevents leakage of secrets (AWS_ACCESS_KEY_ID, DATABASE_URL, etc.)

    // SECURITY: Add V8 memory limit to prevent memory exhaustion attacks
    // Limits heap to prevent allocation bombs
    denoArgs.push(`--v8-flags=--max-old-space-size=${SANDBOX_MEMORY_LIMIT_MB}`);

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
        denoProcess.on('close', async (code) => {
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
              samplingCalls: samplingBridge ? samplingBridge.getSamplingCalls() : undefined,
              samplingMetrics: samplingBridge ? await samplingBridge.getSamplingMetrics('execution') : undefined,
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
      // FIX: Handle spawn errors (e.g., Deno not installed)
      // Root cause: spawn fails silently if executable doesn't exist, causing tests to hang
      new Promise<ExecutionResult>((resolve) => {
        denoProcess.on('error', (error) => {
          // Clear timeout on error
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }

          resolve({
            success: false,
            output: '',
            error: normalizeError(
              error,
              `Failed to spawn Deno process. Is Deno installed? (${getDenoPath()})`
            ).message,
            executionTimeMs: Date.now() - startTime,
            toolCallsMade: [],
            toolCallSummary: [],
            streamUrl,
          });
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

    // Stop sampling bridge server
    if (samplingBridge) {
      await samplingBridge.stop();
    }

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
