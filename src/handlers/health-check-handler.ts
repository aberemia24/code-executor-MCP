/**
 * Health Check Handler (SMELL-001 God Object Refactor)
 *
 * Handles GET /health endpoint - System health check (NEW).
 *
 * Responsibilities:
 * - Check MCP client pool status
 * - Check schema cache status
 * - Calculate uptime
 * - Return JSON health response
 *
 * Complexity: LOW (50 lines, 3 dependencies, new endpoint)
 *
 * WHY new endpoint?
 * - Standard practice: Health checks for container orchestration (Kubernetes, Docker)
 * - Monitoring: Liveness/readiness probes
 * - Debugging: Quick status overview without parsing metrics
 *
 * @see https://github.com/aberemia24/code-executor-MCP/issues/42
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { IRequestHandler, HandlerDependencies } from './request-handler.interface.js';
import type { SchemaCache } from '../schema-cache.js';

/**
 * Health check response structure
 */
export interface HealthCheckResponse {
  /** Overall health status */
  healthy: boolean;

  /** ISO 8601 timestamp */
  timestamp: string;

  /** Server uptime in milliseconds */
  uptime: number;

  /** MCP client pool status */
  mcpClients: {
    /** Number of connected MCP servers */
    connected: number;
  };

  /** Schema cache status */
  schemaCache: {
    /** Number of cached schemas */
    size: number;
  };
}

/**
 * Handles GET /health - Health Check Endpoint (NEW)
 *
 * Returns JSON status information for monitoring and debugging.
 * Useful for:
 * - Kubernetes liveness/readiness probes
 * - Docker health checks
 * - Load balancer health checks
 * - Quick debugging (is server running? are MCP clients connected?)
 */
export class HealthCheckHandler implements IRequestHandler {
  private startTime = Date.now();

  /**
   * Create health check handler
   *
   * @param options - Handler dependencies (mcpClientPool, metricsExporter, schemaCache)
   */
  constructor(
    private options: HandlerDependencies & { schemaCache: SchemaCache }
  ) {}

  /**
   * Handle GET /health request
   *
   * @param req - HTTP request
   * @param res - HTTP response
   * @param authToken - Pre-validated auth token (for audit logging)
   */
  async handle(
    _req: IncomingMessage,
    res: ServerResponse,
    _authToken: string
  ): Promise<void> {
    // Gather health information
    const tools = this.options.mcpClientPool.listAllTools();
    const cacheStats = this.options.schemaCache.getStats();

    // Build response
    const response: HealthCheckResponse = {
      healthy: tools.length > 0,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      mcpClients: {
        connected: tools.length,
      },
      schemaCache: {
        size: cacheStats.size,
      },
    };

    // Return JSON response (always 200, even if unhealthy)
    // Load balancers check response body for health status
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }
}
