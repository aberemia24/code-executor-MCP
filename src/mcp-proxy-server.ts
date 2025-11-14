/**
 * MCP Proxy Server
 *
 * HTTP server that proxies MCP tool calls from sandboxed code execution environments.
 * Shared by TypeScript (Deno) and Python executors.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { normalizeError } from './utils.js';
import { AllowlistValidator, ToolCallTracker } from './proxy-helpers.js';
import { SchemaCache } from './schema-cache.js';
import { SchemaValidator } from './schema-validator.js';
import { RateLimiter } from './rate-limiter.js';
import { MetricsExporter } from './metrics-exporter.js';
import type { MCPClientPool } from './mcp-client-pool.js';
import type { ToolCallSummaryEntry } from './types.js';

// Configuration constants
const MAX_SEARCH_QUERY_LENGTH = 100; // Maximum characters allowed in search query

/**
 * MCP proxy server that handles callMCPTool requests from sandbox
 *
 * Architecture:
 * - Sandbox (Deno/Python) → HTTP POST → MCPProxyServer → MCPClientPool → MCP tools
 * - Provides callMCPTool() / call_mcp_tool() function injected into sandbox
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
export class MCPProxyServer {
  private server: http.Server | null = null;
  private port = 0;
  private authToken: string;
  private validator: AllowlistValidator;
  private tracker: ToolCallTracker;
  private schemaCache: SchemaCache;
  private schemaValidator: SchemaValidator;
  private rateLimiter: RateLimiter;
  private metricsExporter: MetricsExporter;
  private discoveryTimeoutMs: number;

  /**
   * Create MCP proxy server
   *
   * @param mcpClientPool - Pool of MCP clients to proxy requests to
   * @param allowedTools - Whitelist of allowed MCP tool names
   * @param metricsExporter - Prometheus metrics exporter for observability (optional)
   * @param discoveryTimeoutMs - Timeout for discovery endpoint queries in milliseconds (default: 500ms)
   *
   * SECURITY: Generates random bearer token for authentication
   */
  constructor(
    private mcpClientPool: MCPClientPool,
    allowedTools: string[],
    metricsExporter?: MetricsExporter,
    discoveryTimeoutMs: number = 500
  ) {
    this.validator = new AllowlistValidator(allowedTools);
    this.tracker = new ToolCallTracker();
    this.schemaCache = new SchemaCache(mcpClientPool);
    this.schemaValidator = new SchemaValidator();
    // Rate limiter: 30 requests per 60 seconds (per spec.md NFR-2)
    this.rateLimiter = new RateLimiter({
      maxRequests: 30,
      windowMs: 60000, // 60 seconds
    });
    // Metrics exporter (default to new instance if not provided)
    this.metricsExporter = metricsExporter || new MetricsExporter();
    // Discovery timeout configuration
    this.discoveryTimeoutMs = discoveryTimeoutMs;
    // Generate cryptographically secure random token (32 bytes = 64 hex chars)
    this.authToken = crypto.randomBytes(32).toString('hex');
  }

  /**
   * Start proxy server on random port
   *
   * SECURITY: Returns both port and authentication token.
   * The sandbox code will connect to localhost:<port> with Bearer token.
   *
   * Pre-populates schema cache before starting to ensure fast validation.
   *
   * @returns Object with port number and auth token
   */
  async start(): Promise<{ port: number; authToken: string }> {
    // Pre-populate schema cache (loads from disk + fetches missing/expired)
    await this.schemaCache.prePopulate();

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // Parse URL to route requests
        const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
        const pathname = url.pathname;

        // Route: GET /metrics → Prometheus metrics endpoint
        if (req.method === 'GET' && pathname === '/metrics') {
          await this.handleMetricsRequest(req, res);
          return;
        }

        // Route: GET /mcp/tools → Discovery endpoint
        if (req.method === 'GET' && pathname === '/mcp/tools') {
          await this.handleDiscoveryRequest(req, res);
          return;
        }

        // Route: POST / → Tool execution endpoint (existing)
        if (req.method === 'POST' && pathname === '/') {
          await this.handleCallMCPTool(req, res);
          return;
        }

        // Unrecognized route → 404 Not Found
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Not Found',
          validRoutes: [
            'POST / - Execute MCP tool',
            'GET /mcp/tools - Discover available tools',
            'GET /metrics - Prometheus metrics',
          ],
        }));
      });

      // FIX: Add error handler to prevent Promise from hanging on listen() failures
      // Root cause: server.listen() callback only fires on success, not on errors
      // Remove error handler after successful bind to prevent memory leaks
      const errorHandler = (error: Error) => {
        reject(normalizeError(error, 'Failed to bind server to port'));
      };

      this.server.once('error', errorHandler);

      // SECURITY: Bind explicitly to 127.0.0.1 (not just 'localhost')
      this.server.listen(0, '127.0.0.1', () => {
        // Remove error handler after successful bind
        this.server?.removeListener('error', errorHandler);

        if (!this.server) {
          reject(new Error('Server is not initialized'));
          return;
        }
        const address = this.server.address();
        if (address && typeof address !== 'string') {
          this.port = address.port;
          resolve({ port: this.port, authToken: this.authToken });
        } else {
          reject(new Error('Failed to get server port'));
        }
      });
    });
  }

  /**
   * Stop proxy server
   *
   * Closes the HTTP server and releases the port.
   * FIX: Add timeout to prevent hanging on server.close() waiting for connections
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      // Force close after 1 second if graceful close hangs
      const forceCloseTimeout = setTimeout(() => {
        console.error('⚠️ HTTP server close timed out, forcing shutdown');
        resolve();
      }, 1000);

      this.server.close(() => {
        clearTimeout(forceCloseTimeout);
        resolve();
      });

      // Also destroy all sockets to force immediate closure
      // This prevents hanging if there are keep-alive connections
      this.server.closeAllConnections?.();
    });
  }

  /**
   * Get the port number the server is listening on
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Get the authentication token
   *
   * SECURITY: Used to inject token into sandbox environment
   */
  getAuthToken(): string {
    return this.authToken;
  }

  /**
   * Get list of all MCP tool calls made through this proxy
   *
   * Used for audit logging and tracking tool usage.
   */
  getToolCalls(): string[] {
    return this.tracker.getCalls();
  }

  /**
   * Get aggregated summary of tool invocations
   */
  getToolCallSummary(): ToolCallSummaryEntry[] {
    return this.tracker.getSummary();
  }


  /**
   * Validate bearer token using constant-time comparison
   *
   * SECURITY: Prevents timing attacks that could be used to brute-force the token.
   * Uses crypto.timingSafeEqual to ensure comparison takes constant time regardless
   * of where strings differ.
   *
   * @param authHeader - Authorization header value (e.g., "Bearer <token>")
   * @returns True if token is valid, false otherwise
   */
  private validateBearerToken(authHeader: string | undefined): boolean {
    if (!authHeader) {
      return false;
    }

    // Parse Bearer token
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return false;
    }

    const providedToken = parts[1];
    if (!providedToken) {
      return false;
    }

    // Constant-time comparison to prevent timing attacks
    try {
      const providedBuffer = Buffer.from(providedToken, 'utf8');
      const validBuffer = Buffer.from(this.authToken, 'utf8');

      // timingSafeEqual throws if lengths differ, so check length first
      if (providedBuffer.length !== validBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(providedBuffer, validBuffer);
    } catch {
      // Any error (including length mismatch) returns false
      return false;
    }
  }

  /**
   * Handle POST / - Call MCP Tool (existing functionality)
   *
   * SECURITY: Enforces allowlist validation (execution requires explicit permission)
   */
  private async handleCallMCPTool(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const startTime = process.hrtime.bigint();

    // SECURITY: Validate bearer token authentication (constant-time comparison)
    const authHeader = req.headers['authorization'];
    if (!this.validateBearerToken(authHeader)) {
      const duration = Number(process.hrtime.bigint() - startTime) / 1e9; // Convert to seconds
      this.metricsExporter.recordHttpRequest('POST', 401);
      this.metricsExporter.recordHttpDuration('POST', '/', duration);

      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Unauthorized - invalid or missing authentication token',
        })
      );
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
        const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
        this.metricsExporter.recordHttpRequest('POST', 403);
        this.metricsExporter.recordHttpDuration('POST', '/', duration);

        const allowedTools = this.validator.getAllowedTools();
        res.writeHead(403);
        res.end(
          JSON.stringify({
            error: `Tool '${toolName}' not in allowlist`,
            allowedTools:
              allowedTools.length > 0
                ? allowedTools
                : ['(empty - no tools allowed)'],
            suggestion: `Add '${toolName}' to allowedTools array`,
          })
        );
        return;
      }

      // Validate parameters against schema
      const schema = await this.schemaCache.getToolSchema(toolName);
      if (schema) {
        const validation = this.schemaValidator.validate(params, schema);
        if (!validation.valid) {
          const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
          this.metricsExporter.recordHttpRequest('POST', 400);
          this.metricsExporter.recordHttpDuration('POST', '/', duration);

          const errorMessage = this.schemaValidator.formatError(
            toolName,
            params,
            schema,
            validation
          );
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: errorMessage }));
          return;
        }
      }

      const start = process.hrtime.bigint();
      try {
        // Call MCP tool through pool
        const result = await this.mcpClientPool.callTool(toolName, params);

        const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
        this.tracker.track(toolName, {
          durationMs,
          status: 'success',
        });

        // Record successful request metrics
        const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
        this.metricsExporter.recordHttpRequest('POST', 200);
        this.metricsExporter.recordHttpDuration('POST', '/', duration);

        // Return result
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result }));
        return;
      } catch (toolError) {
        const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
        const normalized = normalizeError(toolError, 'MCP tool call failed');

        this.tracker.track(toolName, {
          durationMs,
          status: 'error',
          errorMessage: normalized.message,
        });

        // Record error request metrics
        const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
        this.metricsExporter.recordHttpRequest('POST', 500);
        this.metricsExporter.recordHttpDuration('POST', '/', duration);

        res.writeHead(500);
        res.end(
          JSON.stringify({
            error: normalized.message,
          })
        );
        return;
      }
    } catch (error) {
      const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
      this.metricsExporter.recordHttpRequest('POST', 500);
      this.metricsExporter.recordHttpDuration('POST', '/', duration);

      res.writeHead(500);
      res.end(
        JSON.stringify({
          error: normalizeError(error, 'MCP tool call failed').message,
        })
      );
    }
  }

  /**
   * Handle GET /mcp/tools - Discovery Endpoint
   *
   * SECURITY EXCEPTION (BY DESIGN - Constitutional Principle 2):
   * This endpoint BYPASSES the allowlist to enable in-sandbox tool discovery.
   *
   * JUSTIFICATION (from spec.md Section 2):
   * - Discovery returns READ-ONLY metadata (tool names, descriptions, parameters)
   * - Execution (callMCPTool) STILL requires allowlist validation
   * - Trade-off: Self-service discovery vs explicit permission model
   * - Risk assessment: LOW (discovery ≠ execution, no side effects)
   *
   * See spec.md Section 2 "Constitutional Exceptions" for full rationale.
   */
  private async handleDiscoveryRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const startTime = process.hrtime.bigint();

    try {
      // SECURITY: Validate bearer token authentication
      const authHeader = req.headers['authorization'];
      if (!this.validateBearerToken(authHeader)) {
        const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
        this.metricsExporter.recordHttpRequest('GET', 401);
        this.metricsExporter.recordHttpDuration('GET', '/mcp/tools', duration);

        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Unauthorized - invalid or missing authentication token',
          })
        );
        return;
      }

      // Rate limiting: Check limit for this client
      // NOTE: Uses 'default' as client ID because each sandbox execution creates
      // its own isolated MCPProxyServer instance. The proxy is single-client by design
      // (only the sandbox process connects), so per-client tracking is unnecessary.
      // Rate limit applies to the single sandbox execution, not across multiple clients.
      const rateLimit = await this.rateLimiter.checkLimit('default');
      if (!rateLimit.allowed) {
        const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
        this.metricsExporter.recordHttpRequest('GET', 429);
        this.metricsExporter.recordHttpDuration('GET', '/mcp/tools', duration);

        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Rate limit exceeded',
            retryAfter: Math.ceil(rateLimit.resetIn / 1000), // seconds
            limit: 30,
            window: '60s',
          })
        );
        return;
      }

      // Parse query parameters from URL
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      const searchParams = url.searchParams.getAll('q'); // Get all ?q= parameters

      // Validate search queries
      const validationError = this.validateSearchQuery(searchParams);
      if (validationError) {
        const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
        this.metricsExporter.recordHttpRequest('GET', 400);
        this.metricsExporter.recordHttpDuration('GET', '/mcp/tools', duration);

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(validationError));
        return;
      }

      // Fetch all tool schemas from MCPClientPool with configured timeout
      let timeoutHandle: NodeJS.Timeout | null = null;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Request timeout after ${this.discoveryTimeoutMs}ms`)),
          this.discoveryTimeoutMs
        );
      });

      const toolsPromise = this.mcpClientPool.listAllToolSchemas(this.schemaCache);

      let allTools;
      try {
        allTools = await Promise.race([toolsPromise, timeoutPromise]);
      } finally {
        // FIX: Clear timeout to prevent memory leaks (race condition)
        // If toolsPromise resolves first, timeout would otherwise remain active
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }

      // Filter tools by search keywords (OR logic, case-insensitive)
      const filteredTools = this.filterToolsByKeywords(allTools, searchParams);

      // Audit log: Discovery request
      console.error(JSON.stringify({
        action: 'discovery',
        endpoint: '/mcp/tools',
        searchTerms: searchParams,
        resultsCount: filteredTools.length,
        clientId: 'default',
        timestamp: new Date().toISOString(),
      }));

      // Record successful request metrics
      const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
      this.metricsExporter.recordHttpRequest('GET', 200);
      this.metricsExporter.recordHttpDuration('GET', '/mcp/tools', duration);

      // Return JSON response with tool schemas
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          tools: filteredTools,
        })
      );
    } catch (error) {
      // Record error metrics
      const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
      this.metricsExporter.recordHttpRequest('GET', 500);
      this.metricsExporter.recordHttpDuration('GET', '/mcp/tools', duration);

      // Error handling
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: normalizeError(error, 'Discovery request failed').message,
        })
      );
    }
  }

  /**
   * Validate search query parameters (SRP helper)
   *
   * @param queries - Array of search query strings
   * @returns Error object if validation fails, null if valid
   */
  private validateSearchQuery(queries: string[]): { error: string; query?: string } | null {
    for (const query of queries) {
      // Max length validation
      if (query.length > MAX_SEARCH_QUERY_LENGTH) {
        return {
          error: `Search query too long (max ${MAX_SEARCH_QUERY_LENGTH} characters)`,
          query,
        };
      }

      // Allowed characters: alphanumeric, spaces, hyphens, underscores
      const validPattern = /^[a-zA-Z0-9\s\-_]+$/;
      if (!validPattern.test(query)) {
        return {
          error:
            'Invalid characters in search query (allowed: alphanumeric, spaces, hyphens, underscores)',
          query,
        };
      }
    }

    return null; // All queries valid
  }

  /**
   * Filter tools by search keywords using OR logic (SRP helper)
   *
   * @param tools - Array of tool schemas to filter
   * @param keywords - Array of search keywords
   * @returns Filtered tools matching any keyword (case-insensitive)
   */
  private filterToolsByKeywords(
    tools: Array<{ name: string; description: string; parameters: unknown }>,
    keywords: string[]
  ): Array<{ name: string; description: string; parameters: unknown }> {
    // No keywords = return all tools
    if (keywords.length === 0) {
      return tools;
    }

    // Filter using OR logic: tool matches if ANY keyword is found
    return tools.filter((tool) => {
      const searchText = `${tool.name} ${tool.description}`.toLowerCase();
      return keywords.some((keyword) => searchText.includes(keyword.toLowerCase()));
    });
  }

  /**
   * Handle GET /metrics - Prometheus Metrics Endpoint
   *
   * Returns Prometheus exposition format metrics for monitoring:
   * - Cache metrics (hits/misses)
   * - HTTP metrics (requests, duration)
   * - Circuit breaker metrics (state)
   * - Connection pool metrics (active connections, queue depth)
   *
   * SECURITY: Requires authentication by default. Metrics endpoints expose
   * operational data that can be used for reconnaissance attacks.
   *
   * WHY: Information disclosure risk - metrics reveal:
   * - Cache access patterns (schema usage profiling)
   * - HTTP request rates (usage patterns, attack surface)
   * - Circuit breaker states (MCP server availability)
   * - Connection pool capacity (resource limits)
   *
   * CONSTITUTIONAL COMPLIANCE: Aligns with Principle 2 (Security Zero Tolerance)
   */
  private async handleMetricsRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // SECURITY: Validate bearer token authentication
    const authHeader = req.headers['authorization'];
    if (!this.validateBearerToken(authHeader)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Unauthorized - invalid or missing authentication token',
          hint: 'Provide Authorization: Bearer <token> header',
        })
      );
      return;
    }

    try {
      const metrics = await this.metricsExporter.getMetrics();

      // Return Prometheus text format
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
      res.end(metrics);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: normalizeError(error, 'Metrics request failed').message,
        })
      );
    }
  }
}
