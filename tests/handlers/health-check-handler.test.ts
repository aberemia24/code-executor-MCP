/**
 * Health Check Handler Tests (SMELL-001 God Object Refactor)
 *
 * TDD tests for HealthCheckHandler - NEW endpoint for health checks.
 * Tests written FIRST (RED phase), then implementation (GREEN phase).
 *
 * @see https://github.com/aberemia24/code-executor-MCP/issues/42
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthCheckHandler } from '../../src/handlers/health-check-handler.js';
import type { MCPClientPool } from '../../src/mcp-client-pool.js';
import type { SchemaCache } from '../../src/schema-cache.js';
import { MetricsExporter } from '../../src/metrics-exporter.js';
import type { IncomingMessage, ServerResponse } from 'http';

describe('HealthCheckHandler', () => {
  let handler: HealthCheckHandler;
  let mockMCPClientPool: MCPClientPool;
  let mockSchemaCache: SchemaCache;
  let metricsExporter: MetricsExporter;
  let mockRequest: IncomingMessage;
  let mockResponse: MockServerResponse;

  beforeEach(() => {
    // Mock MCP client pool
    mockMCPClientPool = {
      listAllTools: vi.fn().mockReturnValue([
        { name: 'mcp__test__tool1' },
        { name: 'mcp__test__tool2' },
      ]),
    } as unknown as MCPClientPool;

    // Mock schema cache
    mockSchemaCache = {
      getStats: vi.fn().mockReturnValue({
        size: 10,
        ttlMs: 86400000, // 24 hours
      }),
    } as unknown as SchemaCache;

    metricsExporter = new MetricsExporter();

    handler = new HealthCheckHandler({
      mcpClientPool: mockMCPClientPool,
      metricsExporter,
      schemaCache: mockSchemaCache,
    });

    // Mock request
    mockRequest = {
      method: 'GET',
      url: '/health',
      headers: {},
    } as IncomingMessage;

    // Mock response
    mockResponse = createMockResponse();
  });

  describe('Happy Path', () => {
    it('should_return200_when_systemHealthy', async () => {
      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'application/json',
      });
      expect(mockResponse.end).toHaveBeenCalled();
    });

    it('should_returnHealthyTrue_when_mcpClientsConnected', async () => {
      await handler.handle(mockRequest, mockResponse, 'valid-token');

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.healthy).toBe(true);
    });

    it('should_includeTimestamp_when_responding', async () => {
      await handler.handle(mockRequest, mockResponse, 'valid-token');

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601 format
    });

    it('should_includeUptime_when_responding', async () => {
      // Wait a bit to ensure uptime > 0
      await new Promise((resolve) => setTimeout(resolve, 10));

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.uptime).toBeGreaterThan(0);
      expect(typeof body.uptime).toBe('number');
    });

    it('should_includeMCPClientsStatus_when_responding', async () => {
      await handler.handle(mockRequest, mockResponse, 'valid-token');

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.mcpClients).toBeDefined();
      expect(body.mcpClients.connected).toBe(2); // 2 mock tools
    });

    it('should_includeSchemaCacheStatus_when_responding', async () => {
      await handler.handle(mockRequest, mockResponse, 'valid-token');

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.schemaCache).toBeDefined();
      expect(body.schemaCache.size).toBe(10);
    });
  });

  describe('Unhealthy States', () => {
    it('should_returnHealthyFalse_when_noMCPClientsConnected', async () => {
      // Mock: No MCP clients connected
      vi.spyOn(mockMCPClientPool, 'listAllTools').mockReturnValue([]);

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.healthy).toBe(false);
      expect(body.mcpClients.connected).toBe(0);
    });

    it('should_still200_when_unhealthy', async () => {
      // Mock: No MCP clients (unhealthy state)
      vi.spyOn(mockMCPClientPool, 'listAllTools').mockReturnValue([]);

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      // Health checks should return 200 even when unhealthy
      // (Load balancers use response body to determine health)
      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.healthy).toBe(false);
    });
  });

  describe('Response Structure', () => {
    it('should_includeAllRequiredFields_when_responding', async () => {
      await handler.handle(mockRequest, mockResponse, 'valid-token');

      const body = JSON.parse(getResponseBody(mockResponse));

      // Verify all required fields present
      expect(body).toHaveProperty('healthy');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('uptime');
      expect(body).toHaveProperty('mcpClients');
      expect(body).toHaveProperty('schemaCache');
    });

    it('should_haveCorrectFieldTypes_when_responding', async () => {
      await handler.handle(mockRequest, mockResponse, 'valid-token');

      const body = JSON.parse(getResponseBody(mockResponse));

      expect(typeof body.healthy).toBe('boolean');
      expect(typeof body.timestamp).toBe('string');
      expect(typeof body.uptime).toBe('number');
      expect(typeof body.mcpClients).toBe('object');
      expect(typeof body.schemaCache).toBe('object');
    });
  });

  describe('Integration with Dependencies', () => {
    it('should_callListAllTools_once', async () => {
      const spy = vi.spyOn(mockMCPClientPool, 'listAllTools');

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should_callGetStats_once', async () => {
      const spy = vi.spyOn(mockSchemaCache, 'getStats');

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Uptime Tracking', () => {
    it('should_trackUptime_from_handlerCreation', async () => {
      // Create new handler
      const newHandler = new HealthCheckHandler({
        mcpClientPool: mockMCPClientPool,
        metricsExporter,
        schemaCache: mockSchemaCache,
      });

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      await newHandler.handle(mockRequest, mockResponse, 'valid-token');

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.uptime).toBeGreaterThanOrEqual(50);
      expect(body.uptime).toBeLessThan(150); // Should be around 50ms, not too high
    });

    it('should_incrementUptime_between_requests', async () => {
      // First request
      await handler.handle(mockRequest, mockResponse, 'valid-token');
      const body1 = JSON.parse(getResponseBody(mockResponse));

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second request (reset mock response)
      mockResponse = createMockResponse();
      await handler.handle(mockRequest, mockResponse, 'valid-token');
      const body2 = JSON.parse(getResponseBody(mockResponse));

      // Uptime should have increased
      expect(body2.uptime).toBeGreaterThan(body1.uptime);
    });
  });
});

// ============================================================================
// Test Helpers
// ============================================================================

interface MockServerResponse extends ServerResponse {
  _chunks: string[];
}

function createMockResponse(): MockServerResponse {
  const chunks: string[] = [];

  const mock = {
    writeHead: vi.fn(),
    end: vi.fn((data?: string) => {
      if (data) chunks.push(data);
    }),
    _chunks: chunks,
  } as unknown as MockServerResponse;

  return mock;
}

function getResponseBody(res: MockServerResponse): string {
  return res._chunks.join('');
}
