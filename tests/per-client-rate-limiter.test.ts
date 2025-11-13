/**
 * Per-Client Rate Limiter Tests (US2: FR-2)
 *
 * Tests for per-client sliding window rate limiting.
 * Prevents single-client resource exhaustion.
 *
 * TDD Approach: Tests written BEFORE implementation (Red-Green-Refactor)
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { PerClientRateLimiter } from '../src/per-client-rate-limiter';

describe('Per-Client Rate Limiter (US2: FR-2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Sliding Window Algorithm (T020)', () => {
    test('should_allowRequest_when_underLimit', async () => {
      const limiter = new PerClientRateLimiter({ maxRequests: 30, windowMs: 60000 });

      const result = await limiter.checkLimit('client_1');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(29); // 30 - 1 used
    });

    test('should_rejectRequest_when_limitExceeded', async () => {
      const limiter = new PerClientRateLimiter({ maxRequests: 3, windowMs: 60000 });

      // Use up the limit
      await limiter.checkLimit('client_1');
      await limiter.checkLimit('client_1');
      await limiter.checkLimit('client_1');

      // 4th request should be rejected
      const result = await limiter.checkLimit('client_1');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    test('should_removeExpiredTimestamps_when_windowPasses', async () => {
      const limiter = new PerClientRateLimiter({ maxRequests: 3, windowMs: 60000 });

      // Use up the limit
      await limiter.checkLimit('client_1');
      await limiter.checkLimit('client_1');
      await limiter.checkLimit('client_1');

      // 4th request rejected
      let result = await limiter.checkLimit('client_1');
      expect(result.allowed).toBe(false);

      // Advance time by 60.001 seconds (window expires, timestamps strictly older)
      await vi.advanceTimersByTimeAsync(60001);

      // Should allow request again (old timestamps removed)
      result = await limiter.checkLimit('client_1');
      expect(result.allowed).toBe(true);
    });
  });

  describe('Boundary Burst Prevention (T021)', () => {
    test('should_preventBurstAt WindowBoundary', async () => {
      const limiter = new PerClientRateLimiter({ maxRequests: 30, windowMs: 60000 });

      // Use 30 requests at t=0s
      for (let i = 0; i < 30; i++) {
        const result = await limiter.checkLimit('client_1');
        expect(result.allowed).toBe(true);
      }

      // Advance to t=59s (still within window)
      await vi.advanceTimersByTimeAsync(59000);

      // Should be rejected (all 30 timestamps still in 60s window)
      const result = await limiter.checkLimit('client_1');
      expect(result.allowed).toBe(false);

      // Advance to t=61s (first timestamp now >60s old)
      await vi.advanceTimersByTimeAsync(2000);

      // Should allow ONE request (oldest timestamp expired)
      const result2 = await limiter.checkLimit('client_1');
      expect(result2.allowed).toBe(true);
    });
  });

  describe('Per-Client Isolation (T022)', () => {
    test('should_isolateClientsIndependently', async () => {
      const limiter = new PerClientRateLimiter({ maxRequests: 3, windowMs: 60000 });

      // Client 1 uses up limit
      await limiter.checkLimit('client_1');
      await limiter.checkLimit('client_1');
      await limiter.checkLimit('client_1');

      // Client 1 rejected
      const result1 = await limiter.checkLimit('client_1');
      expect(result1.allowed).toBe(false);

      // Client 2 should still be allowed (independent bucket)
      const result2 = await limiter.checkLimit('client_2');
      expect(result2.allowed).toBe(true);
    });
  });

  describe('Concurrency Safety (T023)', () => {
    test('should_protectBucketUpdates_when_concurrentRequests', async () => {
      const limiter = new PerClientRateLimiter({ maxRequests: 10, windowMs: 60000 });

      // Simulate 10 concurrent requests from same client
      const promises = Array.from({ length: 10 }, () =>
        limiter.checkLimit('client_1')
      );

      const results = await Promise.all(promises);

      // All 10 should be allowed (exactly at limit)
      const allowed = results.filter((r) => r.allowed);
      expect(allowed.length).toBe(10);

      // 11th request should be rejected
      const result = await limiter.checkLimit('client_1');
      expect(result.allowed).toBe(false);
    });
  });

  describe('Per-Endpoint Overrides (T024)', () => {
    test('should_applyEndpointOverride_when_configured', async () => {
      const limiter = new PerClientRateLimiter({
        maxRequests: 30,
        windowMs: 60000,
        endpointOverrides: {
          discovery: { maxRequests: 60, windowMs: 60000 },
        },
      });

      // Default endpoint (30 req/60s)
      for (let i = 0; i < 30; i++) {
        const result = await limiter.checkLimit('client_1', 'default');
        expect(result.allowed).toBe(true);
      }
      const result1 = await limiter.checkLimit('client_1', 'default');
      expect(result1.allowed).toBe(false);

      // Discovery endpoint (60 req/60s)
      for (let i = 0; i < 60; i++) {
        const result = await limiter.checkLimit('client_2', 'discovery');
        expect(result.allowed).toBe(true);
      }
      const result2 = await limiter.checkLimit('client_2', 'discovery');
      expect(result2.allowed).toBe(false);
    });
  });

  describe('Retry-After Calculation', () => {
    test('should_calculateRetryAfter_when_limitExceeded', async () => {
      const limiter = new PerClientRateLimiter({ maxRequests: 3, windowMs: 60000 });

      // Use up limit at t=0
      await limiter.checkLimit('client_1');
      await limiter.checkLimit('client_1');
      await limiter.checkLimit('client_1');

      // Advance to t=10s
      await vi.advanceTimersByTimeAsync(10000);

      // Check limit again
      const result = await limiter.checkLimit('client_1');
      expect(result.allowed).toBe(false);
      // Retry-after should be ~50s (60s window - 10s elapsed)
      expect(result.retryAfter).toBeGreaterThan(45);
      expect(result.retryAfter).toBeLessThan(55);
    });
  });
});
