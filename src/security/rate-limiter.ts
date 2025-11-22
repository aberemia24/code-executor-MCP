/**
 * Rate Limiter using Token Bucket Algorithm
 *
 * Prevents abuse by limiting the number of executions per time window.
 * Uses token bucket algorithm for smooth rate limiting with burst capacity.
 */

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum number of requests allowed per window (optional for quota-only mode) */
  maxRequests?: number;
  /** Time window in milliseconds (optional for quota-only mode) */
  windowMs?: number;
  /** Allow bursts up to this many requests */
  burstSize?: number;
  /** Maximum sampling rounds per execution (for global quota tracking) */
  maxRoundsPerExecution?: number;
  /** Maximum tokens per execution (for global quota tracking) */
  maxTokensPerExecution?: number;
}

/**
 * Rate limiter result
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining requests in current window */
  remaining: number;
  /** Time until next token refill (ms) */
  resetIn: number;
  /** Current bucket fill level (0-1) */
  fillLevel: number;
}

/**
 * Token bucket entry for a client
 */
interface TokenBucket {
  /** Number of tokens available */
  tokens: number;
  /** Last refill timestamp */
  lastRefill: number;
}

/**
 * Rate Limiter using Token Bucket Algorithm
 *
 * Features:
 * - Per-client rate limiting (by IP or identifier)
 * - Token bucket algorithm for smooth limiting with bursts
 * - Automatic cleanup of stale buckets
 * - Thread-safe for concurrent requests
 *
 * @example
 * const limiter = new RateLimiter({
 *   maxRequests: 10,
 *   windowMs: 60000, // 10 requests per minute
 *   burstSize: 5,    // Allow bursts of 5
 * });
 *
 * const result = await limiter.checkLimit('client-ip');
 * if (!result.allowed) {
 *   throw new Error(`Rate limit exceeded. Try again in ${result.resetIn}ms`);
 * }
 */
