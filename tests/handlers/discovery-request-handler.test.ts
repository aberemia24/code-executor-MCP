/**
 * Discovery Request Handler Tests (SMELL-001 God Object Refactor)
 *
 * TDD tests for DiscoveryRequestHandler - GET /mcp/tools endpoint.
 * Tests written FIRST (RED phase), then implementation (GREEN phase).
 *
 * @see https://github.com/aberemia24/code-executor-MCP/issues/42
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DiscoveryRequestHandler } from '../../src/core/handlers/discovery-request-handler.js';
import type { MCPClientPool } from '../../src/mcp/client-pool.js';
import type { SchemaCache } from '../../src/validation/schema-cache.js';
import type { RateLimiter } from '../../src/security/rate-limiter.js';
import { MetricsExporter } from '../../src/observability/metrics-exporter.js';
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
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'mcp__server1__file_read',
      description: 'Read file contents',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'mcp__server2__data_analysis',
      description: 'Analyze data patterns',
      inputSchema: { type: 'object', properties: {} },
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
        remaining: 10,
        resetIn: 60000,
        fillLevel: 0,
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
      vi.useRealTimers();
    });

    describe('handle()', () => {
      it('should_returnAllTools_when_noQueryProvided', async () => {
        const req = createMockRequest('GET', '/mcp/tools');
        const res = createMockResponse();

        await handler.handle(req, res, 'valid-token');

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(getResponseBody(res))).toEqual({
          tools: mockTools,
        });
        expect(mockMCPClientPool.listAllToolSchemas).toHaveBeenCalled();
      });

      it('should_filterTools_when_searchQueryProvided', async () => {
        const req = createMockRequest('GET', '/mcp/tools?q=file');
        const res = createMockResponse();

        await handler.handle(req, res, 'valid-token');

        expect(res.statusCode).toBe(200);
        const data = JSON.parse(getResponseBody(res));
        expect(data.tools.length).toBe(1);
        expect(data.tools[0].name).toContain('file_read');
      });

      it('should_handleMultipleSearchTerms_withORLogic', async () => {
        const req = createMockRequest('GET', '/mcp/tools?q=read&q=code');
        const res = createMockResponse();

        await handler.handle(req, res, 'valid-token');

        expect(res.statusCode).toBe(200);
        const data = JSON.parse(getResponseBody(res));
        expect(data.tools.length).toBe(2); // read_file + code_review
        expect(data.tools.some((t: ToolSchema) => t.name.includes('read'))).toBe(true);
        expect(data.tools.some((t: ToolSchema) => t.name.includes('code'))).toBe(true);
      });

      it('should_returnEmptyList_when_noMatchesFound', async () => {
        const req = createMockRequest('GET', '/mcp/tools?q=nonexistent');
        const res = createMockResponse();

        await handler.handle(req, res, 'valid-token');

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(getResponseBody(res))).toEqual({
          tools: [],
        });
      });

      it('should_return400_when_searchQueryTooLong', async () => {
        const longQuery = 'a'.repeat(101);
        const req = createMockRequest('GET', `/mcp/tools?q=${longQuery}`);
        const res = createMockResponse();

        await handler.handle(req, res, 'valid-token');

        expect(res.statusCode).toBe(400);
        expect(JSON.parse(getResponseBody(res)).error).toContain('too long');
      });

      it('should_return429_when_rateLimitExceeded', async () => {
        vi.mocked(mockRateLimiter.checkLimit).mockResolvedValue({
          allowed: false,
          remaining: 0,
          resetIn: 5000,
          fillLevel: 1
        });

        const req = createMockRequest('GET', '/mcp/tools');
        const res = createMockResponse();

        await handler.handle(req, res, 'valid-token');

        expect(res.statusCode).toBe(429);
      });

      it('should_notCallMCPClientPool_when_rateLimited', async () => {
        vi.mocked(mockRateLimiter.checkLimit).mockResolvedValue({
          allowed: false,
          remaining: 0,
          resetIn: 5000,
          fillLevel: 1
        });

        const req = createMockRequest('GET', '/mcp/tools');
        const res = createMockResponse();

        await handler.handle(req, res, 'valid-token');

        expect(mockMCPClientPool.listAllToolSchemas).not.toHaveBeenCalled();
      });

      it('should_trackMetrics_when_requestHandled', async () => {
        const spy = vi.spyOn(metricsExporter, 'recordHttpRequest');
        const req = createMockRequest('GET', '/mcp/tools');
        const res = createMockResponse();

        await handler.handle(req, res, 'valid-token');

        expect(spy).toHaveBeenCalledWith('GET', 200);
      });

      it('should_handleErrors_gracefully', async () => {
        vi.mocked(mockMCPClientPool.listAllToolSchemas).mockRejectedValue(new Error('Pool error'));

        const req = createMockRequest('GET', '/mcp/tools');
        const res = createMockResponse();

        await handler.handle(req, res, 'valid-token');

        expect(res.statusCode).toBe(500);
        expect(JSON.parse(getResponseBody(res))).toHaveProperty('error');
      });

      it('should_return500_when_discoveryTimesOut', async () => {
        // Mock listAllToolSchemas to hang longer than timeout (500ms)
        vi.spyOn(mockMCPClientPool, 'listAllToolSchemas').mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(mockTools), 1000))
        );

        const mockRequest = createMockRequest('GET', '/mcp/tools');
        const mockResponse = createMockResponse();

        const handlePromise = handler.handle(mockRequest, mockResponse, 'valid-token');

        // Advance time to trigger timeout
        vi.advanceTimersByTime(600);

        await handlePromise;

        expect(mockResponse.statusCode).toBe(500);
        const body = JSON.parse(getResponseBody(mockResponse));
        expect(body.error).toContain('timeout');
      });
    });

    describe('Audit Logging', () => {
      it('should_logDiscoveryRequest_when_successful', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

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

        expect(mockResponse.statusCode).toBe(500);
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
      headers: { host: 'localhost' },
    } as IncomingMessage;
  }

  function createMockResponse(): MockServerResponse {
    const chunks: string[] = [];
    const headers: Record<string, string | number | string[]> = {};

    const mock = {
      statusCode: 200,
      writeHead: vi.fn((status, h) => {
        mock.statusCode = status;
        if (h) Object.assign(headers, h);
        return mock;
      }),
      end: vi.fn((data?: string) => {
        if (data) chunks.push(data);
        return mock;
      }),
      getHeader: vi.fn((name: string) => headers[name]),
      setHeader: vi.fn((name: string, value: string) => {
        headers[name] = value;
        return mock;
      }),
      _chunks: chunks,
    } as unknown as MockServerResponse;

    return mock;
  }

  function getResponseBody(res: MockServerResponse): string {
    return res._chunks.join('');
  }
});
