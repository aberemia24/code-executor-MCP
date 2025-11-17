/**
 * Discovery Request Handler Tests (SMELL-001 God Object Refactor)
 *
 * TDD tests for DiscoveryRequestHandler - GET /mcp/tools endpoint.
 * Tests written FIRST (RED phase), then implementation (GREEN phase).
 *
 * @see https://github.com/aberemia24/code-executor-MCP/issues/42
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DiscoveryRequestHandler } from '../../src/handlers/discovery-request-handler.js';
import type { MCPClientPool } from '../../src/mcp-client-pool.js';
import type { SchemaCache } from '../../src/schema-cache.js';
import type { RateLimiter } from '../../src/rate-limiter.js';
import { MetricsExporter } from '../../src/metrics-exporter.js';
import type { ToolSchema } from '../../src/types/discovery.js';
import type { IncomingMessage, ServerResponse } from 'http';

describe('DiscoveryRequestHandler', () => {
  let handler: DiscoveryRequestHandler;
  let mockMCPClientPool: MCPClientPool;
  let mockSchemaCache: SchemaCache;
  let mockRateLimiter: RateLimiter;
  let metricsExporter: MetricsExporter;

  const mockTools: ToolSchema[] = [
    {
      name: 'mcp__server1__code_review',
      description: 'Review code for quality',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'mcp__server1__file_read',
      description: 'Read file contents',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'mcp__server2__data_analysis',
      description: 'Analyze data patterns',
      parameters: { type: 'object', properties: {} },
    },
  ];

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Mock MCP client pool
    mockMCPClientPool = {
      listAllToolSchemas: vi.fn().mockResolvedValue(mockTools),
    } as unknown as MCPClientPool;

    mockSchemaCache = {} as SchemaCache;

    // Mock rate limiter (default: allowed)
    mockRateLimiter = {
      checkLimit: vi.fn().mockResolvedValue({
        allowed: true,
        resetIn: 60000,
      }),
    } as unknown as RateLimiter;

    metricsExporter = new MetricsExporter();

    handler = new DiscoveryRequestHandler({
      mcpClientPool: mockMCPClientPool,
      metricsExporter,
      schemaCache: mockSchemaCache,
      rateLimiter: mockRateLimiter,
      discoveryTimeoutMs: 500,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Happy Path - No Search Query', () => {
    it('should_returnAllTools_when_noSearchProvided', async () => {
      const mockRequest = createMockRequest('GET', '/mcp/tools');
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.tools).toHaveLength(3);
      expect(body.tools[0].name).toBe('mcp__server1__code_review');
    });

    it('should_callMCPClientPool_once', async () => {
      const mockRequest = createMockRequest('GET', '/mcp/tools');
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(mockMCPClientPool.listAllToolSchemas).toHaveBeenCalledTimes(1);
      expect(mockMCPClientPool.listAllToolSchemas).toHaveBeenCalledWith(mockSchemaCache);
    });
  });

  describe('Search Filtering', () => {
    it('should_returnFilteredTools_when_singleKeywordProvided', async () => {
      const mockRequest = createMockRequest('GET', '/mcp/tools?q=code');
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].name).toBe('mcp__server1__code_review');
    });

    it('should_returnFilteredTools_when_multipleKeywordsProvided', async () => {
      const mockRequest = createMockRequest('GET', '/mcp/tools?q=code&q=file');
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.tools).toHaveLength(2); // Both code_review and file_read match
    });

    it('should_useCaseInsensitiveMatching_when_searching', async () => {
      const mockRequest = createMockRequest('GET', '/mcp/tools?q=CODE');
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].name).toBe('mcp__server1__code_review');
    });

    it('should_matchInDescription_when_searching', async () => {
      const mockRequest = createMockRequest('GET', '/mcp/tools?q=quality');
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].name).toBe('mcp__server1__code_review');
    });

    it('should_returnEmpty_when_noToolsMatch', async () => {
      const mockRequest = createMockRequest('GET', '/mcp/tools?q=nonexistent');
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.tools).toHaveLength(0);
    });
  });

  describe('Rate Limiting', () => {
    it('should_return429_when_rateLimitExceeded', async () => {
      vi.spyOn(mockRateLimiter, 'checkLimit').mockResolvedValue({
        allowed: false,
        resetIn: 30000,
      });

      const mockRequest = createMockRequest('GET', '/mcp/tools');
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(mockResponse.writeHead).toHaveBeenCalledWith(429, {
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.error).toContain('Rate limit exceeded');
      expect(body.retryAfter).toBe(30);
      expect(body.limit).toBe(30);
      expect(body.window).toBe('60s');
    });

    it('should_notCallMCPClientPool_when_rateLimited', async () => {
      vi.spyOn(mockRateLimiter, 'checkLimit').mockResolvedValue({
        allowed: false,
        resetIn: 30000,
      });

      const mockRequest = createMockRequest('GET', '/mcp/tools');
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(mockMCPClientPool.listAllToolSchemas).not.toHaveBeenCalled();
    });
  });

  describe('Query Validation', () => {
    it('should_return400_when_searchQueryTooLong', async () => {
      const longQuery = 'a'.repeat(101); // MAX is 100
      const mockRequest = createMockRequest('GET', `/mcp/tools?q=${longQuery}`);
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(mockResponse.writeHead).toHaveBeenCalledWith(400, {
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.error).toContain('too long');
      expect(body.query).toBe(longQuery);
    });

    it('should_return400_when_searchQueryHasInvalidCharacters', async () => {
      const mockRequest = createMockRequest('GET', '/mcp/tools?q=<script>alert()</script>');
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(mockResponse.writeHead).toHaveBeenCalledWith(400, {
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.error).toContain('Invalid characters');
    });

    it('should_allowValidCharacters_when_validating', async () => {
      const mockRequest = createMockRequest('GET', '/mcp/tools?q=code-review_2024');
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'application/json',
      });
    });
  });

  describe('Timeout Handling', () => {
    it('should_return500_when_discoveryTimesOut', async () => {
      // Mock listAllToolSchemas to hang longer than timeout (500ms)
      vi.spyOn(mockMCPClientPool, 'listAllToolSchemas').mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockTools), 1000))
      );

      const mockRequest = createMockRequest('GET', '/mcp/tools');
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(mockResponse.writeHead).toHaveBeenCalledWith(500, {
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.error).toContain('timeout');
    });

    it('should_clearTimeout_when_requestCompletesBeforeTimeout', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      const mockRequest = createMockRequest('GET', '/mcp/tools');
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      // Timeout should be cleared to prevent memory leaks
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });

  describe('Audit Logging', () => {
    it('should_logDiscoveryRequest_when_successful', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const mockRequest = createMockRequest('GET', '/mcp/tools?q=test');
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      // Verify audit log emitted
      expect(consoleSpy).toHaveBeenCalled();
      const logCalls = consoleSpy.mock.calls.map((call) => call[0]);
      const discoveryLog = logCalls.find((log) =>
        typeof log === 'string' && log.includes('discovery')
      );

      expect(discoveryLog).toBeDefined();
      if (discoveryLog) {
        const logData = JSON.parse(discoveryLog);
        expect(logData.action).toBe('discovery');
        expect(logData.endpoint).toBe('/mcp/tools');
        expect(logData.searchTerms).toContain('test');
        expect(logData.resultsCount).toBeDefined();
      }

      consoleSpy.mockRestore();
    });
  });

  describe('Error Handling', () => {
    it('should_return500_when_mcpClientPoolThrows', async () => {
      vi.spyOn(mockMCPClientPool, 'listAllToolSchemas').mockRejectedValue(
        new Error('MCP server error')
      );

      const mockRequest = createMockRequest('GET', '/mcp/tools');
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(mockResponse.writeHead).toHaveBeenCalledWith(500, {
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.error).toContain('Discovery request failed');
    });
  });
});

// ============================================================================
// Test Helpers
// ============================================================================

interface MockServerResponse extends ServerResponse {
  _chunks: string[];
}

function createMockRequest(method: string, url: string): IncomingMessage {
  return {
    method,
    url,
    headers: {},
  } as IncomingMessage;
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
