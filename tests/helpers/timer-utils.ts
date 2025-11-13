/**
 * Timer utilities for testing
 * Provides consistent fake timer setup/teardown
 */

import { vi } from 'vitest';

/**
 * Sets up fake timers for deterministic time control in tests
 *
 * Best practices:
 * - Call in beforeEach()
 * - Use vi.advanceTimersByTime() instead of setTimeout in tests
 * - Call teardownFakeTimers() in afterEach()
 *
 * @example
 * ```typescript
 * beforeEach(() => {
 *   setupFakeTimers();
 * });
 *
 * afterEach(() => {
 *   teardownFakeTimers();
 * });
 *
 * test('should timeout after 30s', async () => {
 *   const promise = queueRequest();
 *   vi.advanceTimersByTime(30000);
 *   await expect(promise).rejects.toThrow('Timeout');
 * });
 * ```
 */
export function setupFakeTimers(): void {
  vi.useFakeTimers();
}

/**
 * Tears down fake timers and restores real timers
 */
export function teardownFakeTimers(): void {
  vi.useRealTimers();
}

/**
 * Advances fake timers by specified milliseconds
 *
 * @param ms - Milliseconds to advance
 */
export function advanceTimersByMs(ms: number): void {
  vi.advanceTimersByTime(ms);
}

/**
 * Runs all pending timers immediately
 */
export function runAllTimers(): void {
  vi.runAllTimers();
}

/**
 * Clears all active timers without executing them
 */
export function clearAllTimers(): void {
  vi.clearAllTimers();
}