export class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private config: RateLimitConfig;
  private cleanupInterval: NodeJS.Timeout | null = null;

  // Global quota tracking for sampling (separate from per-client limits)
  private roundsUsed: number = 0;
  private tokensUsed: number = 0;

  constructor(config: RateLimitConfig) {
    this.config = {
      maxRequests: config.maxRequests,
      windowMs: config.windowMs,
      burstSize: config.burstSize ?? config.maxRequests ?? 10,
      maxRoundsPerExecution: config.maxRoundsPerExecution,
      maxTokensPerExecution: config.maxTokensPerExecution,
    };

    // Only start cleanup task if using per-client rate limiting
    if (config.maxRequests && config.windowMs) {
      this.startCleanupTask();
    }
  }

  /**
   * Check if a request is allowed under rate limit
   *
   * @param clientId - Unique identifier for the client (e.g., IP address)
   * @returns Rate limit result with allowed status and metadata
   */
  async checkLimit(clientId: string): Promise<RateLimitResult> {
    // Ensure per-client rate limiting is configured
    if (!this.config.maxRequests || !this.config.windowMs) {
      throw new Error('RateLimiter: maxRequests and windowMs are required for per-client rate limiting. Use quota methods for global tracking.');
    }

    const now = Date.now();
    let bucket = this.buckets.get(clientId);

    // Create new bucket if client is new
    if (!bucket) {
      bucket = {
        tokens: this.config.burstSize ?? 10,
        lastRefill: now,
      };
      this.buckets.set(clientId, bucket);
    }

    // Calculate token refill since last check
    const timeSinceRefill = now - bucket.lastRefill;
    const refillRate = this.config.maxRequests / this.config.windowMs; // tokens per ms
    const tokensToAdd = timeSinceRefill * refillRate;

    const burstSize = this.config.burstSize ?? 10;

    // Add tokens (capped at burst size)
    bucket.tokens = Math.min(
      burstSize,
      bucket.tokens + tokensToAdd
    );
    bucket.lastRefill = now;

    // Check if request is allowed (at least 1 token available)
    const allowed = bucket.tokens >= 1;

    if (allowed) {
      // Consume 1 token
      bucket.tokens -= 1;
    }

    // Calculate reset time (when next token will be available)
    const msPerToken = this.config.windowMs / this.config.maxRequests;
    const resetIn = allowed ? msPerToken : msPerToken * (1 - bucket.tokens);

    return {
      allowed,
      remaining: Math.floor(bucket.tokens),
      resetIn: Math.ceil(resetIn),
      fillLevel: bucket.tokens / burstSize,
    };
  }

  /**
   * Get rate limit info without consuming a token
   *
   * Useful for checking limits without affecting the counter.
   */
  async getLimit(clientId: string): Promise<RateLimitResult> {
    // Ensure per-client rate limiting is configured
    if (!this.config.maxRequests || !this.config.windowMs) {
      throw new Error('RateLimiter: maxRequests and windowMs are required for per-client rate limiting. Use quota methods for global tracking.');
    }

    const now = Date.now();
    const bucket = this.buckets.get(clientId);
    const burstSize = this.config.burstSize ?? 10;

    if (!bucket) {
      // Client has never made a request
      return {
        allowed: true,
        remaining: burstSize,
        resetIn: 0,
        fillLevel: 1.0,
      };
    }

    // Calculate current tokens without modifying bucket
    const timeSinceRefill = now - bucket.lastRefill;
    const refillRate = this.config.maxRequests / this.config.windowMs;
    const currentTokens = Math.min(
      burstSize,
      bucket.tokens + timeSinceRefill * refillRate
    );

    const msPerToken = this.config.windowMs / this.config.maxRequests;
    const resetIn = currentTokens >= 1 ? msPerToken : msPerToken * (1 - currentTokens);

    return {
      allowed: currentTokens >= 1,
      remaining: Math.floor(currentTokens),
      resetIn: Math.ceil(resetIn),
      fillLevel: currentTokens / burstSize,
    };
  }

  /**
   * Reset rate limit for a specific client
   *
   * Useful for manual override or testing.
   */
  reset(clientId: string): void {
    this.buckets.delete(clientId);
  }

  /**
   * Reset rate limits for all clients
   */
  resetAll(): void {
    this.buckets.clear();
  }

  /**
   * Get current statistics
   */
  getStats(): {
    totalClients: number;
    config: RateLimitConfig;
  } {
    return {
      totalClients: this.buckets.size,
      config: { ...this.config },
    };
  }

  /**
   * Start periodic cleanup task to remove stale buckets
   *
   * Removes buckets that haven't been used in 2x the window time.
   */
  private startCleanupTask(): void {
    // Only run cleanup if windowMs is configured
    if (!this.config.windowMs) {
      return;
    }

    const cleanupIntervalMs = 5 * 60 * 1000; // 5 minutes

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const staleThreshold = this.config.windowMs! * 2; // 2x window time

      for (const [clientId, bucket] of this.buckets.entries()) {
        if (now - bucket.lastRefill > staleThreshold) {
          this.buckets.delete(clientId);
        }
      }
    }, cleanupIntervalMs);

    // Don't keep Node.js process alive for cleanup task
    this.cleanupInterval.unref();
  }

  /**
   * Get current sampling metrics
   *
   * Returns global quota usage for sampling executions.
   */
  async getMetrics(): Promise<{ roundsUsed: number; tokensUsed: number }> {
    return {
      roundsUsed: this.roundsUsed,
      tokensUsed: this.tokensUsed,
    };
  }

  /**
   * Get remaining quota for sampling
   *
   * Returns how many rounds and tokens remain before hitting limits.
   */
  async getQuotaRemaining(): Promise<{ rounds: number; tokens: number }> {
    return {
      rounds: this.config.maxRoundsPerExecution
        ? Math.max(0, this.config.maxRoundsPerExecution - this.roundsUsed)
        : Infinity,
      tokens: this.config.maxTokensPerExecution
        ? Math.max(0, this.config.maxTokensPerExecution - this.tokensUsed)
        : Infinity,
    };
  }

  /**
   * Check if adding another round would exceed the limit
   */
  async checkRoundLimit(): Promise<{ allowed: boolean }> {
    if (!this.config.maxRoundsPerExecution) {
      return { allowed: true };
    }
    return {
      allowed: this.roundsUsed < this.config.maxRoundsPerExecution,
    };
  }

  /**
   * Check if adding tokens would exceed the limit
   *
   * @param tokensToAdd - Number of tokens to check
   */
  async checkTokenLimit(tokensToAdd: number): Promise<{ allowed: boolean }> {
    if (!this.config.maxTokensPerExecution) {
      return { allowed: true };
    }
    return {
      allowed: this.tokensUsed + tokensToAdd <= this.config.maxTokensPerExecution,
    };
  }

  /**
   * Increment the global rounds counter
   */
  async incrementRounds(): Promise<void> {
    this.roundsUsed++;
  }

  /**
   * Increment the global tokens counter
   *
   * @param tokensToAdd - Number of tokens to add
   */
  async incrementTokens(tokensToAdd: number): Promise<void> {
    this.tokensUsed += tokensToAdd;
  }

  /**
   * Decrement the global rounds counter (for rollback on error)
   *
   * Used when a sampling round fails and needs to be rolled back.
   */
  async decrementRounds(): Promise<void> {
    if (this.roundsUsed === 0) {
      console.warn('[RateLimiter] Attempted to decrement rounds when already at zero');
      return;
    }
    this.roundsUsed--;
  }

  /**
   * Stop cleanup task and release resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.buckets.clear();
    // Reset global quota counters
    this.roundsUsed = 0;
    this.tokensUsed = 0;
  }
}
