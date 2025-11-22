import { createServer, IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import AsyncLock from 'async-lock';
import { Ajv } from 'ajv';
import type { ValidateFunction, ErrorObject } from 'ajv';
import type { SamplingConfig, SamplingCall, SamplingMetrics, LLMMessage, LLMResponse } from '../../types.js';
import type { LLMProvider } from '../../sampling/providers/types.js';
import { ProviderFactory } from '../../sampling/providers/factory.js';
import { ContentFilter } from '../../validation/content-filter.js';
import { RateLimiter } from '../../security/rate-limiter.js';

/**
 * Bridge Server Constants
 *
 * WHY These Constants?
 * - BEARER_TOKEN_BYTES: 256-bit (32 bytes) cryptographically secure token
 * - GRACEFUL_SHUTDOWN_MAX_WAIT_MS: 5 seconds max to drain active requests
 * - GRACEFUL_SHUTDOWN_POLL_INTERVAL_MS: Check every 100ms for active requests
 * - MAX_SYSTEM_PROMPT_ERROR_LENGTH: Prevent log pollution with large prompts
 * - DEFAULT_MAX_TOKENS_PER_REQUEST: Reasonable default for most use cases
 * - MAX_TOKENS_PER_REQUEST_CAP: Hard limit to prevent resource exhaustion
 */
const BEARER_TOKEN_BYTES = 32; // 256-bit = 32 bytes
const GRACEFUL_SHUTDOWN_MAX_WAIT_MS = 5000; // 5 seconds
const GRACEFUL_SHUTDOWN_POLL_INTERVAL_MS = 100; // 100ms polling
const MAX_SYSTEM_PROMPT_ERROR_LENGTH = 100; // Truncate system prompts in errors
const DEFAULT_MAX_TOKENS_PER_REQUEST = 1000; // Default max tokens
const MAX_TOKENS_PER_REQUEST_CAP = 10000; // Hard cap on max tokens

/**
 * Generate cryptographically secure bearer token
 *
 * WHY Separate Function?
 * - Single Responsibility Principle (SRP): Token generation is a distinct concern
 * - Testability: Can be unit tested independently
 * - Reusability: Token rotation feature could reuse this
 *
 * WHY 256-bit?
 * - Cryptographically secure (2^256 possible values)
 * - Industry standard for API tokens
 * - Resistant to brute-force attacks
 *
 * @returns 64-character hex string (256 bits)
 */
function generateBearerToken(): string {
  return crypto.randomBytes(BEARER_TOKEN_BYTES).toString('hex');
}

/**
 * Validate system prompt against allowlist
 *
 * WHY Separate Function?
 * - Single Responsibility Principle (SRP): Validation is separate from HTTP handling
 * - Testability: Can test validation logic independently
 * - Reusability: Could be used by other components
 *
 * WHY Allowlist?
 * - Security: Prevents prompt injection attacks
 * - Control: Limits what system prompts can be used
 * - Audit: Clear list of approved prompts
 *
 * @param systemPrompt - System prompt to validate
 * @param allowedPrompts - List of allowed system prompts
 * @returns Validation result with error message if invalid
 */
function validateSystemPrompt(
  systemPrompt: string | undefined,
  allowedPrompts: string[]
): { valid: boolean; errorMessage?: string } {
  if (!systemPrompt) {
    return { valid: true }; // Empty prompt is always allowed
  }

  if (!allowedPrompts.includes(systemPrompt)) {
    const truncatedPrompt = systemPrompt.length > MAX_SYSTEM_PROMPT_ERROR_LENGTH
      ? systemPrompt.slice(0, MAX_SYSTEM_PROMPT_ERROR_LENGTH) + '...'
      : systemPrompt;
    return {
      valid: false,
      errorMessage: `System prompt not in allowlist: ${truncatedPrompt}`
    };
  }

  return { valid: true };
}

/**
 * Bridge request body interface (validated with AJV at runtime)
 */
interface BridgeRequestBody {
  messages: LLMMessage[];
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
  stream?: boolean;
}

/**
 * JSON Schema for bridge request validation (AJV)
 *
 * WHY: Runtime validation is mandatory per Constitutional Principle 4 (Type Safety + Runtime Safety).
 * TypeScript provides compile-time safety, but external inputs must be validated at runtime.
 */
const BRIDGE_REQUEST_SCHEMA = {
  type: 'object',
  properties: {
    messages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['user', 'assistant', 'system'] },
          content: {
            oneOf: [
              { type: 'string' },
              {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string' },
                    text: { type: 'string' }
                  },
                  required: ['type']
                }
              }
            ]
          }
        },
        required: ['role', 'content'],
        additionalProperties: false
      },
      minItems: 1
    },
    model: { type: 'string', minLength: 1 },
    maxTokens: { type: 'integer', minimum: 1, maximum: 100000 },
    systemPrompt: { type: 'string' },
    stream: { type: 'boolean' }
  },
  required: ['messages'],
  additionalProperties: false
} as const;

