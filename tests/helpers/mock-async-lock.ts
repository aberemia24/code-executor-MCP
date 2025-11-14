/**
 * Mock AsyncLock for testing
 * Simulates mutex behavior without actual locking
 *
 * Design: Mock executes synchronously for predictable test behavior.
 * Tests should control timing explicitly via vi.advanceTimersByTime(),
 * not through mock delay simulation.
 *
 * @see tests/helpers/timer-utils.ts for fake timer utilities
 */

import { vi } from 'vitest';

export interface MockAsyncLockOptions {
  shouldFail?: boolean;
}

/**
 * Creates a mock AsyncLock instance for testing
 *
 * @param options - Configuration options for the mock lock
 * @returns Mock AsyncLock instance
 *
 * @example
 * ```typescript
 * const lock = createMockAsyncLock();
 * await lock.acquire('key', async () => {
 *   // Critical section executes immediately in tests
 *   return 'result';
 * });
 * ```
 *
 * @example
 * ```typescript
 * // For timing-dependent tests, use fake timers explicitly:
 * setupFakeTimers();
 * const promise = lock.acquire('key', async () => {
 *   await someAsyncOperation(); // This will use fake timers
 *   return 'result';
 * });
 * vi.advanceTimersByTime(1000); // Control timing in test
 * await promise;
 * ```
 */
export function createMockAsyncLock(options: MockAsyncLockOptions = {}) {
  const { shouldFail = false } = options;

  const acquire = vi.fn(<T>(key: string, fn: () => Promise<T> | T): Promise<T> | T => {
    if (shouldFail) {
      throw new Error(`AsyncLock acquisition failed for key: ${key}`);
    }

    // Execute function synchronously (no delay simulation)
    // Tests control timing via vi.advanceTimersByTime() if needed
    return fn();
  });

  const isBusy = vi.fn((key?: string): boolean => {
    return false; // Never busy in tests (mock always acquires immediately)
  });

  return {
    acquire,
    isBusy,
  };
}
