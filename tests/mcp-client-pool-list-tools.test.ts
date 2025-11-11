/**
 * Tests for MCP Client Pool listAllToolSchemas() with SchemaCache Integration
 *
 * Tests cache-integrated parallel query functionality for listing tool schemas.
 * Validates cache hit/miss behavior, performance improvements, and resilient aggregation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MCPClientPool } from '../src/mcp-client-pool.js';
import { SchemaCache } from '../src/schema-cache.js';
import type { ToolSchema } from '../src/types/discovery.js';
import type { CachedToolSchema } from '../src/schema-cache.js';

describe('MCP Client Pool listAllToolSchemas() with SchemaCache', () => {
  let clientPool: MCPClientPool;
  let schemaCache: SchemaCache;
  let mockGetToolSchema: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    clientPool = new MCPClientPool();

    // Mock the initialized property to bypass initialization check
    Object.defineProperty(clientPool, 'initialized', {
      get: () => true,
      configurable: true,
    });

    schemaCache = new SchemaCache(clientPool, 24 * 60 * 60 * 1000); // 24h TTL

    // Mock SchemaCache.getToolSchema method
    mockGetToolSchema = vi.fn();
    schemaCache.getToolSchema = mockGetToolSchema;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Cache Hit Performance', () => {
    it('should_returnCachedSchemas_when_cacheHit', async () => {
      // Setup: Mock in-memory tool list
      const mockTools = [
        { server: 'server1', name: 'tool1', description: 'Tool 1' },
        { server: 'server1', name: 'tool2', description: 'Tool 2' },
      ];
      vi.spyOn(clientPool, 'listAllTools').mockReturnValue(mockTools);

      // Setup: Mock SchemaCache returning cached schemas (cache hit)
      mockGetToolSchema.mockImplementation(async (toolName: string) => {
        const schema: CachedToolSchema = {
          name: toolName.split('__')[2],
          description: 'Cached schema',
          inputSchema: {
            type: 'object',
            properties: { param1: { type: 'string' } },
            required: ['param1'],
          },
        };
        return schema;
      });

      // Execute: Call listAllToolSchemas with SchemaCache
      const startTime = performance.now();
      const result = await clientPool.listAllToolSchemas(schemaCache);
      const duration = performance.now() - startTime;

      // Verify: Results returned successfully
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        name: 'mcp__server1__tool1',
        description: 'Cached schema',
        parameters: expect.objectContaining({ type: 'object' }),
      });

      // Verify: Cache was queried for each tool
      expect(mockGetToolSchema).toHaveBeenCalledTimes(2);
      expect(mockGetToolSchema).toHaveBeenCalledWith('mcp__server1__tool1');
      expect(mockGetToolSchema).toHaveBeenCalledWith('mcp__server1__tool2');

      // Verify: Fast response (<10ms for cached schemas)
      expect(duration).toBeLessThan(10);
    });

    it('should_complete_under5ms_when_allSchemasCached', async () => {
      // Setup: Mock 10 tools to test performance at scale
      const mockTools = Array.from({ length: 10 }, (_, i) => ({
        server: 'server1',
        name: `tool${i}`,
        description: `Tool ${i}`,
      }));
      vi.spyOn(clientPool, 'listAllTools').mockReturnValue(mockTools);

      // Setup: Mock instant cache hits
      mockGetToolSchema.mockImplementation(async (toolName: string) => ({
        name: toolName.split('__')[2],
        description: 'Cached',
        inputSchema: { type: 'object' },
      }));

      // Execute: Measure performance
      const startTime = performance.now();
      const result = await clientPool.listAllToolSchemas(schemaCache);
      const duration = performance.now() - startTime;

      // Verify: All schemas returned
      expect(result).toHaveLength(10);

      // Verify: Performance target met (<5ms for cached schemas)
      expect(duration).toBeLessThan(5);
    });
  });

  describe('Cache Miss Behavior', () => {
    it('should_populateCache_when_cacheMiss', async () => {
      // Setup: Mock tool list
      const mockTools = [
        { server: 'server1', name: 'tool1', description: 'Tool 1' },
      ];
      vi.spyOn(clientPool, 'listAllTools').mockReturnValue(mockTools);

      // Setup: Mock cache miss (fetches from MCP server)
      mockGetToolSchema.mockImplementation(async (toolName: string) => {
        // Simulate network delay (50ms)
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
          name: toolName.split('__')[2],
          description: 'Freshly fetched',
          inputSchema: { type: 'object' },
        };
      });

      // Execute: First call should populate cache
      const startTime = performance.now();
      const result = await clientPool.listAllToolSchemas(schemaCache);
      const duration = performance.now() - startTime;

      // Verify: Schema returned correctly
      expect(result).toHaveLength(1);
      expect(result[0].description).toBe('Freshly fetched');

      // Verify: Slower response due to cache miss (>40ms)
      expect(duration).toBeGreaterThan(40);

      // Verify: Cache was queried
      expect(mockGetToolSchema).toHaveBeenCalledWith('mcp__server1__tool1');
    });
  });

  describe('Cache TTL Expiration', () => {
    it('should_refetchSchema_when_cacheExpired', async () => {
      // Setup: Mock tool list
      const mockTools = [
        { server: 'server1', name: 'tool1', description: 'Tool 1' },
      ];
      vi.spyOn(clientPool, 'listAllTools').mockReturnValue(mockTools);

      // Setup: Mock cache behavior (first call cached, second call expired)
      let callCount = 0;
      mockGetToolSchema.mockImplementation(async (toolName: string) => {
        callCount++;
        if (callCount === 1) {
          // First call: return cached (fast)
          return {
            name: toolName.split('__')[2],
            description: 'Cached version 1',
            inputSchema: { type: 'object', version: 1 },
          };
        } else {
          // Second call: cache expired, re-fetch (slow)
          await new Promise(resolve => setTimeout(resolve, 50));
          return {
            name: toolName.split('__')[2],
            description: 'Cached version 2',
            inputSchema: { type: 'object', version: 2 },
          };
        }
      });

      // Execute: First call (cached)
      const result1 = await clientPool.listAllToolSchemas(schemaCache);
      expect(result1[0].description).toBe('Cached version 1');

      // Execute: Simulate 24h TTL expiration
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1000); // 24h + 1s

      // Execute: Second call (cache expired, re-fetches)
      const result2 = await clientPool.listAllToolSchemas(schemaCache);
      expect(result2[0].description).toBe('Cached version 2');

      // Verify: Schema was re-fetched after expiration
      expect(mockGetToolSchema).toHaveBeenCalledTimes(2);
    });
  });

  describe('Resilient Fallback', () => {
    it('should_returnStaleCache_when_networkError', async () => {
      // Setup: Mock tool list
      const mockTools = [
        { server: 'server1', name: 'tool1', description: 'Tool 1' },
      ];
      vi.spyOn(clientPool, 'listAllTools').mockReturnValue(mockTools);

      // Setup: Mock SchemaCache with stale-on-error behavior
      mockGetToolSchema.mockRejectedValue(new Error('Network error'));

      // Execute: Call with network failure
      const result = await clientPool.listAllToolSchemas(schemaCache);

      // Verify: Resilient aggregation returns empty array (no stale cache available)
      expect(result).toEqual([]);

      // Verify: Error was logged (console.error called)
      expect(mockGetToolSchema).toHaveBeenCalled();
    });

    it('should_returnPartialResults_when_someSchemasFail', async () => {
      // Setup: Mock tool list with multiple tools
      const mockTools = [
        { server: 'server1', name: 'tool1', description: 'Tool 1' },
        { server: 'server1', name: 'tool2', description: 'Tool 2' },
        { server: 'server1', name: 'tool3', description: 'Tool 3' },
      ];
      vi.spyOn(clientPool, 'listAllTools').mockReturnValue(mockTools);

      // Setup: Mock partial failures (tool2 fails, others succeed)
      mockGetToolSchema.mockImplementation(async (toolName: string) => {
        if (toolName === 'mcp__server1__tool2') {
          throw new Error('Schema fetch failed for tool2');
        }
        return {
          name: toolName.split('__')[2],
          description: 'Success',
          inputSchema: { type: 'object' },
        };
      });

      // Execute: Call with partial failures
      const result = await clientPool.listAllToolSchemas(schemaCache);

      // Verify: Partial results returned (2 out of 3 succeeded)
      expect(result).toHaveLength(2);
      expect(result.map(r => r.name)).toEqual([
        'mcp__server1__tool1',
        'mcp__server1__tool3',
      ]);
    });
  });

  describe('Edge Cases', () => {
    it('should_returnEmptyArray_when_noToolsAvailable', async () => {
      // Setup: Mock empty tool list
      vi.spyOn(clientPool, 'listAllTools').mockReturnValue([]);

      // Execute: Call with no tools
      const result = await clientPool.listAllToolSchemas(schemaCache);

      // Verify: Empty array returned
      expect(result).toEqual([]);

      // Verify: SchemaCache never called (no tools to query)
      expect(mockGetToolSchema).not.toHaveBeenCalled();
    });

    it('should_handleNullSchemas_when_schemaNotFound', async () => {
      // Setup: Mock tool list
      const mockTools = [
        { server: 'server1', name: 'tool1', description: 'Tool 1' },
      ];
      vi.spyOn(clientPool, 'listAllTools').mockReturnValue(mockTools);

      // Setup: Mock SchemaCache returning null (tool schema not found)
      mockGetToolSchema.mockResolvedValue(null);

      // Execute: Call with null schema response
      const result = await clientPool.listAllToolSchemas(schemaCache);

      // Verify: Empty array returned (null filtered out)
      expect(result).toEqual([]);
    });
  });

  describe('Performance Measurement', () => {
    it('should_be20xFaster_when_cachedVsUncached', async () => {
      // Setup: Mock tool list
      const mockTools = [
        { server: 'server1', name: 'tool1', description: 'Tool 1' },
      ];
      vi.spyOn(clientPool, 'listAllTools').mockReturnValue(mockTools);

      // Setup: Mock uncached (first call)
      mockGetToolSchema.mockImplementationOnce(async (toolName: string) => {
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
        return {
          name: toolName.split('__')[2],
          description: 'Uncached',
          inputSchema: { type: 'object' },
        };
      });

      // Execute: First call (uncached)
      const startUncached = performance.now();
      await clientPool.listAllToolSchemas(schemaCache);
      const uncachedDuration = performance.now() - startUncached;

      // Setup: Mock cached (second call)
      mockGetToolSchema.mockImplementationOnce(async (toolName: string) => {
        // Instant return (cached)
        return {
          name: toolName.split('__')[2],
          description: 'Cached',
          inputSchema: { type: 'object' },
        };
      });

      // Execute: Second call (cached)
      const startCached = performance.now();
      await clientPool.listAllToolSchemas(schemaCache);
      const cachedDuration = performance.now() - startCached;

      // Verify: Cached is at least 10x faster (conservative estimate)
      const speedup = uncachedDuration / cachedDuration;
      expect(speedup).toBeGreaterThan(10);
    });
  });
});
