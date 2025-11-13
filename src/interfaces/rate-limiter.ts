/**
 * Rate Limiter Interface
 *
 * Implements per-client sliding window rate limiting.
 * Prevents single client from exhausting server resources.
 *
 * Sliding window algorithm prevents boundary burst attacks:
 * - Fixed window: 30 req at 59s + 30 req at 61s = 60 req in 2s (exploit)
 * - Sliding window: Tracks actual 60s window, prevents burst
 *
 * @see https://konghq.com/blog/how-to-design-a-scalable-rate-limiting-algorithm
 */

export interface RateLimitResult {
  /** Whether request is allowed */
  allowed: boolean;
  /** Remaining requests in current window */
  remaining: number;
  /** Seconds until window resets */
  retryAfter?: number;
  /** Current rate limit (e.g., "30 req/60s") */
  limit: string;
}

export interface IRateLimiter {
  /**
   * Checks if client is within rate limit
   *
   * @param clientId - Unique client identifier (hashed API key)
   * @param endpoint - Optional endpoint for per-endpoint overrides
   * @returns Rate limit result (allowed, remaining, retryAfter)
   * @remarks This method does not throw errors. Rate limit exceeded is indicated by allowed=false in the result.
   */
  checkLimit(clientId: string, endpoint?: string): Promise<RateLimitResult>;

  /**
   * Resets rate limit bucket for a client
   *
   * Use case: Manual override after false positive rate limiting
   *
   * @param clientId - Client identifier to reset
   */
  reset(clientId: string): void;

  /**
   * Gets current rate limit stats for a client
   *
   * @param clientId - Client identifier
   * @returns Current request count and window info
   */
  getStats(clientId: string): {
    requestCount: number;
    windowStartTime: Date;
    maxRequests: number;
    windowMs: number;
  };
}