/**
 * Sampling Bridge Server
 *
 * Ephemeral HTTP server that proxies LLM sampling requests from sandbox
 * to LLM API via MCP SDK or direct provider API. Implements security controls including:
 * - Bearer token authentication
 * - Rate limiting (rounds and tokens)
 * - System prompt allowlist
 * - Content filtering for secrets/PII
 * - AJV schema validation
 *
 * ## Lifecycle Design: Why Ephemeral?
 *
 * **Decision:** Bridge server is created per execution (ephemeral) vs. persistent across executions
 *
 * **Rationale:**
 * 1. **Security Isolation** - Each execution gets fresh bearer token, preventing token reuse attacks
 * 2. **Resource Cleanup** - Server automatically closed after execution, no leaked connections
 * 3. **Rate Limit Isolation** - Per-execution quotas (maxRounds, maxTokens) enforced independently
 * 4. **Stateless Design** - No shared state between executions, simpler reasoning about correctness
 * 5. **Startup Cost Minimal** - Bridge server starts in <50ms (negligible overhead)
 *
 * **Trade-offs:**
 * - ✅ Security: Fresh token per execution prevents cross-execution attacks
 * - ✅ Simplicity: No connection pooling or lifecycle management needed
 * - ✅ Isolation: Execution failures don't affect other executions
 * - ⚠️ Performance: ~50ms overhead per execution (acceptable for sampling use case)
 *
 * **Alternative Considered:** Persistent server with connection pooling
 * - Would require complex lifecycle management (start/stop/restart)
 * - Token rotation mechanism needed for security
 * - Shared rate limiter state across executions (more complex)
 * - Minimal performance benefit (~50ms saved) doesn't justify complexity
 *
 * **Conclusion:** Ephemeral design chosen for security and simplicity at negligible performance cost
 */
export class SamplingBridgeServer {
  private server: ReturnType<typeof createServer> | null = null;
  private bearerToken: string | null = null;
  private port: number | null = null;
  private isStarted = false;

  // Rate limiting (extracted to RateLimiter class for SRP)
  private rateLimiter: RateLimiter;
  private startTime = Date.now();
  private rateLimitLock: AsyncLock;

