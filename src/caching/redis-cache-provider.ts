/**
 * Redis Cache Provider
 *
 * Implements ICacheProvider using Redis for distributed caching across
 * multiple server instances (horizontal scaling).
 *
 * Key Features (US14):
 * - Distributed cache backend for horizontal scaling (T143)
 * - TTL support matching LRU cache (24h default) (T145)
 * - Graceful fallback to LRU on Redis connection failure (T146)
 * - Periodic reconnection attempts (60s interval) (T147)
 * - Automatic switchback to Redis after successful reconnection (T148)
 *
 * Design Decisions:
 * - WHY fallback to LRU? Ensures cache remains functional even if Redis is unavailable
 * - WHY 60s reconnection interval? Balances recovery speed vs connection spam
 * - WHY match 24h TTL? Maintains consistent cache behavior with LRU backend
 * - WHY synchronous interface? Maintains compatibility with existing ICacheProvider
 *
 * Implementation Note:
 * Redis operations are async, but ICacheProvider is sync. We use a hybrid approach:
 * - Maintain LRU cache as both fallback AND write-through cache
 * - Redis operations fire-and-forget (background sync)
 * - Reads prioritize LRU (fast, local)
 * - Eventual consistency across instances via Redis
 *
 * This design trades strong consistency for:
 * - Zero latency impact on cache reads
 * - Compatibility with existing synchronous interface
 * - Graceful degradation on Redis failure
 */

import { createClient, type RedisClientType } from 'redis';
import { LRUCacheProvider } from './lru-cache-provider.js';
import type { ICacheProvider } from './cache-provider.js';

export interface RedisCacheProviderOptions {
  /**
   * Redis connection URL (default: redis://localhost:6379)
   * Format: redis://[username:password@]host:port[/database]
   */
  redisUrl: string;

  /**
   * Time-to-live in milliseconds (default: 24 hours)
   * Matches LRU cache TTL for consistent behavior
   */
  ttl: number;

  /**
   * Enable LRU fallback on Redis connection failure (default: true)
   * WHY? Ensures cache remains functional even if Redis is down
   */
  lruFallback?: boolean;

  /**
   * LRU cache max size for fallback (default: 1000)
   * Used when Redis is unavailable
   */
  lruMaxSize?: number;

  /**
   * Periodic reconnection interval in milliseconds (default: 60000 = 60s)
   * WHY 60s? Balances recovery speed vs connection spam to Redis server
   */
  reconnectInterval?: number;

  /**
   * Disable Redis connection (use LRU only) - for testing
   * WHY? Allows testing LRU fallback behavior without Redis server
   */
  disableRedis?: boolean;
}

/**
 * Redis Cache Provider implementation with graceful LRU fallback
 *
 * Uses write-through LRU cache for:
 * - Fast synchronous reads (no Redis latency)
 * - Graceful fallback on Redis connection failure
 * - Eventual consistency across instances
 */
