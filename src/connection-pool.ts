/**
 * Connection Pool for limiting concurrent executions
 *
 * Prevents resource exhaustion under high load (>1000 concurrent requests)
 */

export class ConnectionPool {
  private activeConnections = 0;
  private waitingQueue: (() => void)[] = [];

  constructor(
    private maxConcurrent: number = 100
  ) {}

  /**
   * Acquire connection slot (waits if max concurrent reached)
   */
  async acquire(): Promise<void> {
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
   */
  release(): void {
    // Process next waiting request if any
    const next = this.waitingQueue.shift();
    if (next) {
      next();
    } else {
      this.activeConnections--;
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
}
