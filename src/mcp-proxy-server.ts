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

// SMELL-001: Import handler classes
import { MetricsRequestHandler } from './handlers/metrics-request-handler.js';
import { HealthCheckHandler } from './handlers/health-check-handler.js';
import { DiscoveryRequestHandler } from './handlers/discovery-request-handler.js';
import { ToolExecutionHandler } from './handlers/tool-execution-handler.js';

// Configuration constants
const MAX_SEARCH_QUERY_LENGTH = 100; // Maximum characters allowed in search query (prevents DoS)

// Rate limiting (spec.md NFR-2)
// WHY 30 requests? Prevents sandbox code from overwhelming MCP servers with burst requests
// WHY 60s window? Balances burst capacity vs sustained load protection
const RATE_LIMIT_MAX_REQUESTS = 30;
const RATE_LIMIT_WINDOW_MS = 60_000; // 60 seconds

// Graceful shutdown (P1 race condition fix - 2025-11-14)
// WHY 5s drain timeout? Matches typical HTTP request timeout (most requests complete within 5s)
// WHY 1s force close? Safety valve for hung connections (should rarely trigger)
const DRAIN_TIMEOUT_MS = 5_000; // 5 seconds
const FORCE_CLOSE_TIMEOUT_MS = 1_000; // 1 second

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

  // SMELL-001: Handler instances (SRP refactoring)
  private metricsHandler: MetricsRequestHandler;
  private healthHandler: HealthCheckHandler;
  private discoveryHandler: DiscoveryRequestHandler;
  private executionHandler: ToolExecutionHandler;

  // Shared dependencies (still needed for start() and delegation)
  private tracker: ToolCallTracker;
  private schemaCache: SchemaCache;

  // P1: Request tracking for graceful shutdown
  private activeRequests = 0; // Track in-flight HTTP requests
  private draining = false; // Flag to reject new requests during shutdown
  private drainResolvers: (() => void)[] = []; // Event-driven drain signaling

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
    // SMELL-001 Refactoring: Create shared dependencies first
    const validator = new AllowlistValidator(allowedTools);
    this.tracker = new ToolCallTracker();
    this.schemaCache = new SchemaCache(mcpClientPool);
    const schemaValidator = new SchemaValidator();
    const rateLimiter = new RateLimiter({
      maxRequests: RATE_LIMIT_MAX_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    const metrics = metricsExporter || new MetricsExporter();

    // Generate authentication token
    this.authToken = crypto.randomBytes(32).toString('hex');

    // SMELL-001: Initialize handler instances (Dependency Injection pattern)
    this.metricsHandler = new MetricsRequestHandler(metrics);

    this.healthHandler = new HealthCheckHandler({
      mcpClientPool,
      metricsExporter: metrics,
      schemaCache: this.schemaCache,
    });

    this.discoveryHandler = new DiscoveryRequestHandler({
      mcpClientPool,
      metricsExporter: metrics,
      schemaCache: this.schemaCache,
      rateLimiter,
      discoveryTimeoutMs,
    });

    this.executionHandler = new ToolExecutionHandler({
      mcpClientPool,
      metricsExporter: metrics,
      allowlistValidator: validator,
      toolCallTracker: this.tracker,
      schemaCache: this.schemaCache,
      schemaValidator,
    });
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
        // P1: Track active requests for graceful shutdown
        this.activeRequests++;

        try {
          // P1: Reject new requests during shutdown
          if (this.draining) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'Service Unavailable - server is shutting down',
            }));
            return;
          }

          // SECURITY: Validate bearer token authentication (constant-time comparison)
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

          // Parse URL to route requests
          const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
          const pathname = url.pathname;

          // SMELL-001: Route to handler instances (SRP delegation)
          // Route: GET /metrics → Prometheus metrics endpoint
          if (req.method === 'GET' && pathname === '/metrics') {
            await this.metricsHandler.handle(req, res, this.authToken);
            return;
          }

          // Route: GET /health → Health check endpoint (NEW)
          if (req.method === 'GET' && pathname === '/health') {
            await this.healthHandler.handle(req, res, this.authToken);
            return;
          }

          // Route: GET /mcp/tools → Discovery endpoint
          if (req.method === 'GET' && pathname === '/mcp/tools') {
            await this.discoveryHandler.handle(req, res, this.authToken);
            return;
          }

          // Route: POST / → Tool execution endpoint
          if (req.method === 'POST' && pathname === '/') {
            await this.executionHandler.handle(req, res, this.authToken);
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
              'GET /health - Health check',
            ],
          }));
        } finally {
          // P1: Decrement active requests and signal drain waiters
          this.activeRequests--;

          // Signal drain waiters when all requests complete
          if (this.activeRequests === 0 && this.draining) {
            this.drainResolvers.forEach(resolve => resolve());
            this.drainResolvers = [];
          }
        }
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
   * Drain active requests gracefully
   *
   * P1: Wait for all active HTTP requests to complete before shutdown.
   * Uses event-driven signaling (not polling) for efficient waiting.
   * Same pattern as ConnectionPool.drain()
   *
   * @param timeoutMs - Maximum time to wait for requests to drain (default: 30s)
   * @returns Promise that resolves when all requests drained or timeout reached
   */
  async drain(timeoutMs: number = 30000): Promise<void> {
    // Set draining flag to reject new requests
    this.draining = true;

    // P1: Event-driven wait (not polling) - more efficient than 100ms polls
    if (this.activeRequests > 0) {
      await Promise.race([
        // Wait for drain signal from request completion
        new Promise<void>((resolve) => {
          this.drainResolvers.push(resolve);
        }),
        // Timeout protection
        new Promise<void>((resolve) => {
          setTimeout(() => {
            console.error(
              `⚠️ HTTP server drain timeout after ${timeoutMs}ms ` +
              `(${this.activeRequests} requests still active - forcing shutdown)`
            );
            resolve();
          }, timeoutMs);
        })
      ]);
    }

    if (this.activeRequests === 0) {
      console.log('✓ HTTP server drained successfully (all requests completed)');
    }
  }

  /**
   * Stop proxy server
   *
   * P1 FIX: Drain active requests before closing server to prevent race condition.
   * Closes the HTTP server and releases the port.
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    // P1: Drain active requests first (wait for in-flight requests to complete)
    await this.drain(DRAIN_TIMEOUT_MS);

    // Then close the HTTP server
    return new Promise((resolve) => {
      // Force close if graceful close hangs (see constants for WHY timeout value)
      const forceCloseTimeout = setTimeout(() => {
        console.error('⚠️ HTTP server close timed out, forcing shutdown');
        resolve();
      }, FORCE_CLOSE_TIMEOUT_MS);

      this.server!.close(() => {
        clearTimeout(forceCloseTimeout);
        resolve();
      });

      // Also destroy all sockets to force immediate closure
      // This prevents hanging if there are keep-alive connections
      this.server!.closeAllConnections?.();
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
   * SMELL-001: Delegates to ToolExecutionHandler
   * Used for audit logging and tracking tool usage.
   */
  getToolCalls(): string[] {
    return this.executionHandler.getToolCalls();
  }

  /**
   * Get aggregated summary of tool invocations
   *
   * SMELL-001: Delegates to ToolExecutionHandler
   */
  getToolCallSummary(): ToolCallSummaryEntry[] {
    return this.executionHandler.getToolCallSummary();
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
  }}
