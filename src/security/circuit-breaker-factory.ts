/**
 * Circuit Breaker Factory (US1: FR-1)
 *
 * Implements the Circuit Breaker pattern using Opossum library for fault isolation.
 * Prevents cascade failures when MCP servers hang or fail repeatedly.
 *
 * **WHY Circuit Breaker?**
 * - Fail-fast when MCP servers are down (don't wait for timeout)
 * - Automatic recovery detection (half-open state tests connection)
 * - Prevents resource exhaustion (reject requests early when service unavailable)
 *
 * **WHY 5 failures threshold?**
 * - Industry standard (Netflix Hystrix default)
 * - Balances sensitivity (detect failures quickly) vs false positives (transient errors)
 * - Configurable via CIRCUIT_BREAKER_THRESHOLD env var
 *
 * **WHY 30s cooldown?**
 * - Gives failed service time to recover (restart, reconnect, heal)
 * - Not too short (thrashing) or too long (prolonged outage)
 * - Configurable via CIRCUIT_BREAKER_TIMEOUT_MS env var
 *
 * @see https://martinfowler.com/bliki/CircuitBreaker.html
 * @see https://github.com/nodeshift/opossum
 */

import CircuitBreaker from 'opossum';
import AsyncLock from 'async-lock';
import type {
  ICircuitBreaker,
  CircuitBreakerState,
  CircuitBreakerStats,
} from './interfaces/circuit-breaker.js';

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening circuit */
  failureThreshold: number;
  /** Cooldown duration in milliseconds before attempting recovery */
  cooldownMs: number;
  /** Request timeout in milliseconds (fail if no response) */
  timeout?: number;
  /** Server identifier (for metrics/logging) */
  serverId?: string;
}

/**
 * Circuit Breaker Factory
 *
 * Creates and manages circuit breakers for MCP server connections.
 * Uses Opossum library for circuit breaker logic and AsyncLock for concurrency safety.
 */
export class CircuitBreakerFactory implements ICircuitBreaker {
  private readonly breaker: CircuitBreaker<any[], any>;
  private readonly lock: AsyncLock;
  private readonly config: Required<CircuitBreakerConfig>;
  private stats: CircuitBreakerStats;
  private consecutiveFailures: number = 0;

  constructor(config: CircuitBreakerConfig) {
    this.config = {
      failureThreshold: config.failureThreshold,
      cooldownMs: config.cooldownMs,
      timeout: config.timeout ?? 60000,
      serverId: config.serverId ?? 'default',
    };

    this.lock = new AsyncLock();

    // Initialize stats
    this.stats = {
      state: 'closed',
      failureCount: 0,
      lastFailureTime: null,
      nextAttemptTime: null,
      totalFailures: 0,
      totalSuccesses: 0,
    };

    // Create Opossum circuit breaker
    // WHY these specific settings:
    // - timeout: Maximum time to wait for MCP response before failing
    // - errorThresholdPercentage: 100% ensures we manually control when circuit opens (based on consecutive failures)
    // - resetTimeout: Cooldown duration before attempting half-open state
    // - volumeThreshold: 1 means we check every single request (no minimum window)
    this.breaker = new CircuitBreaker(
      async (fn: () => Promise<any>) => {
        return await fn();
      },
      {
        timeout: this.config.timeout,
        errorThresholdPercentage: 100, // We manually open circuit after N consecutive failures
        resetTimeout: this.config.cooldownMs,
        volumeThreshold: 1, // Check every request
        enabled: true,
      }
    );

    // Register event handlers for state tracking
    this.breaker.on('success', () => this.onSuccess());
    this.breaker.on('failure', () => this.onFailure());
    this.breaker.on('open', () => this.onOpen());
    this.breaker.on('halfOpen', () => this.onHalfOpen());
    this.breaker.on('close', () => this.onClose());
  }

  /**
   * Executes a function with circuit breaker protection
   *
   * @param fn - Async function to execute (e.g., MCP server call)
   * @returns Promise with function result
   * @throws Error if circuit is open (fail fast) or function fails
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    try {
      const result = await this.breaker.fire(fn);
      return result;
    } catch (error) {
      // Circuit breaker throws specific error when open
      if (this.breaker.opened) {
        throw new Error(
          `Circuit breaker is open for server '${this.config.serverId}'. ` +
            `Retry after ${Math.ceil(this.config.cooldownMs / 1000)}s. ` +
            `Cause: ${this.stats.failureCount} consecutive failures.`
        );
      }
      throw error;
    }
  }

  /**
   * Gets current circuit breaker statistics
   *
   * @returns Current stats (state, failure count, timestamps)
   */
  getStats(): CircuitBreakerStats {
    // AsyncLock ensures consistent read of stats
    return { ...this.stats };
  }

  /**
   * Manually resets circuit breaker to closed state
   *
   * Use case: After manual intervention fixes the underlying issue
   * (e.g., restarting MCP server, fixing network)
   */
  reset(): void {
    this.breaker.close();
    this.consecutiveFailures = 0;
    this.stats = {
      state: 'closed',
      failureCount: 0,
      lastFailureTime: null,
      nextAttemptTime: null,
      totalFailures: this.stats.totalFailures,
      totalSuccesses: this.stats.totalSuccesses,
    };
  }

  /**
   * Event handler: Successful request
   * AsyncLock protects stats updates from race conditions
   */
  private onSuccess(): void {
    this.lock.acquire('stats-update', (done) => {
      this.stats.totalSuccesses++;
      this.consecutiveFailures = 0; // Reset consecutive failure count
      this.stats.failureCount = 0;
      this.stats.lastFailureTime = null;
      this.stats.nextAttemptTime = null;
      done();
    });
  }

  /**
   * Event handler: Failed request
   * AsyncLock protects stats updates from race conditions
   * Manually opens circuit after threshold consecutive failures
   */
  private onFailure(): void {
    this.lock.acquire('stats-update', (done) => {
      this.stats.totalFailures++;
      this.consecutiveFailures++;
      this.stats.failureCount = this.consecutiveFailures;
      this.stats.lastFailureTime = new Date();

      // Manually open circuit after threshold consecutive failures
      if (this.consecutiveFailures >= this.config.failureThreshold && !this.breaker.opened) {
        this.breaker.open();
      }

      done();
    });
  }

  /**
   * Event handler: Circuit opened (fail-fast mode)
   * AsyncLock protects state transitions from race conditions
   */
  private onOpen(): void {
    this.lock.acquire('stats-update', (done) => {
      this.stats.state = 'open';
      this.stats.nextAttemptTime = new Date(Date.now() + this.config.cooldownMs);
      done();
    });
  }

  /**
   * Event handler: Circuit half-open (testing recovery)
   * AsyncLock protects state transitions from race conditions
   */
  private onHalfOpen(): void {
    this.lock.acquire('stats-update', (done) => {
      this.stats.state = 'half-open';
      done();
    });
  }

  /**
   * Event handler: Circuit closed (normal operation)
   * AsyncLock protects state transitions from race conditions
   */
  private onClose(): void {
    this.lock.acquire('stats-update', (done) => {
      this.stats.state = 'closed';
      this.consecutiveFailures = 0;
      this.stats.failureCount = 0;
      this.stats.nextAttemptTime = null;
      done();
    });
  }
}
