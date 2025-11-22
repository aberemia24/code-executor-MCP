/**
 * Per-Client Rate Limiter (US2: FR-2)
 *
 * Implements sliding window rate limiting with per-client isolation.
 * Prevents single client from exhausting server resources.
 *
 * **WHY Sliding Window?**
 * - Fixed window vulnerable to boundary burst attacks
 * - Example: 30 req at 59s + 30 req at 61s = 60 req in 2 seconds
 * - Sliding window tracks actual timestamp, prevents burst
 *
 * **WHY 30 req/60s default?**
 * - Balances legitimate use vs abuse prevention
 * - Discovery endpoints allow 60 req/60s (higher legitimate traffic)
 * - Configurable via PER_CLIENT_RATE_LIMIT env var
 *
 * @see https://konghq.com/blog/how-to-design-a-scalable-rate-limiting-algorithm
 */

import AsyncLock from 'async-lock';
import type { IRateLimiter, RateLimitResult } from './interfaces/rate-limiter.js';

export interface RateLimitConfig {
  /** Maximum requests allowed per window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Per-endpoint rate limit overrides */
  endpointOverrides?: Record<string, { maxRequests: number; windowMs: number }>;
}

interface RateLimitBucket {
  /** Request timestamps (sorted ascending) */
  timestamps: number[];
  /** Last cleanup time */
  lastCleanup: number;
}

/**
 * Per-Client Rate Limiter
 *
 * Uses sliding window algorithm with AsyncLock for concurrency safety.
 * Each client has independent rate limit bucket.
 */
export class PerClientRateLimiter implements IRateLimiter {
  private readonly config: RateLimitConfig;
  private readonly buckets: Map<string, RateLimitBucket>;
  private readonly lock: AsyncLock;

  constructor(config: RateLimitConfig) {
    this.config = config;
    this.buckets = new Map();
    this.lock = new AsyncLock();
  }

  /**
   * Checks if client is within rate limit
   *
   * Uses sliding window algorithm:
   * 1. Remove expired timestamps (older than windowMs)
   * 2. Check if under limit
   * 3. Add current timestamp if allowed
   *
   * @param clientId - Unique client identifier (hashed API key)
   * @param endpoint - Optional endpoint for per-endpoint overrides
   * @returns Rate limit result (allowed, remaining, retryAfter)
   */
  async checkLimit(clientId: string, endpoint?: string): Promise<RateLimitResult> {
    const bucketKey = endpoint ? `${clientId}:${endpoint}` : clientId;

    // Get config for this endpoint (with override if exists)
    const effectiveConfig = this.getEffectiveConfig(endpoint);

    return await this.lock.acquire(bucketKey, async () => {
      // Get or create bucket
      let bucket = this.buckets.get(bucketKey);
      if (!bucket) {
        bucket = { timestamps: [], lastCleanup: Date.now() };
        this.buckets.set(bucketKey, bucket);
      }

      const now = Date.now();
      const windowStart = now - effectiveConfig.windowMs;

      // Remove expired timestamps (outside window)
      bucket.timestamps = bucket.timestamps.filter((ts) => ts >= windowStart);
      bucket.lastCleanup = now;

      // Check if under limit
      if (bucket.timestamps.length < effectiveConfig.maxRequests) {
        // Allow request
        bucket.timestamps.push(now);

        return {
          allowed: true,
          remaining: effectiveConfig.maxRequests - bucket.timestamps.length,
          limit: `${effectiveConfig.maxRequests} req/${effectiveConfig.windowMs / 1000}s`,
        };
      } else {
        // Reject request (rate limited)
        // Calculate retry-after: time until oldest timestamp expires
        const oldestTimestamp = bucket.timestamps[0] ?? now;
        const retryAfter = Math.ceil((oldestTimestamp + effectiveConfig.windowMs - now) / 1000);

        return {
          allowed: false,
          remaining: 0,
          retryAfter,
          limit: `${effectiveConfig.maxRequests} req/${effectiveConfig.windowMs / 1000}s`,
        };
      }
    });
  }

  /**
   * Resets rate limit bucket for a client
   *
   * Use case: Manual override after false positive rate limiting
   *
   * @param clientId - Client identifier to reset
   */
  reset(clientId: string): void {
    // Remove all buckets for this client (including endpoint-specific)
    const keysToDelete: string[] = [];
    for (const key of this.buckets.keys()) {
      if (key === clientId || key.startsWith(`${clientId}:`)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.buckets.delete(key);
    }
  }

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
  } {
    const bucket = this.buckets.get(clientId);
    const effectiveConfig = this.config;

    if (!bucket || bucket.timestamps.length === 0) {
      return {
        requestCount: 0,
        windowStartTime: new Date(Date.now() - effectiveConfig.windowMs),
        maxRequests: effectiveConfig.maxRequests,
        windowMs: effectiveConfig.windowMs,
      };
    }

    const now = Date.now();
    const windowStart = now - effectiveConfig.windowMs;

    // Count timestamps within window
    const validTimestamps = bucket.timestamps.filter((ts) => ts >= windowStart);

    return {
      requestCount: validTimestamps.length,
      windowStartTime: new Date(windowStart),
      maxRequests: effectiveConfig.maxRequests,
      windowMs: effectiveConfig.windowMs,
    };
  }

  /**
   * Gets effective config for endpoint (with override if exists)
   * @private
   */
  private getEffectiveConfig(endpoint?: string): { maxRequests: number; windowMs: number } {
    if (endpoint && this.config.endpointOverrides?.[endpoint]) {
      return this.config.endpointOverrides[endpoint];
    }
    return {
      maxRequests: this.config.maxRequests,
      windowMs: this.config.windowMs,
    };
  }
}