  // Dependencies
  /**
   * MCP Server instance (or test mock)
   *
   * NOTE ON `any` TYPE:
   * This is intentionally typed as `Server | any` to allow test mocks that don't fully
   * implement the Server interface. In production, this will always be a proper Server instance.
   * Runtime validation is enforced by AJV for all external inputs, not relying on this type.
   *
   * @see BRIDGE_REQUEST_SCHEMA for runtime validation
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mcpServer: Server | any;
  private provider: LLMProvider | null = null;
  private config: SamplingConfig;
  private contentFilter: ContentFilter;
  private samplingMode: 'mcp' | 'direct' = 'direct';
  private lastSamplingError: string | null = null;

  // AJV validator for request body validation
  private ajv: Ajv;
  private validateRequest: ValidateFunction<BridgeRequestBody>;

  // Sampling calls tracking
  private samplingCalls: SamplingCall[] = [];

  // Active requests tracking for graceful shutdown
  private activeRequests = new Set<ServerResponse>();

  /**
   * Constructor for SamplingBridgeServer
   *
   * @param mcpServer - MCP server instance (can be mock for testing)
   * @param config - SamplingConfig object
   * @param provider - Optional LLMProvider (for testing/mocking)
   */
  constructor(
    mcpServer: Server | any,
    config?: SamplingConfig,
    provider?: LLMProvider
  ) {
    this.mcpServer = mcpServer;

    // Default config if none provided
    this.config = config || {
      enabled: true,
      provider: 'anthropic',
      maxRoundsPerExecution: 10,
      maxTokensPerExecution: 10000,
      timeoutPerCallMs: 30000,
      allowedSystemPrompts: ['', 'You are a helpful assistant', 'You are a code analysis expert'],
      contentFilteringEnabled: true,
      allowedModels: ['claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022']
    };

    if (provider) {
      this.provider = provider;
    }

    // HYBRID SAMPLING: Detect which mode to use (MCP SDK or direct Provider API)
    this.samplingMode = this.detectSamplingMode();

    // ALWAYS create provider if not already provided (needed as fallback even in MCP mode)
    // BUG FIX: Provider must be available for fallback when MCP sampling fails
    if (!this.provider) {
      this.provider = ProviderFactory.createProvider(this.config);

      if (this.provider) {
        if (this.samplingMode === 'direct') {
          console.log(`[Sampling] Using direct ${this.config.provider} API`);
        } else {
          console.log(`[Sampling] ${this.config.provider} API available as fallback if MCP sampling fails`);
        }
      } else {
        console.warn(
          `[Sampling] WARNING: No MCP sampling available and ${this.config.provider} API key not set. ` +
          'Sampling will fail unless API key is provided later.'
        );
      }
    }

    this.contentFilter = new ContentFilter();
    this.rateLimiter = new RateLimiter({
      maxRoundsPerExecution: this.config.maxRoundsPerExecution,
      maxTokensPerExecution: this.config.maxTokensPerExecution
    });
    this.rateLimitLock = new AsyncLock();

    // Initialize AJV validator with strict mode
    this.ajv = new Ajv({ allErrors: true, strict: true });
    this.validateRequest = this.ajv.compile(BRIDGE_REQUEST_SCHEMA);
  }

  /**
   * Detect which sampling mode to use (MCP SDK vs direct Provider API)
   *
   * Detection logic:
   * 1. Check if mcpServer has createMessage method (MCP SDK sampling capability)
   * 2. If yes → try MCP sampling first
   * 3. If no → use direct Provider API
   *
   * @returns 'mcp' if MCP SDK detected, 'direct' for Provider API
   */
  private detectSamplingMode(): 'mcp' | 'direct' {
    // Check if mcpServer has createMessage method (indicates MCP SDK sampling capability)
    if (this.mcpServer && typeof this.mcpServer.createMessage === 'function') {
      console.log('[Sampling] MCP SDK detected - will attempt MCP sampling first (free via MCP client)');
      return 'mcp';
    }

    console.log(`[Sampling] No MCP SDK detected - will use direct ${this.config.provider} API`);
    return 'direct';
  }

