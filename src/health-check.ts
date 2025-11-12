/**
 * Health Check HTTP Server for Load Balancers and Orchestrators
 *
 * Provides Kubernetes-compatible health check endpoints for production deployments.
 */

import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import type { MCPClientPool } from './mcp-client-pool.js';
import type { ConnectionPool } from './connection-pool.js';
import { VERSION } from './version.js';

/**
 * Health status response format (K8s-compatible)
 */
export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  uptime: number;
  timestamp: string;
  version?: string;
}

/**
 * Readiness check response format
 */
export interface ReadinessStatus {
  ready: boolean;
  checks: {
    mcpClients: {
      connected: number;
      ready: boolean;
    };
    connectionPool: {
      active: number;
      waiting: number;
      max: number;
      ready: boolean;
    };
  };
  timestamp: string;
}

/**
 * Liveness check response format
 */
export interface LivenessStatus {
  alive: boolean;
  timestamp: string;
}

/**
 * Health check server options
 */
export interface HealthCheckOptions {
  port?: number;
  host?: string;
  mcpClientPool: MCPClientPool;
  connectionPool: ConnectionPool;
  version?: string;
}

/**
 * HTTP Health Check Server
 *
 * Provides three endpoints:
 * - GET /health - Basic health check with uptime
 * - GET /ready - Readiness check for K8s readinessProbe
 * - GET /live - Liveness check for K8s livenessProbe
 */
export class HealthCheckServer {
  private server: Server | null = null;
  private startTime: number;
  private mcpClientPool: MCPClientPool;
  private connectionPool: ConnectionPool;
  private port: number;
  private host: string;
  private version: string;

  constructor(options: HealthCheckOptions) {
    this.startTime = Date.now();
    this.mcpClientPool = options.mcpClientPool;
    this.connectionPool = options.connectionPool;
    this.port = options.port ?? parseInt(process.env.HEALTH_CHECK_PORT ?? '3000', 10);
    this.host = options.host ?? process.env.HEALTH_CHECK_HOST ?? '0.0.0.0';
    this.version = options.version ?? VERSION;
  }

  /**
   * Get server uptime in seconds
   */
  private getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  /**
   * Handle /health endpoint
   *
   * Returns 200 OK with uptime if server is running
   */
  private handleHealth(res: ServerResponse): void {
    const status: HealthStatus = {
      status: 'ok',
      uptime: this.getUptime(),
      timestamp: new Date().toISOString(),
      version: this.version,
    };

    this.sendJSON(res, 200, status);
  }

  /**
   * Handle /ready endpoint
   *
   * Returns 200 if ready to serve requests, 503 if not ready
   * Checks:
   * - MCP clients connected
   * - Connection pool has capacity (< 90% full and no waiting requests)
   */
  private handleReady(res: ServerResponse): void {
    try {
      const tools = this.mcpClientPool.listAllTools();
      const poolStats = this.connectionPool.getStats();

      // Check if MCP clients are connected (at least 1 tool available)
      const mcpReady = tools.length > 0;

      // Check if connection pool has capacity
      // Use 90% threshold to avoid race conditions where pool becomes full
      // between readiness check and actual request
      const poolReady = poolStats.active < poolStats.max * 0.9 && poolStats.waiting === 0;

      const ready = mcpReady && poolReady;

      const status: ReadinessStatus = {
        ready,
        checks: {
          mcpClients: {
            connected: tools.length,
            ready: mcpReady,
          },
          connectionPool: {
            active: poolStats.active,
            waiting: poolStats.waiting,
            max: poolStats.max,
            ready: poolReady,
          },
        },
        timestamp: new Date().toISOString(),
      };

      // Return 503 if not ready, 200 if ready
      this.sendJSON(res, ready ? 200 : 503, status);
    } catch (error) {
      // Log error for debugging
      console.error('Health check /ready error:', error);

      // If there's an error checking readiness, return 503
      const status: ReadinessStatus = {
        ready: false,
        checks: {
          mcpClients: {
            connected: 0,
            ready: false,
          },
          connectionPool: {
            active: 0,
            waiting: 0,
            max: 0,
            ready: false,
          },
        },
        timestamp: new Date().toISOString(),
      };

      this.sendJSON(res, 503, status);
    }
  }

  /**
   * Handle /live endpoint
   *
   * Returns 200 if server is alive (simple ping)
   * No response if server is dead
   */
  private handleLive(res: ServerResponse): void {
    const status: LivenessStatus = {
      alive: true,
      timestamp: new Date().toISOString(),
    };

    this.sendJSON(res, 200, status);
  }

  /**
   * Handle 404 Not Found
   */
  private handle404(res: ServerResponse): void {
    const error = {
      error: 'Not Found',
      message: 'Available endpoints: /health, /ready, /live',
      timestamp: new Date().toISOString(),
    };

    this.sendJSON(res, 404, error);
  }

  /**
   * Send JSON response with proper headers
   */
  private sendJSON(res: ServerResponse, statusCode: number, data: unknown): void {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.end(JSON.stringify(data, null, 2));
  }

  /**
   * Request handler
   */
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // Only support GET requests
    if (req.method !== 'GET') {
      this.sendJSON(res, 405, {
        error: 'Method Not Allowed',
        message: 'Only GET requests are supported',
      });
      return;
    }

    // Route to appropriate handler
    switch (req.url) {
      case '/health':
        this.handleHealth(res);
        break;
      case '/ready':
        this.handleReady(res);
        break;
      case '/live':
        this.handleLive(res);
        break;
      default:
        this.handle404(res);
        break;
    }
  }

  /**
   * Start the health check server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = createServer((req, res) => this.handleRequest(req, res));

        // Attach error handler before calling listen() to catch all errors
        const errorHandler = (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') {
            console.error(`Health check port ${this.port} is already in use`);
          } else {
            console.error('Health check server error:', error);
          }
          // Remove listener to avoid memory leaks
          this.server?.removeListener('error', errorHandler);
          reject(error);
        };

        this.server.on('error', errorHandler);

        this.server.listen(this.port, this.host, () => {
          // Remove one-time error handler on successful start
          this.server?.removeListener('error', errorHandler);

          console.error(`Health check server listening on http://${this.host}:${this.port}`);
          console.error(`  - GET /health - Basic health check with uptime`);
          console.error(`  - GET /ready  - Readiness check (K8s readinessProbe)`);
          console.error(`  - GET /live   - Liveness check (K8s livenessProbe)`);
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the health check server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((error) => {
        if (error) {
          reject(error);
        } else {
          console.error('Health check server stopped');
          resolve();
        }
      });
    });
  }

  /**
   * Get the server port
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }
}
