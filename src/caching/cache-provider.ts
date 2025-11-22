/**
 * Cache Provider Interface
 *
 * Abstract interface for cache implementations to enable
 * easy swapping between in-memory (LRU) and distributed (Redis) caches.
 *
 * Design Pattern: Strategy Pattern for cache backend flexibility
 */

export interface ICacheProvider<K, V> {
  /**
   * Get value from cache
   */
  get(key: K): V | undefined;

  /**
   * Set value in cache
   */
  set(key: K, value: V): void;

  /**
   * Check if key exists in cache
   */
  has(key: K): boolean;

  /**
   * Delete key from cache
   */
  delete(key: K): boolean;

  /**
   * Clear entire cache
   */
  clear(): void;

  /**
   * Get number of items in cache
   */
  get size(): number;

  /**
   * Get all entries (for serialization)
   */
  entries(): IterableIterator<[K, V]>;
}