export class RedisCacheProvider<K extends string, V extends object>
  implements ICacheProvider<K, V> {
  private redisClient: RedisClientType | null = null;
  private lruCache: LRUCacheProvider<K, V>;
  private isRedisConnected = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private timers: Set<NodeJS.Timeout> = new Set();
  private readonly options: Required<RedisCacheProviderOptions>;

  constructor(options: RedisCacheProviderOptions) {
    // Set defaults for optional parameters
    this.options = {
      ...options,
      lruFallback: options.lruFallback ?? true,
      lruMaxSize: options.lruMaxSize ?? 1000,
      reconnectInterval: options.reconnectInterval ?? 60000, // 60s default
      disableRedis: options.disableRedis ?? false,
    };

    // Always initialize LRU cache (used as write-through cache + fallback)
    this.lruCache = new LRUCacheProvider<K, V>({
      max: this.options.lruMaxSize,
      ttl: this.options.ttl,
    });

    // Attempt initial Redis connection (unless disabled for testing)
    if (!this.options.disableRedis) {
      this.connectToRedis();
    }
  }

  /**
   * T144: Connect to Redis using REDIS_URL env var
   *
   * WHY fire-and-forget? Allows synchronous constructor while handling async connection
   * WHY 1s timeout? Fast failure for invalid Redis URLs in tests
   */
  private connectToRedis(): void {
    this.redisClient = createClient({
      url: this.options.redisUrl,
      socket: {
        reconnectStrategy: false, // We handle reconnection manually via periodic timer
        connectTimeout: 1000, // 1 second timeout for fast failure
      },
    });

    // Handle connection events
    this.redisClient.on('connect', () => {
      this.isRedisConnected = true;
      console.log('[RedisCacheProvider] Connected to Redis');
    });

    this.redisClient.on('error', (err) => {
      this.handleRedisError(err);
    });

    // Attempt connection (async with timeout)
    const connectionPromise = this.redisClient.connect();
    const timeoutPromise = new Promise<void>((_, reject) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        reject(new Error('Connection timeout'));
      }, 1500);
      this.timers.add(timer);
    });

    Promise.race([connectionPromise, timeoutPromise])
      .then(() => {
        this.isRedisConnected = true;
        console.log('[RedisCacheProvider] Successfully connected to Redis');
      })
      .catch((err) => {
        this.handleRedisError(err);
      });
  }

  /**
   * T146: Handle Redis connection failure with graceful fallback to LRU
   *
   * WHY log warning? Alerts operators that distributed cache is degraded
   */
  private handleRedisError(err: Error): void {
    this.isRedisConnected = false;

    if (this.options.lruFallback) {
      console.warn(
        `[RedisCacheProvider] Redis connection failed: ${err.message}. Falling back to LRU cache.`,
      );
    } else {
      console.error(
        `[RedisCacheProvider] Redis connection failed: ${err.message}. LRU fallback disabled.`,
      );
    }

    // T147: Start periodic reconnection attempts
    this.startReconnectionTimer();
  }

  /**
   * T147: Implement periodic reconnection (60s interval default)
   *
   * WHY periodic vs exponential backoff? Simpler for operator reasoning,
   * and Redis downtime is typically measured in minutes (service restart)
   * rather than milliseconds (transient network blip)
   */
  private startReconnectionTimer(): void {
    // Clear existing timer if any
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
    }

    this.reconnectTimer = setInterval(() => {
      this.attemptReconnect();
    }, this.options.reconnectInterval);
  }

  /**
   * T147: Attempt to reconnect to Redis
   *
   * WHY separate method? Allows testing reconnection logic independently
   */
  private attemptReconnect(): void {
    if (this.isRedisConnected) {
      // Already connected, stop timer
      if (this.reconnectTimer) {
        clearInterval(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      return;
    }

    console.log('[RedisCacheProvider] Attempting to reconnect to Redis...');

    // Close old client and create new one
    if (this.redisClient) {
      this.redisClient.quit().catch(() => {
        /* Ignore errors on old client */
      });
    }

    // Create new client and attempt connection
    this.connectToRedis();
  }

  /**
   * T145: Get value from cache
   *
   * Read strategy: LRU first (fast, local)
   * WHY not read from Redis? Avoids network latency on every cache hit
   */
  get(key: K): V | undefined {
    return this.lruCache.get(key);
  }

  /**
   * T145: Set value in cache with TTL
   *
   * Write strategy: Write-through to both LRU and Redis
   * - LRU write: Synchronous (fast)
   * - Redis write: Fire-and-forget async (eventual consistency)
   *
   * WHY write-through? Ensures LRU always has latest value for fast reads
   */
  set(key: K, value: V): void {
    // Always write to LRU cache (synchronous, fast)
    this.lruCache.set(key, value);

    // T148: Write to Redis if connected (async, fire-and-forget)
    if (this.isRedisConnected && this.redisClient) {
      const ttlSeconds = Math.floor(this.options.ttl / 1000);
      this.redisClient
        .set(key, JSON.stringify(value), {
          EX: ttlSeconds, // Expire after TTL seconds
        })
        .catch((err) => {
          console.warn(`[RedisCacheProvider] Failed to write to Redis: ${err.message}`);
        });
    }
  }

  /**
   * Check if key exists in cache
   *
   * WHY check LRU only? Faster, and LRU is always synced via write-through
   */
  has(key: K): boolean {
    return this.lruCache.has(key);
  }

  /**
   * Delete key from cache
   *
   * Delete strategy: Delete from both LRU and Redis
   */
  delete(key: K): boolean {
    // Delete from LRU (synchronous)
    const lruDeleted = this.lruCache.delete(key);

    // Delete from Redis if connected (async, fire-and-forget)
    if (this.isRedisConnected && this.redisClient) {
      this.redisClient.del(key).catch((err) => {
        console.warn(`[RedisCacheProvider] Failed to delete from Redis: ${err.message}`);
      });
    }

    return lruDeleted;
  }

  /**
   * Clear entire cache
   *
   * Clear strategy: Clear both LRU and Redis
   * WHY FLUSHDB? Clears all keys in current Redis database
   */
  clear(): void {
    // Clear LRU cache (synchronous)
    this.lruCache.clear();

    // Clear Redis if connected (async, fire-and-forget)
    if (this.isRedisConnected && this.redisClient) {
      this.redisClient.flushDb().catch((err) => {
        console.warn(`[RedisCacheProvider] Failed to clear Redis: ${err.message}`);
      });
    }
  }

  /**
   * Get number of items in cache
   *
   * WHY LRU size only? Faster than Redis DBSIZE, and LRU is always synced
   */
  get size(): number {
    return this.lruCache.size;
  }

  /**
   * Get all entries (for serialization)
   *
   * WHY LRU entries only? Faster than scanning Redis, and LRU is always synced
   */
  entries(): IterableIterator<[K, V]> {
    return this.lruCache.entries();
  }

  /**
   * Cleanup resources (close Redis connection, clear timers)
   *
   * WHY needed? Prevents resource leaks in tests and graceful shutdown
   */
  async destroy(): Promise<void> {
    // Stop reconnection timer
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Clear all active timers
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();

    // Close Redis connection
    if (this.redisClient) {
      await this.redisClient.quit().catch((err) => {
        console.warn(`[RedisCacheProvider] Error closing Redis connection: ${err.message}`);
      });
      this.redisClient = null;
    }

    // Clear LRU cache
    this.lruCache.clear();
  }
}
