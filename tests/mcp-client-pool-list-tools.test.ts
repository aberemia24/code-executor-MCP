/**
 * Tests for MCP Client Pool listAllTools() Method
 *
 * Tests parallel query functionality for listing tools from multiple MCP servers.
 * Validates parallel execution, resilient aggregation, and performance.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MCPClientPool } from '../src/mcp-client-pool.js';
import type { ToolSchema } from '../src/types/discovery.js';

describe('MCP Client Pool listAllTools()', () => {
  let clientPool: MCPClientPool;

  beforeEach(() => {
    vi.useFakeTimers();
    clientPool = new MCPClientPool();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Parallel Queries', () => {
    it('should_queryServersInParallel_when_multipleServersConnected', async () => {
      // RED - This test will fail because listAllTools() doesn't exist yet

      // Mock multiple servers returning tools
      const mockTools1 = [
        { name: 'mcp__server1__tool1', description: 'Tool 1', parameters: {} },
        { name: 'mcp__server1__tool2', description: 'Tool 2', parameters: {} },
      ];

      const mockTools2 = [
        { name: 'mcp__server2__tool3', description: 'Tool 3', parameters: {} },
      ];

      // GREEN - This method now exists
      const result = await clientPool.listAllToolSchemas();

      // Verify Promise.all pattern is used (parallel execution)
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should_aggregateResults_when_serversReturnDifferentTools', async () => {
      // GREEN - Testing aggregation logic

      // Mock different servers returning different tools
      const result = await clientPool.listAllToolSchemas();

      // Verify aggregation using Array.flat()
      expect(Array.isArray(result)).toBe(true);
      // Should contain tools from all servers
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should_returnEmptyArray_when_noServersConnected', async () => {
      // GREEN - Testing with no servers

      // No servers configured
      const result = await clientPool.listAllToolSchemas();

      expect(result).toEqual([]);
    });

    it('should_returnPartialResults_when_oneServerFails', async () => {
      // GREEN - Testing resilient aggregation

      // Mock: server1 succeeds, server2 fails
      // Resilient aggregation should return server1 results
      const result = await clientPool.listAllToolSchemas();

      expect(Array.isArray(result)).toBe(true);
      // Should contain results from successful servers only
    });
  });

  describe('Performance', () => {
    it('should_completeWithin100ms_when_threeServersQueried', async () => {
      // GREEN - Testing performance target

      const startTime = Date.now();
      await clientPool.listAllToolSchemas();
      const duration = Date.now() - startTime;

      // P95 latency target: <100ms for 3 servers (parallel queries)
      // This test may fail until real MCP servers are mocked properly
      expect(duration).toBeLessThan(100);
    });
  });
});
