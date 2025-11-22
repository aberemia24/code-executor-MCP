/**
 * Metrics Request Handler (SMELL-001 God Object Refactor)
 *
 * Handles GET /metrics endpoint - Prometheus metrics exposition format.
 *
 * Responsibilities:
 * - Fetch metrics from MetricsExporter
 * - Return Prometheus text format
 * - Handle errors gracefully
 *
 * Complexity: LOW (30 lines, 1 dependency, simple logic)
 *
 * WHY separate handler?
 * - Single Responsibility Principle: Only concerned with metrics endpoint
 * - Easy to test: Mock MetricsExporter, verify response format
 * - Easy to modify: Change metrics format without touching other endpoints
 *
 * @see https://github.com/aberemia24/code-executor-MCP/issues/42
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { IRequestHandler } from './request-handler.interface.js';
import type { MetricsExporter } from '../metrics-exporter.js';
import { normalizeError } from '../utils.js';

/**
 * Handles GET /metrics - Prometheus Metrics Endpoint
 *
 * Returns Prometheus exposition format metrics for monitoring:
 * - Cache metrics (hits/misses)
 * - HTTP metrics (requests, duration)
 * - Circuit breaker metrics (state)
 * - Connection pool metrics (active connections, queue depth)
 *
 * SECURITY: Authentication validated by MCPProxyServer before routing.
 * Metrics endpoints expose operational data that can be used for
 * reconnaissance attacks (cache patterns, usage rates, resource limits).
 */
export class MetricsRequestHandler implements IRequestHandler {
  /**
   * Create metrics request handler
   *
   * @param metricsExporter - Prometheus metrics exporter
   */
  constructor(private metricsExporter: MetricsExporter) {}

  /**
   * Handle GET /metrics request
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
    try {
      // Fetch Prometheus metrics from exporter
      const metrics = await this.metricsExporter.getMetrics();

      // Return Prometheus text format
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
      res.end(metrics);
    } catch (error) {
      // Error handling: Return 500 with JSON error
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: normalizeError(error, 'Metrics request failed').message,
        })
      );
    }
  }
}
