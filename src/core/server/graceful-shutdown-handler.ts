/**
 * Graceful Shutdown Handler for Production Deployments
 *
 * US10 (FR-10): Graceful Shutdown Handling
 *
 * Handles SIGTERM/SIGINT signals for clean shutdown:
 * - Stops accepting new requests (503 Service Unavailable)
 * - Drains in-flight and queued requests
 * - Flushes audit logs
 * - Closes server connections
 * - Exits with appropriate code (0=success, 1=timeout)
 *
 * Constitutional Principle 2 (Security Zero Tolerance):
 * - No data loss on shutdown
 * - Audit logs flushed before exit
 *
 * @see https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination
 */

import type { Server } from 'http';
import type { IAuditLogger } from './interfaces/audit-logger.js';

/**
 * Connection Queue interface (minimal - for type safety)
 */
interface ConnectionQueue {
  size: number;
  drain?(): Promise<void>;
}

/**
 * Graceful Shutdown Handler Options
 */
export interface GracefulShutdownOptions {
  /** HTTP server to shutdown */
  server: Server;
  /** Drain timeout in milliseconds (default: 30000 = 30s) */
  drainTimeoutMs?: number;
  /** Optional connection queue to drain */
  connectionQueue?: ConnectionQueue;
  /** Optional audit logger to flush */
  auditLogger?: IAuditLogger;
}

/**
 * Graceful Shutdown Handler
 *
 * Implements graceful shutdown pattern for production deployments:
 * 1. Receive SIGTERM/SIGINT signal
 * 2. Stop accepting new requests
 * 3. Drain connection queue (waiting requests)
 * 4. Wait for in-flight requests to complete
 * 5. Flush audit logs
 * 6. Close server
 * 7. Exit with code 0 (success) or 1 (timeout)
 *
 * USAGE:
 * ```typescript
 * const shutdownHandler = new GracefulShutdownHandler({
 *   server: httpServer,
 *   drainTimeoutMs: 30000,
 *   connectionQueue,
 *   auditLogger
 * });
 *
 * shutdownHandler.register();
 * ```
 */
export class GracefulShutdownHandler {
  private server: Server;
  private drainTimeoutMs: number;
  private connectionQueue?: ConnectionQueue;
  private auditLogger?: IAuditLogger;
  private isShuttingDownFlag = false;
  private shutdownInitiated = false;

  constructor(options: GracefulShutdownOptions) {
    this.server = options.server;

    // T108: Default drain timeout: 30 seconds
    // WHY: Kubernetes default terminationGracePeriodSeconds is 30s
    // AWS ALB deregistration delay is also 30s default
    this.drainTimeoutMs = options.drainTimeoutMs ?? 30000;

    this.connectionQueue = options.connectionQueue;
    this.auditLogger = options.auditLogger;
  }

  /**
   * T107: Register SIGTERM and SIGINT handlers
   *
   * WHY: Kubernetes sends SIGTERM for pod termination
   * Docker stop sends SIGTERM
   * Ctrl+C sends SIGINT
   *
   * Both signals should trigger graceful shutdown
   */
  register(): void {
    // T107: SIGTERM handler (production)
    process.on('SIGTERM', () => {
      console.error('Received SIGTERM signal, initiating graceful shutdown...');
      this.shutdown().catch(error => {
        console.error('Error during graceful shutdown:', error);
        process.exit(1);
      });
    });

    // T107: SIGINT handler (development/Ctrl+C)
    process.on('SIGINT', () => {
      console.error('Received SIGINT signal, initiating graceful shutdown...');
      this.shutdown().catch(error => {
        console.error('Error during graceful shutdown:', error);
        process.exit(1);
      });
    });
  }

  /**
   * T102: Check if shutdown is in progress
   *
   * Used by middleware to reject new requests with 503
   *
   * @returns True if shutting down
   */
  isShuttingDown(): boolean {
    return this.isShuttingDownFlag;
  }

  /**
   * T109: Get shutdown message for 503 responses
   *
   * @returns Human-readable shutdown message
   */
  getShutdownMessage(): string {
    return 'Server is shutting down, please retry your request';
  }

  /**
   * T106-T112: Execute graceful shutdown sequence
   *
   * Steps:
   * 1. Set shutting down flag (reject new requests)
   * 2. T111: Log shutdown event to audit log
   * 3. T110: Stop accepting new connections (server.close())
   * 4. T104: Drain connection queue (waiting requests)
   * 5. T103: Wait for in-flight requests (with timeout)
   * 6. T111: Flush audit logs
   * 7. T112: Exit with code 0 (success) or 1 (timeout)
   *
   * @returns Exit code (0=success, 1=timeout)
   */
  async shutdown(): Promise<number> {
    // Prevent multiple shutdowns
    if (this.shutdownInitiated) {
      return 0;
    }

    this.shutdownInitiated = true;
    this.isShuttingDownFlag = true;

    console.error('Starting graceful shutdown...');

    try {
      // T111: Log shutdown event
      if (this.auditLogger) {
        await this.auditLogger.log({
          timestamp: new Date().toISOString(),
          correlationId: 'shutdown',
          eventType: 'shutdown',
          status: 'success',
          metadata: {
            drainTimeoutMs: this.drainTimeoutMs
          }
        }).catch(error => {
          console.error('Failed to log shutdown event:', error);
        });
      }

      // Create timeout promise
      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          console.error(`Shutdown timeout after ${this.drainTimeoutMs}ms`);
          resolve();
        }, this.drainTimeoutMs);
      });

      // Create shutdown tasks
      const shutdownTasks: Promise<void>[] = [];

      // T110: Stop accepting new connections
      const serverClosePromise = new Promise<void>((resolve, reject) => {
        if (!this.server.listening) {
          resolve();
          return;
        }

        this.server.close((error) => {
          if (error) {
            console.error('Error closing server:', error);
            reject(error);
          } else {
            console.error('Server stopped accepting new connections');
            resolve();
          }
        });
      });

      shutdownTasks.push(serverClosePromise);

      // T104: Drain connection queue
      if (this.connectionQueue && this.connectionQueue.size > 0) {
        console.error(`Draining connection queue (${this.connectionQueue.size} waiting)...`);

        if (this.connectionQueue.drain) {
          shutdownTasks.push(
            this.connectionQueue.drain().then(() => {
              console.error('Connection queue drained');
            })
          );
        }
      }

      // T103: Wait for all tasks with timeout
      const shutdownSuccess = await Promise.race([
        Promise.all(shutdownTasks).then(() => true),
        timeoutPromise.then(() => false)
      ]);

      // T111: Flush audit logs
      if (this.auditLogger) {
        console.error('Flushing audit logs...');
        await this.auditLogger.flush();
      }

      if (!shutdownSuccess) {
        console.error('Graceful shutdown timed out, forcing exit');
        // T112: Exit with code 1 (timeout)
        process.exit(1);
        return 1;
      }

      console.error('Graceful shutdown complete');

      // T112: Exit with code 0 (success)
      process.exit(0);
      return 0;

    } catch (error) {
      console.error('Error during graceful shutdown:', error);

      // T112: Exit with code 1 (error)
      process.exit(1);
      return 1;
    }
  }
}
