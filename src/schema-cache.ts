/**
 * Schema Cache Module
 *
 * Caches MCP tool schemas fetched from servers to avoid repeated network calls.
 * Schemas are cached with TTL (default 24 hours) and persisted to disk.
 * Uses failure-triggered refresh: only re-fetches when schema validation fails.
 * Thread-safe disk writes using async-lock mutex.
 */

import type { MCPClientPool } from './mcp-client-pool.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import AsyncLock from 'async-lock';

interface CachedSchema {
  schema: ToolSchema;
  fetchedAt: number;
  expiresAt: number;
}

export interface ToolSchema {
  name: string;
  description?: string;
  inputSchema: {
    type?: string;
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
  };
}

export class SchemaCache {
  private cache = new Map<string, CachedSchema>();
  private readonly ttlMs: number;
  private readonly cachePath: string;
  private readonly lock: AsyncLock;

  constructor(
    private mcpClientPool: MCPClientPool,
    ttlMs: number = 24 * 60 * 60 * 1000, // 24 hours default (long TTL since we use failure-triggered refresh)
    cachePath?: string // Optional cache path (for testing)
  ) {
    if (ttlMs <= 0) {
      throw new Error('ttlMs must be a positive number');
    }
    this.ttlMs = ttlMs;
    this.cachePath = cachePath || path.join(os.homedir(), '.code-executor', 'schema-cache.json');
    this.lock = new AsyncLock();
  }

  /**
   * Load cache from disk
   */
  private async loadFromDisk(): Promise<void> {
    try {
      const data = await fs.readFile(this.cachePath, 'utf-8');
      const parsed = JSON.parse(data);

      // Restore Map from JSON object
      for (const [toolName, cached] of Object.entries(parsed)) {
        this.cache.set(toolName, cached as CachedSchema);
      }

      console.error(`✓ Loaded ${this.cache.size} schemas from disk cache`);
    } catch (error) {
      // File doesn't exist or is corrupted - not an error, just start fresh
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('⚠️  Failed to load schema cache from disk:', (error as Error).message);
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
          console.error('⚠️  Failed to serialize schema cache (circular reference or BigInt?):', (serializationError as Error).message);
          throw serializationError; // Re-throw to be caught by outer catch
        }

        await fs.writeFile(this.cachePath, jsonPayload, 'utf-8');
      } catch (error) {
        console.error('⚠️  Failed to save schema cache to disk:', (error as Error).message);
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

    const allTools = this.mcpClientPool.listAllTools();
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
   */
  async getToolSchema(toolName: string): Promise<ToolSchema | null> {
    // Check cache first
    const cached = this.cache.get(toolName);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.schema;
    }

    try {
      // Fetch schema from MCP client pool
      const fullSchema = await this.mcpClientPool.getToolSchema(toolName);

      if (!fullSchema) {
        return null;
      }

      // Cache the schema
      const schema: ToolSchema = {
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
      if (cached) {
        console.warn(`Using stale cache for ${toolName}`);
        return cached.schema;
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
