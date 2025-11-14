/**
 * Unit tests for ConnectionPool
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectionPool } from '../src/connection-pool.js';

describe('ConnectionPool', () => {
  let pool: ConnectionPool;

  beforeEach(() => {
    pool = new ConnectionPool(3); // Small pool for testing
  });

  describe('acquire and release', () => {
    it('should_acquire_slot_when_below_max', async () => {
      await pool.acquire();

      const stats = pool.getStats();
      expect(stats.active).toBe(1);
      expect(stats.waiting).toBe(0);
    });

    it('should_release_slot_decreasing_active_count', async () => {
      await pool.acquire();
      pool.release();

      const stats = pool.getStats();
      expect(stats.active).toBe(0);
    });

    it('should_queue_requests_when_at_max_concurrent', async () => {
      // Fill pool to capacity
      await pool.acquire(); // 1
      await pool.acquire(); // 2
      await pool.acquire(); // 3

      let acquired = false;
      const promise = pool.acquire().then(() => {
        acquired = true;
      });

      // Should be queued, not immediately acquired
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(acquired).toBe(false);

      const stats = pool.getStats();
      expect(stats.active).toBe(3);
      expect(stats.waiting).toBe(1);

      // Release one slot
      pool.release();

      // Queued request should now acquire
      await promise;
      expect(acquired).toBe(true);
    });

    it('should_process_queue_in_FIFO_order', async () => {
      // Fill pool
      await pool.acquire();
      await pool.acquire();
      await pool.acquire();

      const order: number[] = [];

      const promise1 = pool.acquire().then(() => order.push(1));
      const promise2 = pool.acquire().then(() => order.push(2));
      const promise3 = pool.acquire().then(() => order.push(3));

      // Release slots to process queue
      pool.release();
      await promise1;

      pool.release();
      await promise2;

      pool.release();
      await promise3;

      expect(order).toEqual([1, 2, 3]); // FIFO order
    });
  });

  describe('execute', () => {
    it('should_execute_function_with_connection_pooling', async () => {
      let executed = false;

      const result = await pool.execute(async () => {
        executed = true;
        return 'success';
      });

      expect(executed).toBe(true);
      expect(result).toBe('success');
    });

    it('should_release_slot_after_successful_execution', async () => {
      await pool.execute(async () => 'done');

      const stats = pool.getStats();
      expect(stats.active).toBe(0);
    });

    it('should_release_slot_even_if_function_throws', async () => {
      await expect(pool.execute(async () => {
        throw new Error('Test error');
      })).rejects.toThrow('Test error');

      const stats = pool.getStats();
      expect(stats.active).toBe(0);
    });

    it('should_limit_concurrent_executions', async () => {
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const task = async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await new Promise(resolve => setTimeout(resolve, 50));
        concurrentCount--;
      };

      const promises = Array(10).fill(null).map(() => pool.execute(task));
      await Promise.all(promises);

      expect(maxConcurrent).toBe(3); // Pool max is 3
    });

    it('should_return_function_result', async () => {
      const result = await pool.execute(async () => {
        return { data: 'test', count: 42 };
      });

      expect(result).toEqual({ data: 'test', count: 42 });
    });

    it('should_preserve_function_error_type', async () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }

      await expect(pool.execute(async () => {
        throw new CustomError('Custom error');
      })).rejects.toThrow(CustomError);
    });
  });

  describe('getStats', () => {
    it('should_return_correct_stats_initially', () => {
      const stats = pool.getStats();

      expect(stats.active).toBe(0);
      expect(stats.waiting).toBe(0);
      expect(stats.max).toBe(3);
    });

    it('should_update_stats_as_pool_fills', async () => {
      await pool.acquire();
      await pool.acquire();

      const stats = pool.getStats();
      expect(stats.active).toBe(2);
      expect(stats.waiting).toBe(0);
    });

    it('should_update_stats_when_queue_forms', async () => {
      // Fill pool
      await pool.acquire();
      await pool.acquire();
      await pool.acquire();

      // Queue additional requests
      const promise1 = pool.acquire();
      const promise2 = pool.acquire();

      await new Promise(resolve => setTimeout(resolve, 10));

      const stats = pool.getStats();
      expect(stats.active).toBe(3);
      expect(stats.waiting).toBe(2);

      // Clean up
      pool.release();
      pool.release();
      pool.release();
      await promise1;
      await promise2;
    });
  });

  describe('isAtCapacity', () => {
    it('should_return_false_when_below_max', async () => {
      await pool.acquire();

      expect(pool.isAtCapacity()).toBe(false);
    });

    it('should_return_true_when_at_max', async () => {
      await pool.acquire();
      await pool.acquire();
      await pool.acquire();

      expect(pool.isAtCapacity()).toBe(true);
    });

    it('should_return_false_after_release', async () => {
      await pool.acquire();
      await pool.acquire();
      await pool.acquire();

      expect(pool.isAtCapacity()).toBe(true);

      pool.release();

      expect(pool.isAtCapacity()).toBe(false);
    });
  });

  describe('clear', () => {
    it('should_reset_all_state', async () => {
      await pool.acquire();
      await pool.acquire();

      pool.acquire(); // This will queue
      pool.acquire(); // This will queue

      pool.clear();

      const stats = pool.getStats();
      expect(stats.active).toBe(0);
      expect(stats.waiting).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should_handle_max_concurrent_of_1', async () => {
      const singlePool = new ConnectionPool(1);

      let executionOrder: number[] = [];

      const task1 = singlePool.execute(async () => {
        executionOrder.push(1);
        await new Promise(resolve => setTimeout(resolve, 20));
      });

      const task2 = singlePool.execute(async () => {
        executionOrder.push(2);
        await new Promise(resolve => setTimeout(resolve, 20));
      });

      await Promise.all([task1, task2]);

      expect(executionOrder).toEqual([1, 2]); // Sequential execution
    });

    it('should_handle_default_max_concurrent_of_100', () => {
      const defaultPool = new ConnectionPool();

      const stats = defaultPool.getStats();
      expect(stats.max).toBe(100);
    });

    it('should_handle_rapid_acquire_release_cycles', async () => {
      for (let i = 0; i < 100; i++) {
        await pool.acquire();
        pool.release();
      }

      const stats = pool.getStats();
      expect(stats.active).toBe(0);
      expect(stats.waiting).toBe(0);
    });
  });

  describe('P1: Graceful Shutdown - drain()', () => {
    it('should_drain_successfully_when_pool_empty', async () => {
      const start = Date.now();
      await pool.drain(5000);
      const elapsed = Date.now() - start;

      // Should complete immediately (no active connections)
      expect(elapsed).toBeLessThan(100);
      expect(pool.isDraining()).toBe(true);
    });

    it('should_wait_for_active_connections_to_complete', async () => {
      // Start two long-running tasks
      await pool.acquire();
      await pool.acquire();

      const task1 = new Promise<void>((resolve) => {
        setTimeout(() => {
          pool.release();
          resolve();
        }, 200);
      });

      const task2 = new Promise<void>((resolve) => {
        setTimeout(() => {
          pool.release();
          resolve();
        }, 300);
      });

      // Start drain (should wait for tasks to complete)
      const drainStart = Date.now();
      const drainPromise = pool.drain(5000);

      // Wait for all to complete
      await Promise.all([task1, task2, drainPromise]);

      const elapsed = Date.now() - drainStart;

      // Should have waited for task2 (~300ms)
      expect(elapsed).toBeGreaterThanOrEqual(250);
      expect(elapsed).toBeLessThan(500);

      const stats = pool.getStats();
      expect(stats.active).toBe(0);
      expect(pool.isDraining()).toBe(true);
    });

    it('should_reject_new_acquisitions_during_drain', async () => {
      // Start draining
      const drainPromise = pool.drain(1000);

      // Try to acquire (should be rejected)
      await expect(pool.acquire()).rejects.toThrow(
        'Connection pool is draining - no new connections accepted'
      );

      await drainPromise;
    });

    it('should_clear_waiting_queue_when_draining', async () => {
      // Fill pool to capacity
      await pool.acquire();
      await pool.acquire();
      await pool.acquire();

      // Queue additional requests
      const promise1 = pool.acquire();
      const promise2 = pool.acquire();

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify queue has requests
      let stats = pool.getStats();
      expect(stats.waiting).toBe(2);

      // Start drain (should clear waiting queue)
      const drainPromise = pool.drain(5000);

      // Release active connections
      pool.release();
      pool.release();
      pool.release();

      await drainPromise;

      // Waiting queue should be empty
      stats = pool.getStats();
      expect(stats.waiting).toBe(0);

      // Queued promises should still be pending (not resolved/rejected)
      // This is acceptable - they just never complete
      await expect(Promise.race([
        promise1,
        promise2,
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 100)),
      ])).resolves.toBe('timeout');
    });

    it('should_timeout_if_connections_dont_complete', async () => {
      // Start long-running task that won't complete in time
      await pool.acquire();

      const drainStart = Date.now();
      await pool.drain(500); // 500ms timeout
      const elapsed = Date.now() - drainStart;

      // Should timeout after ~500ms
      expect(elapsed).toBeGreaterThanOrEqual(450);
      expect(elapsed).toBeLessThan(700);

      // Pool should still be draining
      expect(pool.isDraining()).toBe(true);

      // Active connection should still exist (not released)
      const stats = pool.getStats();
      expect(stats.active).toBe(1);

      // Cleanup
      pool.release();
    });

    it('should_report_waiting_requests_cleared', async () => {
      // Fill pool and queue requests
      await pool.acquire();
      await pool.acquire();
      await pool.acquire();

      pool.acquire(); // Will queue
      pool.acquire(); // Will queue

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Start drain
      const drainPromise = pool.drain(1000);

      // Release slots
      pool.release();
      pool.release();
      pool.release();

      await drainPromise;

      const stats = pool.getStats();
      expect(stats.active).toBe(0);
      expect(stats.waiting).toBe(0);
    });

    it('should_prevent_execute_during_drain', async () => {
      // Start draining
      const drainPromise = pool.drain(1000);

      // Try to execute (should fail acquisition)
      await expect(
        pool.execute(async () => 'should not run')
      ).rejects.toThrow('Connection pool is draining');

      await drainPromise;
    });

    it('should_handle_multiple_drain_calls', async () => {
      // Start first drain
      const drain1 = pool.drain(1000);

      // Second drain should also work (already draining)
      const drain2 = pool.drain(1000);

      await Promise.all([drain1, drain2]);

      expect(pool.isDraining()).toBe(true);
    });
  });
});
