/**
 * Schema Cache Module
 *
 * Caches MCP tool schemas fetched from servers to avoid repeated network calls.
 * Schemas are cached with TTL (default 24 hours) and persisted to disk.
 * Uses failure-triggered refresh: only re-fetches when schema validation fails.
 * Thread-safe disk writes using async-lock mutex.
 *
 * PERFORMANCE FIX (v0.3.4):
 * - Replaced unbounded Map with LRU cache (max 1000 entries)
 * - Prevents memory leak (7GB → <100MB in tests)
 * - Automatic eviction of least recently used schemas
 */

import type { IToolSchemaProvider, CachedToolSchema } from './types.js';
import type { ICacheProvider } from './cache-provider.js';
import { LRUCacheProvider } from './lru-cache-provider.js';
import { normalizeError, isErrnoException } from './utils.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import AsyncLock from 'async-lock';

interface CachedSchema {
  schema: CachedToolSchema;
  fetchedAt: number;
  expiresAt: number;
}

export class SchemaCache {
  private cache: ICacheProvider<string, CachedSchema>;
  private readonly ttlMs: number;
  private readonly cachePath: string;
  private readonly lock: AsyncLock;
  private readonly maxCacheSize: number;
  private inFlight: Map<string, Promise<CachedToolSchema | null>>;

  constructor(
    private schemaProvider: IToolSchemaProvider,
    ttlMs: number = 24 * 60 * 60 * 1000, // 24 hours default (long TTL since we use failure-triggered refresh)
    cachePath?: string, // Optional cache path (for testing)
    maxCacheSize: number = 1000 // Max schemas in cache (prevents unbounded growth)
  ) {
    if (ttlMs <= 0) {
      throw new Error('ttlMs must be a positive number');
    }
    if (maxCacheSize <= 0) {
      throw new Error('maxCacheSize must be a positive number');
    }
    this.ttlMs = ttlMs;
    this.maxCacheSize = maxCacheSize;
    this.cachePath = cachePath || path.join(os.homedir(), '.code-executor', 'schema-cache.json');
    this.lock = new AsyncLock();
    this.inFlight = new Map();

    // Initialize LRU cache with size limit and TTL
    this.cache = new LRUCacheProvider<string, CachedSchema>({
      max: this.maxCacheSize,
      ttl: this.ttlMs,
    });
  }

  /**
   * Load cache from disk
   *
   * Respects maxCacheSize limit by prioritizing most recently fetched schemas.
   * This prevents unbounded memory growth when loading historical cache files.
   */
  private async loadFromDisk(): Promise<void> {
    try {
      const data = await fs.readFile(this.cachePath, 'utf-8');
      const parsed = JSON.parse(data);

      // Convert to array and sort by fetchedAt (most recent first)
      const entries = Object.entries(parsed) as Array<[string, CachedSchema]>;
      entries.sort((a, b) => b[1].fetchedAt - a[1].fetchedAt);

      // Load up to maxCacheSize entries (most recent first)
      const entriesToLoad = entries.slice(0, this.maxCacheSize);
      const skipped = entries.length - entriesToLoad.length;

      for (const [toolName, cached] of entriesToLoad) {
        this.cache.set(toolName, cached);
      }

      if (skipped > 0) {
        console.error(`✓ Loaded ${this.cache.size} most recent schemas from disk (skipped ${skipped} old entries)`);
      } else {
        console.error(`✓ Loaded ${this.cache.size} schemas from disk cache`);
      }
    } catch (error) {
      // File doesn't exist or is corrupted - not an error, just start fresh
      // TYPE-001 fix: Use isErrnoException type guard instead of unsafe cast
      if (!isErrnoException(error) || error.code !== 'ENOENT') {
        const err = normalizeError(error);
        console.error('⚠️  Failed to load schema cache from disk:', err.message);
      }
    }
  }

  /**
   * Save cache to disk (thread-safe with mutex lock)
   */
  private async saveToDisk(): Promise<void> {
    // Use lock to prevent concurrent writes (race condition fix)
    await this.lock.acquire('disk-write', async () => {
      try {
        // Ensure directory exists
        await fs.mkdir(path.dirname(this.cachePath), { recursive: true });

        // Convert Map to JSON object
        const cacheObject = Object.fromEntries(this.cache.entries());

        // Serialize to JSON with error handling for edge cases
        let jsonPayload: string;
        try {
          jsonPayload = JSON.stringify(cacheObject, null, 2);
        } catch (serializationError) {
          // TYPE-001 fix: Use normalizeError instead of unsafe cast
          const err = normalizeError(serializationError);
          console.error('⚠️  Failed to serialize schema cache (circular reference or BigInt?):', err.message);
          throw serializationError; // Re-throw to be caught by outer catch
        }

        await fs.writeFile(this.cachePath, jsonPayload, 'utf-8');
      } catch (error) {
        // TYPE-001 fix: Use normalizeError instead of unsafe cast
        const err = normalizeError(error);
        console.error('⚠️  Failed to save schema cache to disk:', err.message);
      }
    });
  }

