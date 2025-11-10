/**
 * LRU Cache Provider
 *
 * Implements ICacheProvider using the lru-cache library.
 * Provides automatic eviction of least recently used entries when max size is reached.
 *
 * Key Features:
 * - Size-based eviction (prevents unbounded growth)
 * - TTL support (time-based expiration)
 * - Thread-safe operations
 * - O(1) get/set performance
 */

import { LRUCache } from 'lru-cache';
import type { ICacheProvider } from './cache-provider.js';

export interface LRUCacheOptions {
  /**
   * Maximum number of items in cache (default: 1000)
   * Prevents unbounded memory growth
   */
  max: number;

  /**
   * Time-to-live in milliseconds (default: 24 hours)
   * Items expire after this duration
   */
  ttl?: number;
}

/**
 * LRU Cache Provider implementation using lru-cache library
 * Uses string keys for compatibility with schema cache use case
 */
export class LRUCacheProvider<K extends string, V extends object> implements ICacheProvider<K, V> {
  private cache: LRUCache<K, V>;

  constructor(options: LRUCacheOptions) {
    if (options.max <= 0) {
      throw new Error('max must be a positive number');
    }

    this.cache = new LRUCache<K, V>({
      max: options.max,
      ttl: options.ttl,
      // Update access time on get (ensures LRU is accurate)
      updateAgeOnGet: true,
      // Allow stale items to be returned if they exist
      // Matches stale-on-error resilience pattern (schema-cache.ts:192-195)
      allowStale: true,
    });
  }

  get(key: K): V | undefined {
    return this.cache.get(key);
  }

  set(key: K, value: V): void {
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  entries(): IterableIterator<[K, V]> {
    return this.cache.entries();
  }
}
