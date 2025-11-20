/**
 * Rate Limiter for Sampling Requests
 *
 * Enforces execution quotas to prevent:
 * - Infinite loops (max rounds per execution)
 * - Resource exhaustion (max tokens per execution)
 *
 * **WHY Separate Class?**
 * - Single Responsibility Principle (SRP): Only rate limiting, no HTTP/auth concerns
 * - Bridge server had 5+ responsibilities (violated SRP)
 * - Independent testing and reusability
 *
 * **WHY AsyncLock?**
 * - Prevents race conditions in concurrent async updates
 * - Node.js is single-threaded but async calls can interleave
 * - Ensures atomic increment operations
 *
 * @see specs/001-mcp-sampling/spec.md (FR-3)
 */

import AsyncLock from 'async-lock';

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  allowed: boolean;
  quotaRemaining: {
    rounds: number;
    tokens: number;
  };
  reason?: string;
}

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
  maxRoundsPerExecution: number;
  maxTokensPerExecution: number;
}

/**
 * Rate limiter for sampling requests
 *
 * **Thread Safety:**
 * - All mutations protected by AsyncLock
 * - Safe for concurrent async calls
 */
export class RateLimiter {
  private roundsUsed = 0;
  private tokensUsed = 0;
  private readonly lock = new AsyncLock();
  private readonly config: RateLimiterConfig;

  constructor(config: RateLimiterConfig) {
    this.config = config;
  }

  /**
   * Check if round limit would be exceeded
   *
   * **WHY Before Increment?**
   * - Fail fast: Don't waste resources if limit already exceeded
   * - Clear error messages with quota remaining
   *
   * @returns Rate limit check result
   */
  async checkRoundLimit(): Promise<RateLimitResult> {
    return await this.lock.acquire('rate-limit', async () => {
      const roundsRemaining = Math.max(0, this.config.maxRoundsPerExecution - this.roundsUsed);
      const tokensRemaining = Math.max(0, this.config.maxTokensPerExecution - this.tokensUsed);

      if (this.roundsUsed >= this.config.maxRoundsPerExecution) {
        return {
          allowed: false,
          quotaRemaining: { rounds: roundsRemaining, tokens: tokensRemaining },
          reason: `Round limit exceeded: ${this.roundsUsed}/${this.config.maxRoundsPerExecution} rounds used, ${roundsRemaining} remaining`
        };
      }

      return {
        allowed: true,
        quotaRemaining: { rounds: roundsRemaining, tokens: tokensRemaining }
      };
    });
  }

  /**
   * Check if token limit would be exceeded by adding tokensToAdd
   *
   * @param tokensToAdd - Tokens that would be used by this request
   * @returns Rate limit check result
   */
  async checkTokenLimit(tokensToAdd: number): Promise<RateLimitResult> {
    return await this.lock.acquire('rate-limit', async () => {
      const roundsRemaining = Math.max(0, this.config.maxRoundsPerExecution - this.roundsUsed);
      const tokensRemaining = Math.max(0, this.config.maxTokensPerExecution - this.tokensUsed);

      if (this.tokensUsed + tokensToAdd > this.config.maxTokensPerExecution) {
        return {
          allowed: false,
          quotaRemaining: { rounds: roundsRemaining, tokens: tokensRemaining },
          reason: `Token limit exceeded: ${this.tokensUsed + tokensToAdd}/${this.config.maxTokensPerExecution} tokens would be used, ${tokensRemaining} remaining`
        };
      }

      return {
        allowed: true,
        quotaRemaining: { rounds: roundsRemaining, tokens: tokensRemaining }
      };
    });
  }

  /**
   * Increment round counter (atomic operation)
   *
   * **WHY AsyncLock?**
   * - Prevents race condition: read-modify-write must be atomic
   * - Example race: two concurrent calls both read roundsUsed=5, both increment to 6
   * - AsyncLock ensures: first increments 5→6, second increments 6→7
   */
  async incrementRounds(): Promise<void> {
    await this.lock.acquire('rate-limit', async () => {
      this.roundsUsed++;
    });
  }

  /**
   * Increment token counter (atomic operation)
   *
   * @param tokensUsed - Number of tokens used by this request
   */
  async incrementTokens(tokensUsed: number): Promise<void> {
    await this.lock.acquire('rate-limit', async () => {
      this.tokensUsed += tokensUsed;
    });
  }

  /**
   * Get current usage metrics
   *
   * @returns Current rounds and tokens used
   */
  async getMetrics(): Promise<{ roundsUsed: number; tokensUsed: number }> {
    return await this.lock.acquire('rate-limit', async () => {
      return {
        roundsUsed: this.roundsUsed,
        tokensUsed: this.tokensUsed
      };
    });
  }

  /**
   * Get quota remaining
   *
   * @returns Remaining rounds and tokens
   */
  async getQuotaRemaining(): Promise<{ rounds: number; tokens: number }> {
    return await this.lock.acquire('rate-limit', async () => {
      return {
        rounds: Math.max(0, this.config.maxRoundsPerExecution - this.roundsUsed),
        tokens: Math.max(0, this.config.maxTokensPerExecution - this.tokensUsed)
      };
    });
  }

  /**
   * Reset counters (for testing or new execution)
   */
  async reset(): Promise<void> {
    await this.lock.acquire('rate-limit', async () => {
      this.roundsUsed = 0;
      this.tokensUsed = 0;
    });
  }
}
