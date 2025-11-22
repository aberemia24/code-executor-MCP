/**
 * Circuit Breaker Interface
 *
 * Implements the Circuit Breaker pattern for fault isolation.
 * Prevents cascade failures when external services (MCP servers) fail repeatedly.
 *
 * State machine:
 * - CLOSED (normal): Allow all requests
 * - OPEN (failing): Reject all requests (fail fast)
 * - HALF_OPEN (recovering): Allow 1 test request
 *
 * @see https://martinfowler.com/bliki/CircuitBreaker.html
 */

export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerStats {
  /** Current circuit state */
  state: CircuitBreakerState;
  /** Consecutive failures since last success */
  failureCount: number;
  /** Timestamp of last failure (for cooldown calculation) */
  lastFailureTime: Date | null;
  /** When to retry next (null if circuit closed) */
  nextAttemptTime: Date | null;
  /** Lifetime failure count */
  totalFailures: number;
  /** Lifetime success count */
  totalSuccesses: number;
}

export interface ICircuitBreaker {
  /**
   * Executes a function with circuit breaker protection
   *
   * @param fn - Function to execute
   * @returns Promise with function result
   * @throws Error if circuit is open (fail fast)
   */
  execute<T>(fn: () => Promise<T>): Promise<T>;

  /**
   * Gets current circuit breaker statistics
   *
   * @returns Current stats (state, failure count, timestamps)
   */
  getStats(): CircuitBreakerStats;

  /**
   * Manually resets circuit breaker to closed state
   *
   * Use case: After manual intervention fixes the underlying issue
   */
  reset(): void;
}
