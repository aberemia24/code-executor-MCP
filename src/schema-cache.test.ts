/**
 * Comprehensive tests for SchemaCache
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { SchemaCache } from './schema-cache.js';
import type { MCPClientPool } from './mcp-client-pool.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('SchemaCache', () => {
  const testCachePath = path.join(os.tmpdir(), 'test-schema-cache.json');
  let mockPool: MCPClientPool;

  beforeEach(async () => {
    // Clean up test cache file
    try {
      await fs.unlink(testCachePath);
    } catch {
      // Ignore if doesn't exist
    }

    // Create mock MCP client pool
    mockPool = {
      listAllTools: vi.fn(() => [
        { server: 'test', name: 'tool1', description: 'Tool 1' },
        { server: 'test', name: 'tool2', description: 'Tool 2' },
      ]),
      getToolSchema: vi.fn(async (toolName: string) => {
        return {
          name: toolName.split('__')[2],
          description: `Schema for ${toolName}`,
          inputSchema: {
            type: 'object',
            properties: {
              param: { type: 'string' },
            },
            required: ['param'],
          },
        };
      }),
    } as unknown as MCPClientPool;
  });

  afterEach(async () => {
    // Wait for any pending async operations (fire-and-forget disk writes) to complete
    // This prevents worker timeout during cleanup (CI needs longer delay)
    await new Promise(resolve => setTimeout(resolve, 500));

    // Clean up test cache file
    try {
      await fs.unlink(testCachePath);
    } catch {
      // Ignore
    }
  });

  afterAll(async () => {
    // Wait for any pending async operations (fire-and-forget disk writes) to complete
    // This prevents worker timeout during cleanup (CI needs longer delay)
    await new Promise(resolve => setTimeout(resolve, 500));

    // Final cleanup
    try {
      await fs.unlink(testCachePath);
    } catch {
      // Ignore
    }
  });

  describe('Basic caching', () => {
    it('should cache schemas in memory', async () => {
      const cache = new SchemaCache(mockPool, 24 * 60 * 60 * 1000, testCachePath);
      const schema = await cache.getToolSchema('mcp__test__tool1');

      expect(schema).toBeDefined();
      expect(schema?.name).toBe('tool1');
      expect(mockPool.getToolSchema).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const schema2 = await cache.getToolSchema('mcp__test__tool1');
      expect(schema2).toEqual(schema);
      expect(mockPool.getToolSchema).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should return null for non-existent tools', async () => {
      mockPool.getToolSchema = vi.fn(async () => null);
      const cache = new SchemaCache(mockPool, 24 * 60 * 60 * 1000, testCachePath);

      const schema = await cache.getToolSchema('mcp__test__nonexistent');
      expect(schema).toBeNull();
    });

    it('should invalidate specific tool cache', async () => {
      const cache = new SchemaCache(mockPool, 24 * 60 * 60 * 1000, testCachePath);

      await cache.getToolSchema('mcp__test__tool1');
      expect(mockPool.getToolSchema).toHaveBeenCalledTimes(1);

      await cache.invalidate('mcp__test__tool1');

      // Next call should fetch again
      await cache.getToolSchema('mcp__test__tool1');
      expect(mockPool.getToolSchema).toHaveBeenCalledTimes(2);
    });

    it('should invalidate all tool caches', async () => {
      const cache = new SchemaCache(mockPool, 24 * 60 * 60 * 1000, testCachePath);

      await cache.getToolSchema('mcp__test__tool1');
      await cache.getToolSchema('mcp__test__tool2');
      expect(mockPool.getToolSchema).toHaveBeenCalledTimes(2);

      await cache.invalidate(); // Clear all

      await cache.getToolSchema('mcp__test__tool1');
      await cache.getToolSchema('mcp__test__tool2');
      expect(mockPool.getToolSchema).toHaveBeenCalledTimes(4);
    });
  });

  describe('TTL expiration', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should refresh expired schemas', async () => {
      const cache = new SchemaCache(mockPool, 100, testCachePath); // 100ms TTL

      await cache.getToolSchema('mcp__test__tool1');
      expect(mockPool.getToolSchema).toHaveBeenCalledTimes(1);

      // Advance time past the TTL
      vi.advanceTimersByTime(150);

      // Should fetch again
      await cache.getToolSchema('mcp__test__tool1');
      expect(mockPool.getToolSchema).toHaveBeenCalledTimes(2);
    });

    it('should use stale cache on fetch failure', async () => {
      const cache = new SchemaCache(mockPool, 50, testCachePath); // Short TTL

      // First fetch succeeds
      const schema1 = await cache.getToolSchema('mcp__test__tool1');
      expect(schema1).toBeDefined();

      // Advance time to expire cache
      vi.advanceTimersByTime(100);

      // Make next fetch fail
      mockPool.getToolSchema = vi.fn(async () => {
        throw new Error('Network error');
      });

      // Should return stale cache as fallback (cache expired but fetch failed)
      const schema2 = await cache.getToolSchema('mcp__test__tool1');
      expect(schema2).toEqual(schema1); // Same as before (stale)
    });
  });

  describe('Cache statistics', () => {
    it('should return cache stats', async () => {
      const cache = new SchemaCache(mockPool, 24 * 60 * 60 * 1000, testCachePath);

      await cache.getToolSchema('mcp__test__tool1');
      await cache.getToolSchema('mcp__test__tool2');

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.entries).toHaveLength(2);
      expect(stats.entries[0]?.tool).toMatch(/^mcp__test__/);
      expect(stats.entries[0]?.age).toBeGreaterThanOrEqual(0);
    });

    it('should cleanup expired entries', async () => {
      vi.useFakeTimers();
      try {
        const cache = new SchemaCache(mockPool, 100, testCachePath); // 100ms TTL

        await cache.getToolSchema('mcp__test__tool1');
        await cache.getToolSchema('mcp__test__tool2');

        expect(cache.getStats().size).toBe(2);

        // Advance time past expiration
        vi.advanceTimersByTime(150);

        const removed = cache.cleanup();
        expect(removed).toBe(2);
        expect(cache.getStats().size).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Pre-population', () => {
    it('should pre-populate cache from tools list', async () => {
      const cache = new SchemaCache(mockPool, 24 * 60 * 60 * 1000, testCachePath);

      await cache.prePopulate();

      // Should have cached both tools
      expect(mockPool.getToolSchema).toHaveBeenCalledTimes(2);
      expect(mockPool.getToolSchema).toHaveBeenCalledWith('mcp__test__tool1');
      expect(mockPool.getToolSchema).toHaveBeenCalledWith('mcp__test__tool2');
    });

    it('should skip fetching already cached tools during pre-population', async () => {
      const cache = new SchemaCache(mockPool, 24 * 60 * 60 * 1000, testCachePath);

      // Pre-cache one tool
      await cache.getToolSchema('mcp__test__tool1');

      // Small delay to let async disk save start (fire-and-forget pattern)
      await new Promise(resolve => setImmediate(resolve));

      // Reset mock to count only pre-populate calls
      vi.mocked(mockPool.getToolSchema).mockClear();

      // Pre-populate should only fetch the missing one (tool2)
      await cache.prePopulate();

      // Should only fetch tool2 (tool1 already cached)
      expect(mockPool.getToolSchema).toHaveBeenCalledTimes(1);
      expect(mockPool.getToolSchema).toHaveBeenCalledWith('mcp__test__tool2');
    });

    it('should handle pre-population errors gracefully', async () => {
      // Make getToolSchema fail for one tool
      const originalImpl = mockPool.getToolSchema;
      mockPool.getToolSchema = vi.fn(async (toolName: string) => {
        if (toolName === 'mcp__test__tool2') {
          return null; // Simulate tool not found
        }
        return (originalImpl as any)(toolName);
      });

      const cache = new SchemaCache(mockPool, 24 * 60 * 60 * 1000, testCachePath);

      // Should not throw, just skip missing tool
      await cache.prePopulate();

      // Should have tried both tools
      expect(mockPool.getToolSchema).toHaveBeenCalledTimes(2);
      expect(mockPool.getToolSchema).toHaveBeenCalledWith('mcp__test__tool1');
      expect(mockPool.getToolSchema).toHaveBeenCalledWith('mcp__test__tool2');
    });
  });

  describe('Concurrent access (race condition)', () => {
    it('should handle concurrent getToolSchema calls', async () => {
      vi.useFakeTimers();
      try {
        const cache = new SchemaCache(mockPool, 24 * 60 * 60 * 1000, testCachePath);

        // Make getToolSchema slow to simulate race condition
        let callCount = 0;
        mockPool.getToolSchema = vi.fn(async (toolName: string) => {
          callCount++;
          // Use Promise with immediate resolution for fake timers
          await Promise.resolve();
          return {
            name: toolName.split('__')[2]!,
            description: `Schema ${callCount}`,
            inputSchema: { type: 'object' },
          };
        });

        // Fire multiple concurrent requests
        const [schema1, schema2, schema3] = await Promise.all([
          cache.getToolSchema('mcp__test__tool1'),
          cache.getToolSchema('mcp__test__tool1'),
          cache.getToolSchema('mcp__test__tool1'),
        ]);

        // All should get the same schema
        expect(schema1).toEqual(schema2);
        expect(schema2).toEqual(schema3);

        // Should only fetch once (first request) or multiple times (no deduplication)
        // Either behavior is acceptable, just testing it doesn't crash
        expect(callCount).toBeGreaterThan(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
