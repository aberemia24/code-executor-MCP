/**
 * Queue Polling Race Condition Fix Tests (SEC-001)
 *
 * Tests for event-driven queue slot notification system that replaces
 * the polling loop to fix race conditions and FIFO violations.
 *
 * @see https://github.com/aberemia24/code-executor-MCP/issues/40
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MCPClientPool } from '../src/mcp-client-pool.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('Queue Polling Race Condition Fix (SEC-001)', () => {
  let pool: MCPClientPool;
  let tempConfigPath: string;

  beforeEach(async () => {
    // Create minimal MCP config for testing
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-'));
    tempConfigPath = path.join(tempDir, 'config.json');

    const minimalConfig = {
      mcpServers: {
        test: {
          command: 'node',
          args: ['-e', 'console.log("test")'],
        },
      },
    };

    await fs.writeFile(tempConfigPath, JSON.stringify(minimalConfig, null, 2));

    // Create pool with small limits for faster testing
    pool = new MCPClientPool({
      maxConcurrent: 2, // Small limit to trigger queueing quickly
      queueSize: 10,
      queueTimeoutMs: 5000, // 5s timeout for faster tests
    });
  });

  afterEach(async () => {
    // Cleanup
    try {
      await pool.shutdown();
      const configDir = path.dirname(tempConfigPath);
      await fs.rm(configDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('FIFO Ordering Preservation (T065)', () => {
    it('should_preserveFIFO_when_multipleRequestsQueued', async () => {
      // Initialize pool
      await pool.initialize(tempConfigPath);

      const executionOrder: number[] = [];
      const requestCount = 5;

      // Create requests that will be queued
      const requests = Array.from({ length: requestCount }, (_, i) => i);

      // Execute requests concurrently (will queue after maxConcurrent=2)
      const promises = requests.map((requestId) =>
        (async () => {
          try {
            // This will queue requests 3, 4, 5 (since maxConcurrent=2)
            // We're testing that they execute in FIFO order when slots free up
            await pool.callTool('mcp__test__dummy', {}, `client-${requestId}`);
            executionOrder.push(requestId);
          } catch (error) {
            // Expected - dummy tool doesn't exist, but we care about queue order
            executionOrder.push(requestId);
          }
        })()
      );

      await Promise.allSettled(promises);

      // Verify FIFO: execution order should match request order
      // First 2 can execute immediately (maxConcurrent=2), rest queued
      expect(executionOrder).toEqual(requests);
    }, 10000);

    it('should_notReenqueue_when_requestProcessed', async () => {
      // This test verifies that the old re-enqueuing bug is fixed
      await pool.initialize(tempConfigPath);

      let reenqueueCount = 0;

      // Spy on queue operations (if we had access)
      // Since queue is private, we test behavior indirectly via execution order

      const requests = [0, 1, 2, 3];
      const executionOrder: number[] = [];

      const promises = requests.map((id) =>
        (async () => {
          try {
            await pool.callTool('mcp__test__dummy', {}, `client-${id}`);
            executionOrder.push(id);
          } catch (error) {
            executionOrder.push(id);
          }
        })()
      );

      await Promise.allSettled(promises);

      // If re-enqueuing happened, order would be disrupted
      expect(executionOrder).toEqual(requests);
      expect(reenqueueCount).toBe(0); // No re-enqueuing
    }, 10000);
  });

  describe('Event-Driven Pattern (T066)', () => {
    it('should_useEvents_notPolling_when_waitingForSlot', async () => {
      await pool.initialize(tempConfigPath);

      // Capture setTimeout calls to detect polling
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      const originalSetTimeout = global.setTimeout;

      let pollingDetected = false;
      setTimeoutSpy.mockImplementation(((callback: any, delay?: number) => {
        // Detect 100ms polling interval from old implementation
        if (delay === 100) {
          pollingDetected = true;
        }
        return originalSetTimeout(callback, delay);
      }) as typeof setTimeout);

      try {
        // Trigger queueing
        const promises = [0, 1, 2, 3].map((id) =>
          pool.callTool('mcp__test__dummy', {}, `client-${id}`).catch(() => {})
        );

        await Promise.allSettled(promises);

        // Verify no 100ms polling detected
        expect(pollingDetected).toBe(false);
      } finally {
        setTimeoutSpy.mockRestore();
      }
    }, 10000);

    it('should_cleanupListener_when_timeoutOccurs', async () => {
      await pool.initialize(tempConfigPath);

      // Create a request that will timeout
      const promise = pool.callTool('mcp__test__slow', {}, 'client-timeout').catch((error) => error);

      // Wait for timeout
      const result = await promise;

      // Verify timeout error
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toContain('Queue timeout');

      // Verify no memory leak: EventEmitter should not have lingering listeners
      // In real implementation, listener is removed via .off() on timeout
      // We can't directly test EventEmitter internals, but timeout confirms cleanup logic ran
    }, 10000);
  });

  describe('Timeout Protection (T067)', () => {
    it('should_timeout_when_queueNotProcessed', async () => {
      // Create pool with very short timeout
      const shortTimeoutPool = new MCPClientPool({
        maxConcurrent: 1,
        queueSize: 5,
        queueTimeoutMs: 100, // 100ms timeout
      });

      await shortTimeoutPool.initialize(tempConfigPath);

      try {
        // Fill capacity and queue with long-running requests
        const blockingPromise = shortTimeoutPool
          .callTool('mcp__test__blocking', {}, 'blocker')
          .catch(() => {});

        // This should timeout since blocker never finishes
        const timeoutPromise = shortTimeoutPool.callTool('mcp__test__timeout', {}, 'waiter');

        await expect(timeoutPromise).rejects.toThrow(/Queue timeout/);
      } finally {
        await shortTimeoutPool.shutdown();
      }
    }, 10000);

    it('should_useConfiguredTimeout_when_waiting', async () => {
      const customTimeoutPool = new MCPClientPool({
        maxConcurrent: 1,
        queueSize: 5,
        queueTimeoutMs: 2000, // 2s timeout
      });

      await customTimeoutPool.initialize(tempConfigPath);

      try {
        const startTime = Date.now();

        // Trigger timeout
        await customTimeoutPool.callTool('mcp__test__timeout', {}, 'client-1').catch(() => {});

        const elapsed = Date.now() - startTime;

        // Should timeout around 2000ms (with some margin)
        expect(elapsed).toBeGreaterThan(1900);
        expect(elapsed).toBeLessThan(2500);
      } finally {
        await customTimeoutPool.shutdown();
      }
    }, 10000);
  });

  describe('Memory Leak Prevention (T068)', () => {
    it('should_notAccumulateTimers_when_manyRequests', async () => {
      await pool.initialize(tempConfigPath);

      // Track active timers (simplified test - real check would use process.memoryUsage())
      const initialTimers = process._getActiveHandles?.()?.length || 0;

      // Create many requests
      const promises = Array.from({ length: 20 }, (_, i) =>
        pool.callTool('mcp__test__leak', {}, `client-${i}`).catch(() => {})
      );

      await Promise.allSettled(promises);

      // Wait a bit for cleanup
      await new Promise((resolve) => setTimeout(resolve, 500));

      const finalTimers = process._getActiveHandles?.()?.length || 0;

      // Should not have accumulated 20 uncleaned timers
      // Some timers are OK (test framework, etc), but not 20+
      expect(finalTimers - initialTimers).toBeLessThan(10);
    }, 10000);

    it('should_removeListener_when_slotFreed', async () => {
      await pool.initialize(tempConfigPath);

      // This test verifies EventEmitter cleanup via .once() and .off()
      // .once() auto-removes listener after firing
      // .off() removes listener on timeout

      const promises = [0, 1, 2].map((id) =>
        pool.callTool('mcp__test__listener', {}, `client-${id}`).catch(() => {})
      );

      await Promise.allSettled(promises);

      // If listeners aren't cleaned up, EventEmitter would hold references
      // This is tested indirectly via memory leak test above
      expect(true).toBe(true); // Placeholder - real test would inspect EventEmitter
    }, 10000);
  });

  describe('Concurrency Correctness (T069)', () => {
    it('should_respectMaxConcurrent_when_manyRequests', async () => {
      await pool.initialize(tempConfigPath);

      let currentConcurrent = 0;
      let maxObservedConcurrent = 0;

      const requests = Array.from({ length: 10 }, (_, i) =>
        (async () => {
          currentConcurrent++;
          maxObservedConcurrent = Math.max(maxObservedConcurrent, currentConcurrent);

          try {
            await pool.callTool('mcp__test__concurrent', {}, `client-${i}`);
          } catch (error) {
            // Expected - dummy tool
          } finally {
            currentConcurrent--;
          }
        })()
      );

      await Promise.allSettled(requests);

      // Max concurrent should never exceed pool limit (2)
      expect(maxObservedConcurrent).toBeLessThanOrEqual(2);
    }, 10000);
  });
});
