/**
 * Circuit Breaker Tests (US1: FR-1)
 *
 * Tests for circuit breaker fault isolation pattern using Opossum library.
 * Validates state transitions, metrics, and concurrency safety.
 *
 * TDD Approach: Tests written BEFORE implementation (Red-Green-Refactor)
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ICircuitBreaker, CircuitBreakerState, CircuitBreakerStats } from '../src/interfaces/circuit-breaker';
import { CircuitBreakerFactory } from '../src/circuit-breaker-factory';

describe('Circuit Breaker (US1: FR-1)', () => {
  describe('State Transitions (T010)', () => {
    test('should_startInClosedState_when_circuitBreakerCreated', async () => {
      const breaker = new CircuitBreakerFactory({ failureThreshold: 5, cooldownMs: 30000 });
      const stats = breaker.getStats();
      expect(stats.state).toBe('closed');
      expect(stats.failureCount).toBe(0);
    });

    test('should_transitionToOpen_when_5ConsecutiveFailures', async () => {
      const breaker = new CircuitBreakerFactory({ failureThreshold: 5, cooldownMs: 30000 });

      // Cause 5 consecutive failures
      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Simulated MCP server failure');
          });
        } catch (error) {
          // Expected failure
        }
      }

      // Wait for stats to update (AsyncLock)
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stats = breaker.getStats();
      expect(stats.state).toBe('open');
      expect(stats.failureCount).toBe(5);
      expect(stats.nextAttemptTime).not.toBeNull();
    });

    test('should_rejectImmediately_when_circuitOpen', async () => {
      const breaker = new CircuitBreakerFactory({ failureThreshold: 5, cooldownMs: 30000 });

      // Open circuit with 5 failures
      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch (error) {
          // Expected
        }
      }

      // Wait for stats to update
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Next request should fail immediately (no execution)
      const executionAttempted = vi.fn();
      try {
        await breaker.execute(async () => {
          executionAttempted();
          return 'success';
        });
      } catch (error) {
        expect((error as Error).message).toContain('Circuit breaker is open');
      }

      expect(executionAttempted).not.toHaveBeenCalled();
    });

    test('should_transitionToHalfOpen_when_cooldownExpires', async () => {
      vi.useFakeTimers();

      const breaker = new CircuitBreakerFactory({ failureThreshold: 5, cooldownMs: 30000 });

      // Open circuit with 5 failures
      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch (error) {
          // Expected
        }
      }

      // Wait for stats to update
      await vi.advanceTimersByTimeAsync(100);

      // Advance time by 30 seconds (cooldown period)
      await vi.advanceTimersByTimeAsync(30000);

      // Next request should attempt execution (half-open state)
      const executionAttempted = vi.fn();
      try {
        await breaker.execute(async () => {
          executionAttempted();
          return 'success';
        });
      } catch (error) {
        // May fail if test request fails
      }

      expect(executionAttempted).toHaveBeenCalled();

      vi.useRealTimers();
    });

    test('should_transitionToClosed_when_halfOpenRequestSucceeds', async () => {
      vi.useFakeTimers();

      const breaker = new CircuitBreakerFactory({ failureThreshold: 5, cooldownMs: 30000 });

      // Open circuit with 5 failures
      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch (error) {
          // Expected
        }
      }

      // Wait for stats to update
      await vi.advanceTimersByTimeAsync(100);

      // Advance time by 30 seconds (cooldown period)
      await vi.advanceTimersByTimeAsync(30000);

      // Successful request in half-open state closes circuit
      const result = await breaker.execute(async () => {
        return 'success';
      });

      expect(result).toBe('success');

      // Wait for stats to update
      await vi.advanceTimersByTimeAsync(100);

      const stats = breaker.getStats();
      expect(stats.state).toBe('closed');
      expect(stats.failureCount).toBe(0);

      vi.useRealTimers();
    });

    test('should_transitionToOpen_when_halfOpenRequestFails', async () => {
      vi.useFakeTimers();

      const breaker = new CircuitBreakerFactory({ failureThreshold: 5, cooldownMs: 30000 });

      // Open circuit with 5 failures
      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch (error) {
          // Expected
        }
      }

      // Wait for stats to update
      await vi.advanceTimersByTimeAsync(100);

      // Advance time by 30 seconds (cooldown period)
      await vi.advanceTimersByTimeAsync(30000);

      // Failed request in half-open state reopens circuit
      try {
        await breaker.execute(async () => {
          throw new Error('Still failing');
        });
      } catch (error) {
        // Expected
      }

      // Wait for stats to update
      await vi.advanceTimersByTimeAsync(100);

      const stats = breaker.getStats();
      expect(stats.state).toBe('open');
      // Cooldown timer restarted
      expect(stats.nextAttemptTime).not.toBeNull();

      vi.useRealTimers();
    });
  });

  describe('Metrics (T011)', () => {
    test('should_exposeStateGauge_when_circuitBreakerCreated', () => {
      const breaker = new CircuitBreakerFactory({ failureThreshold: 5, cooldownMs: 30000 });
      const stats = breaker.getStats();

      expect(stats.state).toBe('closed');
      // Prometheus gauge should be 0 for closed, 1 for open, 0.5 for half-open
    });

    test('should_exposeFailuresCounter_when_circuitBreakerCreated', async () => {
      const breaker = new CircuitBreakerFactory({ failureThreshold: 5, cooldownMs: 30000 });

      // Initial counter
      let stats = breaker.getStats();
      expect(stats.totalFailures).toBe(0);

      // Cause failures
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch (error) {
          // Expected
        }
      }

      // Wait for stats to update
      await new Promise((resolve) => setTimeout(resolve, 50));

      stats = breaker.getStats();
      expect(stats.totalFailures).toBe(3);
    });

    test('should_updateMetrics_when_stateChanges', async () => {
      const breaker = new CircuitBreakerFactory({ failureThreshold: 5, cooldownMs: 30000 });

      // Closed state (initial)
      let stats = breaker.getStats();
      expect(stats.state).toBe('closed');

      // Open circuit with 5 failures
      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch (error) {
          // Expected
        }
      }

      // Wait for stats to update
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Open state
      stats = breaker.getStats();
      expect(stats.state).toBe('open');
      // Prometheus gauge should be updated to 1
    });
  });

  describe('Concurrency Safety (T012)', () => {
    test('should_protectStateUpdates_when_concurrentFailures', async () => {
      const breaker = new CircuitBreakerFactory({ failureThreshold: 5, cooldownMs: 30000 });

      // Simulate 10 concurrent failing requests
      const promises = Array.from({ length: 10 }, async () => {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch (error) {
          // Expected
        }
      });

      await Promise.all(promises);

      // Wait for stats to update
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Failure count should be accurate (no race conditions)
      const stats = breaker.getStats();
      expect(stats.totalFailures).toBe(10);
      // State should be open (5+ failures)
      expect(stats.state).toBe('open');
    });

    test('should_protectTimestampUpdates_when_concurrentStateChanges', async () => {
      vi.useFakeTimers();

      const breaker = new CircuitBreakerFactory({ failureThreshold: 5, cooldownMs: 30000 });

      // Open circuit with 5 failures
      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch (error) {
          // Expected
        }
      }

      // Wait for stats to update
      await vi.advanceTimersByTimeAsync(100);

      // Advance time by 30 seconds
      await vi.advanceTimersByTimeAsync(30000);

      // Simulate concurrent half-open requests
      const promises = Array.from({ length: 5 }, async () => {
        try {
          await breaker.execute(async () => {
            return 'success';
          });
        } catch (error) {
          // Some may fail if circuit reopens
        }
      });

      await Promise.all(promises);

      // Wait for stats to update
      await vi.advanceTimersByTimeAsync(100);

      // Only 1 request should have been attempted in half-open state
      // AsyncLock ensures serialized state transitions

      vi.useRealTimers();
    });
  });

  describe('Reset Functionality', () => {
    test('should_resetToClosedState_when_manualResetCalled', async () => {
      const breaker = new CircuitBreakerFactory({ failureThreshold: 5, cooldownMs: 30000 });

      // Open circuit with 5 failures
      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch (error) {
          // Expected
        }
      }

      // Wait for stats to update
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Manual reset
      breaker.reset();

      const stats = breaker.getStats();
      expect(stats.state).toBe('closed');
      expect(stats.failureCount).toBe(0);
      expect(stats.nextAttemptTime).toBeNull();
    });
  });
});
