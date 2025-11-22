/**
 * Connection Pool for limiting concurrent executions
 *
 * Prevents resource exhaustion under high load (>1000 concurrent requests)
 */

export class ConnectionPool {
  private activeConnections = 0;
  private waitingQueue: (() => void)[] = [];
  private draining = false; // P1: Flag to reject new acquisitions during drain
  private drainResolvers: (() => void)[] = []; // P1: Event-driven drain signaling

  constructor(
    private maxConcurrent: number = 100
  ) {
    if (maxConcurrent < 1) {
      throw new Error('maxConcurrent must be at least 1');
    }
  }

  /**
   * Acquire connection slot (waits if max concurrent reached)
   *
   * P1: Rejects new acquisitions if pool is draining
   */
  async acquire(): Promise<void> {
    // P1: Reject new acquisitions during graceful shutdown
    if (this.draining) {
      throw new Error('Connection pool is draining - no new connections accepted');
    }

    if (this.activeConnections < this.maxConcurrent) {
      this.activeConnections++;
      return;
    }

    // Wait for slot to become available
    return new Promise((resolve) => {
      this.waitingQueue.push(resolve);
    });
  }

  /**
   * Release connection slot (allows waiting requests to proceed)
   *
   * P1: Signals drain waiters when pool becomes empty
   */
  release(): void {
    // Process next waiting request if any
    const next = this.waitingQueue.shift();
    if (next) {
      next();
    } else {
      this.activeConnections--;

      // P1: Signal drain waiters when pool becomes empty
      if (this.activeConnections === 0 && this.draining) {
        this.drainResolvers.forEach(resolve => resolve());
        this.drainResolvers = [];
      }
    }
  }

  /**
   * Execute function with connection pooling
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();

    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Get current pool stats
   */
  getStats(): { active: number; waiting: number; max: number } {
    return {
      active: this.activeConnections,
      waiting: this.waitingQueue.length,
      max: this.maxConcurrent,
    };
  }

  /**
   * Check if pool is at capacity
   */
  isAtCapacity(): boolean {
    return this.activeConnections >= this.maxConcurrent;
  }

  /**
   * Clear all waiting connections (emergency shutdown)
   */
  clear(): void {
    this.waitingQueue = [];
    this.activeConnections = 0;
  }

  /**
   * Drain connection pool gracefully
   *
   * P1: Wait for all active connections to complete before shutdown.
   * Uses event-driven signaling (not polling) for efficient waiting.
   *
   * @param timeoutMs - Maximum time to wait for connections to drain (default: 30s)
   * @returns Promise that resolves when pool is drained or timeout is reached
   */
  async drain(timeoutMs: number = 30000): Promise<void> {
    // Set draining flag to reject new acquisitions
    this.draining = true;

    // Reject all waiting requests (they'll never get processed)
    const waitingCount = this.waitingQueue.length;
    this.waitingQueue = [];

    if (waitingCount > 0) {
      console.error(
        `⚠️ Drained ${waitingCount} waiting requests (will not be processed)`
      );
    }

    // P1: Event-driven wait (not polling) - more efficient than 100ms polls
    if (this.activeConnections > 0) {
      await Promise.race([
        // Wait for drain signal from release()
        new Promise<void>((resolve) => {
          this.drainResolvers.push(resolve);
        }),
        // Timeout protection
        new Promise<void>((resolve) => {
          setTimeout(() => {
            console.error(
              `⚠️ Connection pool drain timeout after ${timeoutMs}ms ` +
              `(${this.activeConnections} connections still active - forcing shutdown)`
            );
            resolve();
          }, timeoutMs);
        })
      ]);
    }

    if (this.activeConnections === 0) {
      console.error('✓ Connection pool drained successfully');
    }
  }

  /**
   * Check if pool is currently draining
   *
   * P1: Used by graceful shutdown to coordinate shutdown sequence
   */
  isDraining(): boolean {
    return this.draining;
  }
}