  /**
   * Pre-populate cache with all available MCP tools
   * Loads from disk first, then fetches missing/expired schemas
   */
  async prePopulate(): Promise<void> {
    console.error('🔄 Pre-populating schema cache...');

    // Load existing cache from disk
    await this.loadFromDisk();

    const allTools = this.schemaProvider.listAllTools();
    const now = Date.now();

    // Only fetch schemas that are missing or expired
    const toolsToFetch = allTools.filter(tool => {
      const fullToolName = `mcp__${tool.server}__${tool.name}`;
      const cached = this.cache.get(fullToolName);

      // Fetch if not cached or expired
      return !cached || cached.expiresAt < now;
    });

    if (toolsToFetch.length === 0) {
      console.error(`✓ All ${allTools.length} schemas loaded from disk (fresh)`);
      return;
    }

    console.error(`  Fetching ${toolsToFetch.length}/${allTools.length} schemas (rest from disk)...`);

    const fetchPromises = toolsToFetch.map(tool => {
      const fullToolName = `mcp__${tool.server}__${tool.name}`;
      return this.getToolSchema(fullToolName).catch(error => {
        console.error(`  ✗ Failed to cache schema for ${fullToolName}:`, error.message);
        return null;
      });
    });

    const results = await Promise.allSettled(fetchPromises);
    const successful = results.filter(r => r.status === 'fulfilled' && r.value !== null).length;

    console.error(`✓ Cached ${successful}/${toolsToFetch.length} new schemas`);

    // Save updated cache to disk
    await this.saveToDisk();
  }

  /**
   * Get schema for a specific tool (format: mcp__server__tool)
   * Deduplicates concurrent requests for the same tool
   */
  async getToolSchema(toolName: string): Promise<CachedToolSchema | null> {
    // Check if request already in-flight (prevents duplicate concurrent fetches)
    const pending = this.inFlight.get(toolName);
    if (pending) {
      return pending;
    }

    // Check cache first
    const cached = this.cache.get(toolName);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.schema;
    }

    // Create promise for this fetch and track it
    const fetchPromise = this.fetchAndCacheSchema(toolName, cached);
    this.inFlight.set(toolName, fetchPromise);

    try {
      return await fetchPromise;
    } finally {
      // Remove from in-flight tracking
      this.inFlight.delete(toolName);
    }
  }

  /**
   * Fetch schema from MCP client pool and cache it
   * Separated from getToolSchema to enable request deduplication
   */
  private async fetchAndCacheSchema(
    toolName: string,
    staleCached?: CachedSchema
  ): Promise<CachedToolSchema | null> {
    try {
      // Fetch schema from schema provider
      const fullSchema = await this.schemaProvider.getToolSchema(toolName);

      if (!fullSchema) {
        return null;
      }

      // Cache the schema
      const schema: CachedToolSchema = {
        name: fullSchema.name,
        description: fullSchema.description,
        inputSchema: fullSchema.inputSchema,
      };

      this.cache.set(toolName, {
        schema,
        fetchedAt: Date.now(),
        expiresAt: Date.now() + this.ttlMs,
      });

      // Save to disk asynchronously (don't await to avoid blocking response)
      this.saveToDisk().catch(err =>
        console.error('⚠️  Failed to save schema cache:', err.message)
      );

      return schema;
    } catch (error) {
      console.error(`Failed to fetch schema for ${toolName}:`, error);

      // If we have stale cache, return it as fallback
      if (staleCached) {
        console.warn(`Using stale cache for ${toolName}`);
        return staleCached.schema;
      }

      throw error;
    }
  }


  /**
   * Invalidate cache for a specific tool or all tools
   * Use this when a schema validation fails (schema may have changed)
   */
  async invalidate(toolName?: string): Promise<void> {
    if (toolName) {
      this.cache.delete(toolName);
      console.error(`🔄 Invalidated schema cache for ${toolName}`);
    } else {
      this.cache.clear();
      console.error('🔄 Invalidated entire schema cache');
    }

    // Save updated cache to disk
    await this.saveToDisk();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; entries: Array<{ tool: string; age: number }> } {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([tool, cached]) => ({
      tool,
      age: Math.floor((now - cached.fetchedAt) / 1000), // seconds
    }));

    return {
      size: this.cache.size,
      entries,
    };
  }

  /**
   * Cleanup expired entries
   *
   * NOTE: With LRU cache, TTL-based expiration is handled automatically.
   * This method is kept for backwards compatibility and explicit cleanup triggers.
   * LRU also automatically evicts least recently used entries when max size is reached.
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [toolName, cached] of this.cache.entries()) {
      if (now >= cached.expiresAt) {
        this.cache.delete(toolName);
        removed++;
      }
    }

    return removed;
  }
}
