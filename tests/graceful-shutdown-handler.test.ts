/**
 * Tests for Graceful Shutdown Handler
 *
 * US10 (FR-10): Graceful Shutdown Handling
 * Validates SIGTERM/SIGINT handling, request draining, and clean shutdown
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GracefulShutdownHandler } from '../src/graceful-shutdown-handler.js';
import type { Server } from 'http';

describe('GracefulShutdownHandler (US10: FR-10)', () => {
  let shutdownHandler: GracefulShutdownHandler;
  let mockServer: Server;
  let mockSignalHandler: ((signal: string) => void) | null = null;

  beforeEach(() => {
    // Mock HTTP server
    mockServer = {
      close: vi.fn((callback?: (err?: Error) => void) => {
        if (callback) callback();
      }),
      listening: true
    } as unknown as Server;

    // Capture signal handlers for testing
    vi.spyOn(process, 'on').mockImplementation((event: string, handler: any) => {
      if (event === 'SIGTERM' || event === 'SIGINT') {
        mockSignalHandler = handler;
      }
      return process;
    });

    // Mock process.exit to prevent actual exit in tests
    vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      return undefined as never;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockSignalHandler = null;
  });

  /**
   * T101: SIGTERM Handler Registration Test
   *
   * ACCEPTANCE CRITERIA:
   * - Must register SIGTERM handler on initialization
   * - Must register SIGINT handler on initialization
   * - Handler should trigger graceful shutdown
   * - Multiple calls should not register duplicate handlers
   */
  describe('Signal Handler Registration (T101)', () => {
    it('should_registerSIGTERMHandler_when_initialized', () => {
      shutdownHandler = new GracefulShutdownHandler({
        server: mockServer,
        drainTimeoutMs: 30000
      });

      shutdownHandler.register();

      // Verify SIGTERM handler registered
      expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    });

    it('should_registerSIGINTHandler_when_initialized', () => {
      shutdownHandler = new GracefulShutdownHandler({
        server: mockServer,
        drainTimeoutMs: 30000
      });

      shutdownHandler.register();

      // Verify SIGINT handler registered
      expect(process.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    });

    it('should_triggerShutdown_when_SIGTERMReceived', async () => {
      shutdownHandler = new GracefulShutdownHandler({
        server: mockServer,
        drainTimeoutMs: 1000 // Short timeout for testing
      });

      const shutdownSpy = vi.spyOn(shutdownHandler, 'shutdown');

      shutdownHandler.register();

      // Simulate SIGTERM
      if (mockSignalHandler) {
        await mockSignalHandler('SIGTERM');
      }

      expect(shutdownSpy).toHaveBeenCalled();
    });
  });

  /**
   * T102: Reject New Requests During Drain Test
   *
   * ACCEPTANCE CRITERIA:
   * - Must reject new requests with 503 Service Unavailable
   * - Must include descriptive error message
   * - Must happen immediately after shutdown initiated
   * - In-flight requests allowed to complete
   */
  describe('Reject New Requests During Drain (T102)', () => {
    it('should_returnTrue_when_acceptingRequestsBeforeShutdown', () => {
      shutdownHandler = new GracefulShutdownHandler({
        server: mockServer,
        drainTimeoutMs: 30000
      });

      expect(shutdownHandler.isShuttingDown()).toBe(false);
    });

    it('should_returnFalse_when_rejectingRequestsDuringShutdown', async () => {
      shutdownHandler = new GracefulShutdownHandler({
        server: mockServer,
        drainTimeoutMs: 1000
      });

      // Start shutdown (don't await - let it run in background)
      const shutdownPromise = shutdownHandler.shutdown();

      // Check status immediately after initiating shutdown
      expect(shutdownHandler.isShuttingDown()).toBe(true);

      await shutdownPromise;
    });

    it('should_provide503ErrorInfo_when_shuttingDown', () => {
      shutdownHandler = new GracefulShutdownHandler({
        server: mockServer,
        drainTimeoutMs: 30000
      });

      // Initiate shutdown
      shutdownHandler.shutdown();

      expect(shutdownHandler.isShuttingDown()).toBe(true);
      expect(shutdownHandler.getShutdownMessage()).toContain('shutting down');
    });
  });

  /**
   * T103: In-Flight Requests Complete Within Timeout Test
   *
   * ACCEPTANCE CRITERIA:
   * - In-flight requests allowed to complete
   * - Timeout prevents infinite wait (default: 30s)
   * - Server.close() called to stop accepting new connections
   * - Graceful completion preferred over forced termination
   */
  describe('In-Flight Request Completion (T103)', () => {
    it('should_callServerClose_when_shutdownInitiated', async () => {
      shutdownHandler = new GracefulShutdownHandler({
        server: mockServer,
        drainTimeoutMs: 1000
      });

      await shutdownHandler.shutdown();

      expect(mockServer.close).toHaveBeenCalled();
    });

    it('should_waitForInflightRequests_when_shutdownInitiated', async () => {
      // Mock server with delayed close
      const slowServer = {
        close: vi.fn((callback?: (err?: Error) => void) => {
          setTimeout(() => {
            if (callback) callback();
          }, 100); // Simulate 100ms to close connections
        }),
        listening: true
      } as unknown as Server;

      shutdownHandler = new GracefulShutdownHandler({
        server: slowServer,
        drainTimeoutMs: 1000
      });

      const startTime = Date.now();
      await shutdownHandler.shutdown();
      const duration = Date.now() - startTime;

      // Should have waited at least 100ms
      expect(duration).toBeGreaterThanOrEqual(100);
      expect(slowServer.close).toHaveBeenCalled();
    });

    it('should_respectDrainTimeout_when_requestsTakeTooLong', async () => {
      // Mock server that never closes
      const hangingServer = {
        close: vi.fn((callback?: (err?: Error) => void) => {
          // Never call callback - simulate hanging connections
        }),
        listening: true
      } as unknown as Server;

      shutdownHandler = new GracefulShutdownHandler({
        server: hangingServer,
        drainTimeoutMs: 500 // Short timeout
      });

      const startTime = Date.now();
      await shutdownHandler.shutdown();
      const duration = Date.now() - startTime;

      // Should timeout after ~500ms, not wait forever
      expect(duration).toBeGreaterThanOrEqual(500);
      expect(duration).toBeLessThan(1000);
    });
  });

  /**
   * T104: Queued Requests Drained Within Timeout Test
   *
   * ACCEPTANCE CRITERIA:
   * - Connection queue drained during shutdown
   * - Waiting requests processed if time permits
   * - Timeout enforced (no infinite wait)
   * - Queued requests rejected if timeout exceeded
   */
  describe('Queue Draining (T104)', () => {
    it('should_allowQueueDraining_when_shutdownInitiated', async () => {
      const mockQueue = {
        size: 5,
        drain: vi.fn().mockResolvedValue(undefined)
      };

      shutdownHandler = new GracefulShutdownHandler({
        server: mockServer,
        drainTimeoutMs: 1000,
        connectionQueue: mockQueue as any
      });

      await shutdownHandler.shutdown();

      expect(mockQueue.drain).toHaveBeenCalled();
    });

    it('should_enforceTimeout_when_queueDrainsTooLong', async () => {
      const mockQueue = {
        size: 10,
        drain: vi.fn().mockImplementation(() => {
          // Simulate slow drain (never resolves)
          return new Promise(() => {});
        })
      };

      shutdownHandler = new GracefulShutdownHandler({
        server: mockServer,
        drainTimeoutMs: 500,
        connectionQueue: mockQueue as any
      });

      const startTime = Date.now();
      await shutdownHandler.shutdown();
      const duration = Date.now() - startTime;

      // Should timeout, not wait forever
      expect(duration).toBeLessThan(1000);
    });
  });

  /**
   * T105: Process Exit Code Test
   *
   * ACCEPTANCE CRITERIA:
   * - Exit code 0 on successful shutdown (all requests drained)
   * - Exit code 1 on timeout (forced shutdown)
   * - Exit code communicated to process management (systemd, k8s)
   */
  describe('Process Exit Code (T105)', () => {
    it('should_exitWithCode0_when_shutdownSuccessful', async () => {
      shutdownHandler = new GracefulShutdownHandler({
        server: mockServer,
        drainTimeoutMs: 1000
      });

      await shutdownHandler.shutdown();

      // Verify exit code 0 (success)
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it('should_exitWithCode1_when_shutdownTimesOut', async () => {
      // Mock server that times out
      const timeoutServer = {
        close: vi.fn((callback?: (err?: Error) => void) => {
          // Never complete - force timeout
        }),
        listening: true
      } as unknown as Server;

      shutdownHandler = new GracefulShutdownHandler({
        server: timeoutServer,
        drainTimeoutMs: 500
      });

      await shutdownHandler.shutdown();

      // Verify exit code 1 (timeout/error)
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('should_returnExitCode_when_shutdownCompletes', async () => {
      shutdownHandler = new GracefulShutdownHandler({
        server: mockServer,
        drainTimeoutMs: 1000
      });

      const exitCode = await shutdownHandler.shutdown();

      expect(exitCode).toBe(0); // Successful shutdown
    });
  });

  /**
   * Integration Tests
   */
  describe('Integration', () => {
    it('should_completeFullShutdownSequence_when_triggered', async () => {
      const mockQueue = {
        size: 3, // Non-empty queue to trigger drain
        drain: vi.fn().mockResolvedValue(undefined)
      };

      const mockAuditLogger = {
        log: vi.fn().mockResolvedValue(undefined),
        flush: vi.fn().mockResolvedValue(undefined)
      };

      shutdownHandler = new GracefulShutdownHandler({
        server: mockServer,
        drainTimeoutMs: 1000,
        connectionQueue: mockQueue as any,
        auditLogger: mockAuditLogger as any
      });

      await shutdownHandler.shutdown();

      // Verify full sequence
      expect(mockQueue.drain).toHaveBeenCalled();
      expect(mockAuditLogger.flush).toHaveBeenCalled();
      expect(mockServer.close).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it('should_logShutdownEvent_when_initiated', async () => {
      const mockAuditLogger = {
        flush: vi.fn().mockResolvedValue(undefined),
        log: vi.fn().mockResolvedValue(undefined)
      };

      shutdownHandler = new GracefulShutdownHandler({
        server: mockServer,
        drainTimeoutMs: 1000,
        auditLogger: mockAuditLogger as any
      });

      await shutdownHandler.shutdown();

      // Verify shutdown event logged
      expect(mockAuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'shutdown',
          status: 'success'
        })
      );
    });
  });
});
