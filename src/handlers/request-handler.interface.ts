/**
 * Request Handler Interface (SMELL-001 God Object Refactor)
 *
 * Base interface for HTTP request handlers extracted from MCPProxyServer.
 * Follows Single Responsibility Principle - each handler manages one endpoint.
 *
 * Constitutional Principle 5 (SOLID):
 * - Interface Segregation Principle: Specific interface per handler
 * - Dependency Inversion Principle: Handlers depend on abstractions
 *
 * @see https://github.com/aberemia24/code-executor-MCP/issues/42
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { MCPClientPool } from '../mcp-client-pool.js';
import type { MetricsExporter } from '../metrics-exporter.js';

/**
 * HTTP request handler interface
 *
 * All handlers implement this contract to process HTTP requests.
 * MCPProxyServer routes requests to appropriate handler based on path/method.
 *
 * WHY authToken parameter?
 * Authentication is validated ONCE in MCPProxyServer before routing.
 * Handlers receive validated token for logging/audit purposes.
 */
export interface IRequestHandler {
  /**
   * Handle incoming HTTP request
   *
   * @param req - Incoming HTTP request
   * @param res - HTTP response to write to
   * @param authToken - Pre-validated authentication token
   * @returns Promise that resolves when response is sent
   * @throws Error on validation or execution failures
   */
  handle(
    req: IncomingMessage,
    res: ServerResponse,
    authToken: string
  ): Promise<void>;
}

/**
 * Shared dependencies for all handlers
 *
 * WHY shared?
 * - All handlers need to call MCP tools (mcpClientPool)
 * - All handlers need to record metrics (metricsExporter)
 */
export interface HandlerDependencies {
  /** MCP client pool for executing tool calls */
  mcpClientPool: MCPClientPool;

  /** Metrics exporter for Prometheus observability */
  metricsExporter: MetricsExporter;
}