  /**
   * Start the sampling bridge server
   *
   * @returns Promise resolving to server info
   * @throws Error if server fails to start
   */
  async start(): Promise<{ port: number; authToken: string }> {
    if (this.isStarted) {
      throw new Error('Bridge server already started');
    }

    // Generate cryptographically secure bearer token (256-bit)
    // WHY: Each bridge server session gets a unique token to prevent unauthorized access
    // WHY: 256-bit entropy makes brute-force attacks computationally infeasible
    this.bearerToken = generateBearerToken();

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch(err => {
          console.error('Request handling error:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        });
      });

      // Find random available port
      // WHY Localhost only: Prevents external network access to bridge server (security)
      this.server.listen(0, 'localhost', () => {
        const address = this.server!.address();
        if (typeof address === 'string' || !address) {
          reject(new Error('Failed to get server address'));
          return;
        }

        this.port = address.port;
        this.isStarted = true;

        resolve({
          port: this.port,
          authToken: this.bearerToken!
        });
      });

      this.server.on('error', reject);
    });
  }

  /**
   * Stop the sampling bridge server gracefully
   *
   * Drains active requests before closing the server to ensure
   * no requests are dropped during shutdown.
   *
   * @returns Promise that resolves when server is stopped
   */
  async stop(): Promise<void> {
    if (!this.isStarted || !this.server) {
      return;
    }

    // Wait for active requests to complete (with timeout)
    const maxWaitTime = GRACEFUL_SHUTDOWN_MAX_WAIT_MS; // 5 seconds max wait
    const startWait = Date.now();

    while (this.activeRequests.size > 0 && (Date.now() - startWait) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, GRACEFUL_SHUTDOWN_POLL_INTERVAL_MS)); // Wait 100ms and check again
    }

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.isStarted = false;
        this.server = null;
        this.bearerToken = null;
        this.port = null;
        this.activeRequests.clear();
        resolve();
      });
    });
  }

  /**
   * Get sampling metrics for this execution
   *
   * @param _executionId - Execution identifier (not used in current implementation, reserved for future use)
   * @returns Current sampling metrics
   */
  async getSamplingMetrics(_executionId: string): Promise<SamplingMetrics> {
    const metrics = await this.rateLimiter.getMetrics();
    const quotaRemaining = await this.rateLimiter.getQuotaRemaining();
    const totalRounds = metrics.roundsUsed;
    const totalTokens = metrics.tokensUsed;
    const totalDurationMs = Date.now() - this.startTime;
    const averageTokensPerRound = totalRounds > 0 ? totalTokens / totalRounds : 0;

    return {
      totalRounds,
      totalTokens,
      totalDurationMs,
      averageTokensPerRound,
      quotaRemaining
    };
  }

  /**
   * Get all sampling calls made during this execution
   *
   * @returns Array of sampling calls
   */
  getSamplingCalls(): SamplingCall[] {
    return [...this.samplingCalls];
  }

  /**
   * Call Claude via MCP SDK sampling/createMessage
   *
   * This uses the MCP SDK's sampling capability, which is free for users
   * running MCP-enabled clients (covered by their subscription).
   *
   * @returns LLMResponse or null if MCP sampling failed (triggers Direct API fallback)
   */
  private async callViaMCPSampling(
    messages: LLMMessage[],
    model: string,
    maxTokens: number,
    systemPrompt?: string
  ): Promise<LLMResponse | null> {
    try {
      // Convert to MCP message format
      const mcpMessages = messages.map(msg => ({
        role: msg.role,
        content: {
          type: 'text',
          text: typeof msg.content === 'string'
            ? msg.content
            : msg.content.filter(c => c.type === 'text').map(c => (c as { type: 'text'; text: string }).text).join('\n')
        }
      }));

      // Call MCP SDK's createMessage() method for sampling (proper API)
      // Note: Use createMessage() instead of request() for LLM sampling
      const clientCaps = this.mcpServer.getClientCapabilities();
      console.log('[Sampling] Client capabilities:', JSON.stringify(clientCaps));
      console.log('[Sampling] Calling createMessage with', mcpMessages.length, 'messages');

      const response = await this.mcpServer.createMessage({
        messages: mcpMessages,
        modelPreferences: {
          hints: [{ name: model }]
        },
        maxTokens,
        systemPrompt: systemPrompt || undefined,
        includeContext: 'none'
      });

      console.log('[Sampling] MCP sampling succeeded');

      // Convert response to our format
      return {
        content: Array.isArray(response.content)
          ? response.content
          : [{ type: 'text', text: response.content.text }],
        stopReason: response.stopReason,
        model: response.model,
        usage: {
          inputTokens: 0,  // MCP SDK may not provide token counts
          outputTokens: 0
        }
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error('[Sampling] MCP sampling failed:', errorMsg);
      console.error('[Sampling] Error stack:', errorStack);
      console.error('[Sampling] Error type:', error?.constructor?.name);

      // Store error for debugging
      this.lastSamplingError = errorMsg;

      // If MCP sampling fails, update mode and fall back to direct API
      if (this.samplingMode === 'mcp') {
        console.warn('[Sampling] Falling back to direct Provider API for subsequent requests');
        this.samplingMode = 'direct';
      }

      return null;
    }
  }

  /**
   * Call LLM via direct Provider API
   *
   * This requires an API key and users pay per-token usage.
   *
   * @returns LLMResponse
   * @throws Error if Provider not configured or API call fails
   */
  private async callViaProvider(
    messages: LLMMessage[],
    model: string,
    maxTokens: number,
    systemPrompt?: string
  ): Promise<LLMResponse> {
    if (!this.provider) {
      throw new Error(
        `${this.config.provider} API not configured. Set API key environment variable.`
      );
    }

    return await this.provider.generateMessage(
      messages,
      systemPrompt,
      model,
      maxTokens
    );
  }

  /**
   * Handle incoming HTTP request
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Track active request for graceful shutdown
    this.activeRequests.add(res);

    // Clean up when response finishes
    res.on('finish', () => {
      this.activeRequests.delete(res);
    });

    // Only allow POST to /sample endpoint
    if (req.method !== 'POST' || req.url !== '/sample') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    try {
      // Read and parse request body
      const body = await this.readRequestBody(req);
      const callStartTime = Date.now();

      // Validate bearer token
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid authorization header' }));
        return;
      }

      const providedToken = authHeader.slice(7); // Remove 'Bearer ' prefix
      if (!this.validateBearerToken(providedToken)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Auth token invalid' }));
        return;
      }

      // Check rate limits (atomic check with AsyncLock for concurrency safety)
      // Note: For streaming, rounds are checked here, tokens checked at end
      const quotaCheck = await this.rateLimitLock.acquire('rate-limit-check', async () => {
        const roundCheck = await this.rateLimiter.checkRoundLimit();
        if (!roundCheck.allowed) {
          return { type: 'rounds' as const, exceeded: true };
        }
        // For non-streaming, also check token limit upfront
        const tokenCheck = await this.rateLimiter.checkTokenLimit(0);
        if (!tokenCheck.allowed) {
          return { type: 'tokens' as const, exceeded: true };
        }
        return { exceeded: false };
      });

      if (quotaCheck.exceeded) {
        const metrics = await this.getSamplingMetrics('current');
        res.writeHead(429, { 'Content-Type': 'application/json' });
        if (quotaCheck.type === 'rounds') {
          res.end(JSON.stringify({
            error: `Rate limit exceeded: ${metrics.totalRounds}/${this.config.maxRoundsPerExecution} rounds used, ${metrics.quotaRemaining.rounds} remaining`
          }));
        } else {
          res.end(JSON.stringify({
            error: `Token limit exceeded: ${metrics.totalTokens}/${this.config.maxTokensPerExecution} tokens used, ${metrics.quotaRemaining.tokens} remaining`
          }));
        }
        return;
      }

      // Validate system prompt allowlist
      const promptValidation = validateSystemPrompt(body.systemPrompt, this.config.allowedSystemPrompts);
      if (!promptValidation.valid) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: promptValidation.errorMessage
        }));
        return;
      }

      // Call Provider API with provider-specific default models (January 2025 - most cost-effective)
      const defaultModels: Record<string, string> = {
        anthropic: 'claude-haiku-4-5-20251001',           // $1 input/$5 output per MTok - fastest Haiku
        openai: 'gpt-4o-mini',                             // $0.15 input/$0.60 output per MTok - 17x cheaper than gpt-4o
        gemini: 'gemini-2.5-flash-lite',                   // $0.10 input/$0.40 output per MTok - free tier available
        grok: 'grok-4-1-fast-non-reasoning',               // $0.20 input/$0.50 output per MTok - 2M context
        perplexity: 'sonar'                                // $1 input/$1 output per MTok - includes real-time search
      };
      const model = body.model || defaultModels[this.config.provider] || 'claude-haiku-4-5-20251001';

      // Validate model is in allowlist
      // Validate model is in allowlist (Issue #69: Enforce for all providers)
      // Config loader now ensures allowedModels matches the configured provider
      if (!this.config.allowedModels.includes(model)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `Model '${model}' not in allowlist. Allowed models: ${this.config.allowedModels.join(', ')}`
        }));
        return;
      }

      const maxTokens = Math.min(body.maxTokens || DEFAULT_MAX_TOKENS_PER_REQUEST, MAX_TOKENS_PER_REQUEST_CAP); // Cap at 10k tokens
      const stream = body.stream === true; // Check if streaming is requested
      const systemPrompt = body.systemPrompt;

      // Handle streaming response
      if (stream) {
        // Early check: streaming requires a provider  
        if (this.samplingMode === 'direct' && !this.provider) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: `Streaming requires ${this.config.provider} API key. Set API key environment variable.`
          }));
          return;
        }

        try {
          // Set SSE headers for streaming
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no' // Disable nginx buffering
          });

          // Increment round counter for streaming (tokens counted at end)
          // Rate limit already checked above
          await this.rateLimitLock.acquire('rate-limit-update', async () => {
            await this.rateLimiter.incrementRounds();
          });

          // HYBRID SAMPLING: Streaming only supported via direct Provider API
          // MCP SDK streaming support would be added in Phase 2
          if (this.samplingMode === 'mcp') {
            console.warn('[Sampling] Streaming requested but MCP mode active - falling back to direct API for streaming');
            // If no Provider available, return error
            if (!this.provider) {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                error: `Streaming requires direct ${this.config.provider} API. Set API key or use non-streaming mode.`
              }));
              return;
            }
          } else if (!this.provider) {
            // Direct mode but no provider
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: `Streaming requires ${this.config.provider} API key. Set API key environment variable.`
            }));
            return;
          }

          // Create streaming request
          const streamGenerator = this.provider.streamMessage(
            body.messages,
            systemPrompt,
            model,
            maxTokens
          );

          let fullText = '';
          let inputTokens = 0;
          let outputTokens = 0;

          // Stream chunks as they arrive
          for await (const event of streamGenerator) {
            if (event.type === 'chunk') {
              const chunk = event.content;
              fullText += chunk;

              // Apply content filtering if enabled (per chunk)
              let filteredChunk = chunk;
              if (this.config.contentFilteringEnabled) {
                const { filtered } = this.contentFilter.scan(chunk);
                filteredChunk = filtered;
              }

              // Send chunk to client (handle client disconnect gracefully)
              try {
                res.write(`data: ${JSON.stringify({ type: 'chunk', content: filteredChunk })}\n\n`);
              } catch (error) {
                // Client disconnected, stop streaming
                console.error('Client disconnected during stream:', error);
                return;
              }
            } else if (event.type === 'usage') {
              inputTokens = event.inputTokens || inputTokens;
              outputTokens = event.outputTokens || outputTokens;
            }
          }

          // Message complete
          const tokensUsed = inputTokens + outputTokens;

          // Check token limit after streaming completes
          const tokenLimitCheck = await this.rateLimitLock.acquire('rate-limit-update', async () => {
            const tokenCheck = await this.rateLimiter.checkTokenLimit(tokensUsed);
            if (!tokenCheck.allowed) {
              return { exceeded: true, metrics: await this.getSamplingMetrics('current') };
            }
            await this.rateLimiter.incrementTokens(tokensUsed);
            return { exceeded: false };
          });

          if (tokenLimitCheck.exceeded) {
            // Decrement rounds since we're rejecting due to token limit
            await this.rateLimitLock.acquire('rate-limit-update', async () => {
              await this.rateLimiter.decrementRounds();
            });

            if (tokenLimitCheck.metrics) {
              try {
                res.write(`data: ${JSON.stringify({ error: `Token limit exceeded: ${tokenLimitCheck.metrics.totalTokens + tokensUsed}/${this.config.maxTokensPerExecution} tokens would be used` })}\n\n`);
                res.end();
              } catch (error) {
                console.error('Error sending token limit error:', error);
              }
            }
            return;
          }

          // Create sampling call record
          const callDuration = Date.now() - callStartTime;
          const samplingCall: SamplingCall = {
            model,
            messages: body.messages,
            systemPrompt: body.systemPrompt,
            response: {
              content: [{ type: 'text', text: fullText }],
              stopReason: 'end_turn',
              model,
              usage: {
                inputTokens,
                outputTokens
              }
            },
            durationMs: callDuration,
            tokensUsed,
            timestamp: new Date().toISOString()
          };

          this.samplingCalls.push(samplingCall);

          // Send completion event
          try {
            res.write(`data: ${JSON.stringify({ type: 'done', content: fullText, usage: { inputTokens, outputTokens } })}\n\n`);
            res.end();
          } catch (error) {
            console.error('Error sending completion event:', error);
          }
          return;

        } catch (error) {
          console.error('Streaming error:', error);
          // Decrement rounds since stream failed
          await this.rateLimitLock.acquire('rate-limit-update', async () => {
            await this.rateLimiter.decrementRounds();
          });

          try {
            res.write(`data: ${JSON.stringify({ error: 'Streaming error', details: error instanceof Error ? error.message : 'Unknown error' })}\n\n`);
            res.end();
          } catch (writeError) {
            console.error('Error sending streaming error:', writeError);
          }
          return;
        }
      }

      // HYBRID SAMPLING: Try MCP first, fall back to direct API
      let llmResponse: LLMResponse;
      let tokensUsed = 0;

      // Try MCP sampling first if available
      if (this.samplingMode === 'mcp') {
        const mcpResponse = await this.callViaMCPSampling(
          body.messages,
          model,
          maxTokens,
          systemPrompt
        );

        if (mcpResponse) {
          llmResponse = mcpResponse;
          // MCP SDK might not report token usage, estimate conservatively
          tokensUsed = maxTokens; // Conservative estimate
          console.log('[Sampling] MCP sampling succeeded (free via MCP client)');
        } else {
          // MCP failed, fall back to direct API
          if (!this.provider) {
            const clientCaps = this.mcpServer.getClientCapabilities();
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: `MCP sampling unavailable and no ${this.config.provider} API key configured. ` +
                'Set API key environment variable to use direct API.',
              debug: {
                clientCapabilities: clientCaps,
                mcpServerType: this.mcpServer.constructor.name,
                hasSamplingCapability: clientCaps?.sampling !== undefined,
                lastError: this.lastSamplingError
              }
            }));
            return;
          }

          console.log('[Sampling] MCP failed, falling back to direct Provider API');
          try {
            llmResponse = await this.callViaProvider(
              body.messages,
              model,
              maxTokens,
              systemPrompt
            );
            tokensUsed = (llmResponse.usage?.inputTokens || 0) + (llmResponse.usage?.outputTokens || 0);
          } catch (error) {
            console.error('Provider API error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'Provider API error',
              details: error instanceof Error ? error.message : 'Unknown error'
            }));
            return;
          }
        }
      } else {
        // Direct API mode
        if (!this.provider) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: `${this.config.provider} API key required. Set API key environment variable.`
          }));
          return;
        }

        try {
          llmResponse = await this.callViaProvider(
            body.messages,
            model,
            maxTokens,
            systemPrompt
          );
          tokensUsed = (llmResponse.usage?.inputTokens || 0) + (llmResponse.usage?.outputTokens || 0);
          console.log('[Sampling] Direct Provider API call succeeded');
        } catch (error) {
          console.error('Provider API error:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Provider API error',
            details: error instanceof Error ? error.message : 'Unknown error'
          }));
          return;
        }
      }

      const callDuration = Date.now() - callStartTime;

      // Update rate limiting counters and check token limit (atomic with AsyncLock for concurrency safety)
      // Token limit is checked AFTER API call since we don't know usage until then
      const tokenLimitCheck = await this.rateLimitLock.acquire('rate-limit-update', async () => {
        // Check if adding these tokens would exceed limit
        const tokenCheck = await this.rateLimiter.checkTokenLimit(tokensUsed);
        if (!tokenCheck.allowed) {
          return { exceeded: true, metrics: await this.getSamplingMetrics('current') };
        }
        // Update counters
        await this.rateLimiter.incrementRounds();
        await this.rateLimiter.incrementTokens(tokensUsed);
        return { exceeded: false };
      });

      if (tokenLimitCheck.exceeded) {
        const metrics = tokenLimitCheck.metrics!;
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `Token limit exceeded: ${metrics.totalTokens + tokensUsed}/${this.config.maxTokensPerExecution} tokens would be used, ${Math.max(0, this.config.maxTokensPerExecution - metrics.totalTokens)} remaining`
        }));
        return;
      }

      // Apply content filtering if enabled (llmResponse already set by hybrid logic above)
      let filteredContent = llmResponse.content;
      if (this.config.contentFilteringEnabled) {
        const contentText = llmResponse.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map(c => c.text)
          .join('');

        const { filtered } = this.contentFilter.scan(contentText);
        filteredContent = [{ type: 'text' as const, text: filtered }];
      }

      // Create sampling call record
      const samplingCall: SamplingCall = {
        model,
        messages: body.messages,
        systemPrompt: body.systemPrompt,
        response: {
          ...llmResponse,
          content: filteredContent
        },
        durationMs: callDuration,
        tokensUsed,
        timestamp: new Date().toISOString()
      };

      this.samplingCalls.push(samplingCall);

      // Return response
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ...llmResponse,
        content: filteredContent
      }));

    } catch (error) {
      console.error('Sampling request error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Sampling failure',
        details: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  }



  /**
   * Read and validate request body with AJV
   *
   * WHY: Runtime validation prevents malformed requests from reaching business logic.
   * Constitutional Principle 4 (Type Safety + Runtime Safety) requires AJV validation
   * for all external inputs, not just TypeScript compile-time types.
   *
   * @param req - Incoming HTTP request
   * @returns Validated bridge request body
   * @throws Error if JSON parsing fails or validation fails
   */
  private async readRequestBody(req: IncomingMessage): Promise<BridgeRequestBody> {
    return new Promise((resolve, reject) => {
      let body = '';

      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);

          // Validate with AJV (deep recursive validation)
          const valid = this.validateRequest(parsed);
          if (!valid) {
            const errors = this.validateRequest.errors
              ?.map((e: ErrorObject) => `${e.instancePath} ${e.message}`)
              .join(', ') || 'Validation failed';
            reject(new Error(`Invalid request body: ${errors}`));
            return;
          }

          // TypeScript now knows parsed is BridgeRequestBody
          resolve(parsed as BridgeRequestBody);
        } catch (error) {
          if (error instanceof SyntaxError) {
            reject(new Error('Invalid JSON in request body'));
          } else {
            reject(error);
          }
        }
      });

      req.on('error', reject);
    });
  }

  /**
   * Validate bearer token using constant-time comparison
   *
   * Uses crypto.timingSafeEqual to prevent timing attacks that could
   * leak information about valid token prefixes.
   */
  private validateBearerToken(providedToken: string): boolean {
    if (!this.bearerToken) {
      return false;
    }

    try {
      const providedBuffer = Buffer.from(providedToken, 'utf-8');
      const expectedBuffer = Buffer.from(this.bearerToken, 'utf-8');

      if (providedBuffer.length !== expectedBuffer.length) {
        return false;
      }

      // WHY Constant-time comparison: Prevents timing attacks that could leak token information
      return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
    } catch {
      return false;
    }
  }
}
