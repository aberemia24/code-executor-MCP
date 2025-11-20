import { createServer, IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import AsyncLock from 'async-lock';
import type { SamplingConfig, SamplingCall, SamplingMetrics, LLMMessage, LLMResponse } from './types.js';
import { ContentFilter } from './security/content-filter.js';

/**
 * Sampling Bridge Server
 *
 * Ephemeral HTTP server that proxies LLM sampling requests from sandbox
 * to Claude API via MCP SDK. Implements security controls including:
 * - Bearer token authentication
 * - Rate limiting (rounds and tokens)
 * - System prompt allowlist
 * - Content filtering for secrets/PII
 */
export class SamplingBridgeServer {
  private server: ReturnType<typeof createServer> | null = null;
  private bearerToken: string | null = null;
  private port: number | null = null;
  private isStarted = false;

  // Rate limiting state (protected by AsyncLock for concurrency safety)
  private roundsUsed = 0;
  private tokensUsed = 0;
  private startTime = Date.now();
  private rateLimitLock: AsyncLock;

  // Dependencies
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mcpServer: Server | any; // Allow any for test mocks
  private anthropic: Anthropic;
  private config: SamplingConfig;
  private contentFilter: ContentFilter;

  // Sampling calls tracking
  private samplingCalls: SamplingCall[] = [];

  // Active requests tracking for graceful shutdown
  private activeRequests = new Set<ServerResponse>();

  /**
   * Constructor for SamplingBridgeServer
   *
   * @param mcpServer - MCP server instance (can be mock for testing)
   * @param configOrAnthropic - Either SamplingConfig object or Anthropic client (for backward compatibility)
   * @param config - SamplingConfig object (if second param is Anthropic)
   * @param anthropicClient - Optional Anthropic client (for testing/mocking)
   */
  constructor(
    mcpServer: Server | any,
    configOrAnthropic?: SamplingConfig | Anthropic,
    config?: SamplingConfig,
    anthropicClient?: Anthropic
  ) {
    this.mcpServer = mcpServer;

    // Handle different constructor signatures for backward compatibility and testing
    if (config) {
      // Old signature: (mcpServer, anthropic, config)
      this.anthropic = configOrAnthropic as Anthropic;
      this.config = config;
    } else if (configOrAnthropic && 'enabled' in configOrAnthropic) {
      // New signature: (mcpServer, config, anthropicClient?) - for testing
      this.config = configOrAnthropic as SamplingConfig;
      // Use provided Anthropic client or create one
      this.anthropic = anthropicClient || new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY || 'dummy-key-for-development'
      });
    } else {
      // Default config if none provided
      this.config = {
        enabled: true,
        maxRoundsPerExecution: 10,
        maxTokensPerExecution: 10000,
        timeoutPerCallMs: 30000,
        allowedSystemPrompts: ['', 'You are a helpful assistant', 'You are a code analysis expert'],
        contentFilteringEnabled: true,
        allowedModels: ['claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022']
      };
      this.anthropic = anthropicClient || new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY || 'dummy-key-for-development'
      });
    }

    this.contentFilter = new ContentFilter();
    this.rateLimitLock = new AsyncLock();
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
    this.bearerToken = crypto.randomBytes(32).toString('hex');

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch(err => {
          console.error('Request handling error:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        });
      });

      // Find random available port
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
    const maxWaitTime = 5000; // 5 seconds max wait
    const startWait = Date.now();

    while (this.activeRequests.size > 0 && (Date.now() - startWait) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms and check again
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
  getSamplingMetrics(_executionId: string): SamplingMetrics {
    const totalRounds = this.roundsUsed;
    const totalTokens = this.tokensUsed;
    const totalDurationMs = Date.now() - this.startTime;
    const averageTokensPerRound = totalRounds > 0 ? totalTokens / totalRounds : 0;

    return {
      totalRounds,
      totalTokens,
      totalDurationMs,
      averageTokensPerRound,
      quotaRemaining: {
        rounds: Math.max(0, this.config.maxRoundsPerExecution - totalRounds),
        tokens: Math.max(0, this.config.maxTokensPerExecution - totalTokens)
      }
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
      const rateLimitExceeded = await this.rateLimitLock.acquire('rate-limit-check', async () => {
        if (this.roundsUsed >= this.config.maxRoundsPerExecution) {
          return { type: 'rounds' as const, exceeded: true };
        }
        // For non-streaming, also check token limit upfront
        if (this.tokensUsed >= this.config.maxTokensPerExecution) {
          return { type: 'tokens' as const, exceeded: true };
        }
        return { exceeded: false };
      });

      if (rateLimitExceeded.exceeded) {
        const metrics = this.getSamplingMetrics('current');
        res.writeHead(429, { 'Content-Type': 'application/json' });
        if (rateLimitExceeded.type === 'rounds') {
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
      if (body.systemPrompt && !this.config.allowedSystemPrompts.includes(body.systemPrompt)) {
        const truncatedPrompt = body.systemPrompt.length > 100
          ? body.systemPrompt.slice(0, 100) + '...'
          : body.systemPrompt;
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `System prompt not in allowlist: ${truncatedPrompt}`
        }));
        return;
      }

      // Call Claude API via Anthropic SDK
      const model = body.model || 'claude-3-5-haiku-20241022';

      // Validate model is in allowlist
      if (!this.config.allowedModels.includes(model)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `Model '${model}' not in allowlist. Allowed models: ${this.config.allowedModels.join(', ')}`
        }));
        return;
      }

      const maxTokens = Math.min(body.maxTokens || 1000, 10000); // Cap at 10k tokens
      const stream = body.stream === true; // Check if streaming is requested

      // Convert MCP message format to Anthropic format
      const anthropicMessages = this.convertMessagesToAnthropic(body.messages);
      const systemPrompt = body.systemPrompt;

      // Handle streaming response
      if (stream) {
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
            this.roundsUsed++;
          });

          // Create streaming request
          const streamResponse = this.anthropic.messages.stream({
            model,
            max_tokens: maxTokens,
            messages: anthropicMessages,
            ...(systemPrompt && { system: systemPrompt }),
          });

          let fullText = '';
          let inputTokens = 0;
          let outputTokens = 0;

          // Stream chunks as they arrive
          for await (const event of streamResponse) {
            if (event.type === 'message_start') {
              // Message started
            } else if (event.type === 'content_block_delta') {
              // Content chunk
              if (event.delta.type === 'text_delta') {
                const chunk = event.delta.text;
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
              }
            } else if (event.type === 'message_delta') {
              // Usage information
              if (event.usage) {
                inputTokens = event.usage.input_tokens || inputTokens;
                outputTokens = event.usage.output_tokens || outputTokens;
              }
            } else if (event.type === 'message_stop') {
              // Message complete
              const tokensUsed = inputTokens + outputTokens;
              
              // Check token limit after streaming completes
              const tokenLimitCheck = await this.rateLimitLock.acquire('rate-limit-update', async () => {
                if (this.tokensUsed + tokensUsed > this.config.maxTokensPerExecution) {
                  return { exceeded: true, metrics: this.getSamplingMetrics('current') };
                }
                this.tokensUsed += tokensUsed;
                return { exceeded: false };
              });

              if (tokenLimitCheck.exceeded) {
                // Decrement rounds since we're rejecting due to token limit
                await this.rateLimitLock.acquire('rate-limit-update', async () => {
                  this.roundsUsed--;
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
            }
          }
        } catch (error) {
          console.error('Claude API streaming error:', error);
          // Decrement rounds since stream failed
          await this.rateLimitLock.acquire('rate-limit-update', async () => {
            this.roundsUsed--;
          });
          
          try {
            res.write(`data: ${JSON.stringify({ error: 'Claude API streaming error', details: error instanceof Error ? error.message : 'Unknown error' })}\n\n`);
            res.end();
          } catch (writeError) {
            console.error('Error sending streaming error:', writeError);
          }
          return;
        }
      }

      // Non-streaming response (existing code)
      let claudeResponse: Awaited<ReturnType<typeof this.anthropic.messages.create>>;

      try {
        claudeResponse = await this.anthropic.messages.create({
          model,
          max_tokens: maxTokens,
          messages: anthropicMessages,
          ...(systemPrompt && { system: systemPrompt }),
        });
      } catch (error) {
        console.error('Claude API error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Claude API error',
          details: error instanceof Error ? error.message : 'Unknown error'
        }));
        return;
      }

      const callDuration = Date.now() - callStartTime;
      const tokensUsed = claudeResponse.usage.input_tokens + claudeResponse.usage.output_tokens;

      // Update rate limiting counters and check token limit (atomic with AsyncLock for concurrency safety)
      // Token limit is checked AFTER API call since we don't know usage until then
      const tokenLimitCheck = await this.rateLimitLock.acquire('rate-limit-update', async () => {
        // Check if adding these tokens would exceed limit
        if (this.tokensUsed + tokensUsed > this.config.maxTokensPerExecution) {
          return { exceeded: true, metrics: this.getSamplingMetrics('current') };
        }
        // Update counters
        this.roundsUsed++;
        this.tokensUsed += tokensUsed;
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

      // Convert Anthropic response to our LLMResponse format
      const llmResponse: LLMResponse = {
        content: claudeResponse.content.map(item => {
          if (item.type === 'text') {
            return { type: 'text', text: item.text };
          }
          // Handle other content types if needed
          return { type: 'text', text: JSON.stringify(item) };
        }),
        stopReason: claudeResponse.stop_reason || undefined,
        model: claudeResponse.model,
        usage: {
          inputTokens: claudeResponse.usage.input_tokens,
          outputTokens: claudeResponse.usage.output_tokens
        }
      };

      // Apply content filtering if enabled
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
        error: 'Claude API failure',
        details: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  }

  /**
   * Convert MCP message format to Anthropic message format
   */
  private convertMessagesToAnthropic(messages: LLMMessage[]): Anthropic.Messages.MessageParam[] {
    return messages.map(msg => {
      switch (msg.role) {
        case 'user':
          return {
            role: 'user',
            content: typeof msg.content === 'string' ? msg.content :
              Array.isArray(msg.content) ? msg.content.map(c =>
                c.type === 'text' ? { type: 'text', text: c.text } : c
              ) : msg.content
          };
        case 'assistant':
          return {
            role: 'assistant',
            content: typeof msg.content === 'string' ? msg.content :
              Array.isArray(msg.content) ? msg.content.map(c =>
                c.type === 'text' ? { type: 'text', text: c.text } : c
              ) : msg.content
          };
        case 'system':
          // System messages are handled separately in Anthropic API
          // They should be filtered out here and passed as system parameter
          throw new Error('System messages should be passed separately');
        default:
          throw new Error(`Unsupported message role: ${msg.role}`);
      }
    });
  }

  /**
   * Read request body as JSON
   */
  private async readRequestBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';

      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('Invalid JSON in request body'));
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

      return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
    } catch {
      return false;
    }
  }
}
