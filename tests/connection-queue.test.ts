/**
 * Connection Queue Tests (US4: FR-4)
 *
 * Tests for FIFO request queueing when connection pool at capacity.
 * Prevents connection pool exhaustion under high load.
 *
 * TDD Approach: Tests written BEFORE implementation (Red-Green-Refactor)
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConnectionQueue } from '../src/connection-queue';

describe('Connection Queue (US4: FR-4)', () => {
  let queue: ConnectionQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    queue = new ConnectionQueue({ maxSize: 200, timeoutMs: 30000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('FIFO Enqueue/Dequeue (T045)', () => {
    test('should_enqueueRequest_when_queueHasCapacity', async () => {
      const request = {
        requestId: 'req-001',
        clientId: 'client_1',
        toolName: 'mcp__filesystem__read_file',
      };

      await queue.enqueue(request);

      const stats = queue.getStats();
      expect(stats.queueSize).toBe(1);
      expect(stats.enqueuedRequests).toBe(1);
    });

    test('should_dequeueInFIFOOrder_when_multipleRequestsEnqueued', async () => {
      // Enqueue 3 requests
      await queue.enqueue({ requestId: 'req-001', clientId: 'client_1', toolName: 'tool1' });
      await queue.enqueue({ requestId: 'req-002', clientId: 'client_2', toolName: 'tool2' });
      await queue.enqueue({ requestId: 'req-003', clientId: 'client_3', toolName: 'tool3' });

      // Dequeue should return in FIFO order
      const first = await queue.dequeue();
      expect(first?.requestId).toBe('req-001');

      const second = await queue.dequeue();
      expect(second?.requestId).toBe('req-002');

      const third = await queue.dequeue();
      expect(third?.requestId).toBe('req-003');
    });

    test('should_returnNull_when_queueEmpty', async () => {
      const result = await queue.dequeue();
      expect(result).toBeNull();
    });
  });

  describe('Queue Timeout (T046)', () => {
    test('should_expireRequest_when_30sTimeoutExceeds', async () => {
      const request = {
        requestId: 'req-001',
        clientId: 'client_1',
        toolName: 'mcp__filesystem__read_file',
      };

      await queue.enqueue(request);

      // Advance time by 30 seconds
      await vi.advanceTimersByTimeAsync(30000);

      // Cleanup expired requests
      await queue.cleanupExpired();

      // Queue should be empty (request expired)
      const stats = queue.getStats();
      expect(stats.queueSize).toBe(0);
      expect(stats.expiredRequests).toBe(1);
    });

    test('should_notExpireRequest_when_withinTimeout', async () => {
      const request = {
        requestId: 'req-001',
        clientId: 'client_1',
        toolName: 'mcp__filesystem__read_file',
      };

      await queue.enqueue(request);

      // Advance time by 29 seconds (still within 30s timeout)
      await vi.advanceTimersByTimeAsync(29000);

      // Cleanup expired requests
      await queue.cleanupExpired();

      // Request should still be in queue
      const stats = queue.getStats();
      expect(stats.queueSize).toBe(1);
    });

    test('should_return503Error_when_requestExpires', async () => {
      const request = {
        requestId: 'req-001',
        clientId: 'client_1',
        toolName: 'mcp__filesystem__read_file',
      };

      await queue.enqueue(request);

      // Advance time by 30.001 seconds
      await vi.advanceTimersByTimeAsync(30001);

      // Dequeue should return null (expired)
      const result = await queue.dequeue();
      expect(result).toBeNull();

      // Stats should show expired count
      const stats = queue.getStats();
      expect(stats.expiredRequests).toBeGreaterThan(0);
    });
  });

  describe('Queue Full (T047)', () => {
    test('should_rejectRequest_when_queueFull', async () => {
      const queue = new ConnectionQueue({ maxSize: 3, timeoutMs: 30000 });

      // Fill queue to capacity
      await queue.enqueue({ requestId: 'req-001', clientId: 'client_1', toolName: 'tool1' });
      await queue.enqueue({ requestId: 'req-002', clientId: 'client_2', toolName: 'tool2' });
      await queue.enqueue({ requestId: 'req-003', clientId: 'client_3', toolName: 'tool3' });

      // 4th request should be rejected
      await expect(
        queue.enqueue({ requestId: 'req-004', clientId: 'client_4', toolName: 'tool4' })
      ).rejects.toThrow('Queue full');
    });

    test('should_includeRetryAfterHint_when_queueFull', async () => {
      const queue = new ConnectionQueue({ maxSize: 2, timeoutMs: 30000 });

      // Fill queue
      await queue.enqueue({ requestId: 'req-001', clientId: 'client_1', toolName: 'tool1' });
      await queue.enqueue({ requestId: 'req-002', clientId: 'client_2', toolName: 'tool2' });

      // 3rd request should be rejected with retry hint
      try {
        await queue.enqueue({ requestId: 'req-003', clientId: 'client_3', toolName: 'tool3' });
      } catch (error) {
        expect((error as Error).message).toContain('Queue full');
        expect((error as Error).message.toLowerCase()).toContain('retry');
      }
    });
  });

  describe('Concurrent Operations (T048)', () => {
    test('should_protectQueueMutations_when_concurrentEnqueue', async () => {
      // Simulate 10 concurrent enqueue operations
      const promises = Array.from({ length: 10 }, (_, i) =>
        queue.enqueue({
          requestId: `req-${i.toString().padStart(3, '0')}`,
          clientId: `client_${i}`,
          toolName: 'tool',
        })
      );

      await Promise.all(promises);

      // All 10 requests should be enqueued (no race condition)
      const stats = queue.getStats();
      expect(stats.queueSize).toBe(10);
      expect(stats.enqueuedRequests).toBe(10);
    });

    test('should_protectQueueMutations_when_concurrentDequeue', async () => {
      // Enqueue 5 requests
      for (let i = 0; i < 5; i++) {
        await queue.enqueue({
          requestId: `req-${i.toString().padStart(3, '0')}`,
          clientId: `client_${i}`,
          toolName: 'tool',
        });
      }

      // Simulate 5 concurrent dequeue operations
      const promises = Array.from({ length: 5 }, () => queue.dequeue());

      const results = await Promise.all(promises);

      // All 5 requests should be dequeued (no duplicates)
      const requestIds = results.filter(r => r !== null).map(r => r?.requestId);
      expect(requestIds.length).toBe(5);
      expect(new Set(requestIds).size).toBe(5); // All unique

      // Queue should be empty
      const stats = queue.getStats();
      expect(stats.queueSize).toBe(0);
    });
  });

  describe('Queue Stats', () => {
    test('should_trackQueueMetrics_when_requestsProcessed', async () => {
      await queue.enqueue({ requestId: 'req-001', clientId: 'client_1', toolName: 'tool1' });
      await queue.enqueue({ requestId: 'req-002', clientId: 'client_2', toolName: 'tool2' });

      const stats = queue.getStats();
      expect(stats.queueSize).toBe(2);
      expect(stats.enqueuedRequests).toBe(2);
      expect(stats.dequeuedRequests).toBe(0);

      await queue.dequeue();

      const stats2 = queue.getStats();
      expect(stats2.queueSize).toBe(1);
      expect(stats2.dequeuedRequests).toBe(1);
    });
  });
});
