/**
 * Connection Queue (US4: FR-4)
 *
 * Implements FIFO request queueing for connection pool overflow handling.
 * Prevents connection pool exhaustion under high load.
 *
 * **WHY Request Queueing?**
 * - Graceful degradation under load (queue vs reject immediately)
 * - Fairness (FIFO ensures early requests served first)
 * - Prevents cascade failures (bounded queue limits memory)
 *
 * **WHY 200 request capacity?**
 * - Balances memory usage (~40KB at 200 requests) vs utility
 * - Industry standard (Nginx default 512, we're more conservative)
 * - Configurable via POOL_QUEUE_SIZE env var
 *
 * **WHY 30s timeout?**
 * - Reasonable wait time for legitimate traffic
 * - Prevents queue from filling with stale requests
 * - Matches circuit breaker cooldown (30s recovery window)
 *
 * @see https://aws.amazon.com/builders-library/using-load-shedding-to-avoid-overload/
 */

import AsyncLock from 'async-lock';

export interface ConnectionQueueConfig {
  /** Maximum queue size (default: 200) */
  maxSize: number;
  /** Request timeout in milliseconds (default: 30000ms = 30s) */
  timeoutMs: number;
}

export interface QueuedRequest {
  /** Unique request identifier */
  requestId: string;
  /** Client identifier (for metrics) */
  clientId: string;
  /** MCP tool being called (for logging) */
  toolName: string;
  /** Timestamp when enqueued */
  enqueuedAt?: number;
  /** Expiration timestamp (enqueuedAt + timeoutMs) */
  timeoutAt?: number;
}

export interface QueueStats {
  /** Current queue size */
  queueSize: number;
  /** Total requests enqueued (lifetime) */
  enqueuedRequests: number;
  /** Total requests dequeued (lifetime) */
  dequeuedRequests: number;
  /** Total requests expired (lifetime) */
  expiredRequests: number;
}

/**
 * Connection Queue
 *
 * FIFO queue with timeout-based expiration and AsyncLock concurrency protection.
 */
export class ConnectionQueue {
  private readonly config: ConnectionQueueConfig;
  private readonly queue: QueuedRequest[];
  private readonly lock: AsyncLock;
  private stats: QueueStats;

  constructor(config: ConnectionQueueConfig) {
    this.config = config;
    this.queue = [];
    this.lock = new AsyncLock();
    this.stats = {
      queueSize: 0,
      enqueuedRequests: 0,
      dequeuedRequests: 0,
      expiredRequests: 0,
    };
  }

  /**
   * Enqueues a request (adds to back of queue)
   *
   * @param request - Request to enqueue
   * @throws Error if queue is full (returns 503 to client)
   */
  async enqueue(request: QueuedRequest): Promise<void> {
    return await this.lock.acquire('queue-write', async () => {
      // Check capacity
      if (this.queue.length >= this.config.maxSize) {
        throw new Error(
          `Queue full (${this.config.maxSize} requests). ` +
            `Retry after some requests complete (estimated: 60s).`
        );
      }

      // Add timestamps
      const now = Date.now();
      const queuedRequest: QueuedRequest = {
        ...request,
        enqueuedAt: now,
        timeoutAt: now + this.config.timeoutMs,
      };

      // Enqueue (FIFO - add to back)
      this.queue.push(queuedRequest);

      // Update stats
      this.stats.enqueuedRequests++;
      this.stats.queueSize = this.queue.length;
    });
  }

  /**
   * Dequeues a request (removes from front of queue)
   *
   * @returns Next request or null if queue empty
   */
  async dequeue(): Promise<QueuedRequest | null> {
    return await this.lock.acquire('queue-read', async () => {
      // Cleanup expired requests first
      await this.cleanupExpiredInternal();

      // Dequeue (FIFO - remove from front)
      const request = this.queue.shift();

      if (request) {
        // Update stats
        this.stats.dequeuedRequests++;
        this.stats.queueSize = this.queue.length;
      }

      return request ?? null;
    });
  }

  /**
   * Removes expired requests from queue
   *
   * Called periodically (e.g., every 5s) or before dequeue
   */
  async cleanupExpired(): Promise<void> {
    await this.lock.acquire('queue-write', async () => {
      await this.cleanupExpiredInternal();
    });
  }

  /**
   * Internal cleanup (assumes lock already acquired)
   * @private
   */
  private async cleanupExpiredInternal(): Promise<void> {
    const now = Date.now();
    const beforeSize = this.queue.length;

    // Filter out expired requests
    this.queue.splice(
      0,
      this.queue.length,
      ...this.queue.filter((req) => (req.timeoutAt ?? Infinity) > now)
    );

    const afterSize = this.queue.length;
    const expiredCount = beforeSize - afterSize;

    // Update stats
    if (expiredCount > 0) {
      this.stats.expiredRequests += expiredCount;
      this.stats.queueSize = this.queue.length;
    }
  }

  /**
   * Gets current queue statistics
   *
   * @returns Queue stats (size, enqueued, dequeued, expired)
   */
  getStats(): QueueStats {
    return { ...this.stats };
  }

  /**
   * Resets queue (for testing or manual intervention)
   */
  reset(): void {
    this.queue.length = 0;
    this.stats = {
      queueSize: 0,
      enqueuedRequests: 0,
      dequeuedRequests: 0,
      expiredRequests: 0,
    };
  }
}
