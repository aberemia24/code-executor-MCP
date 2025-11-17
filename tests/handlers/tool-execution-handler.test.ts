/**
 * Tool Execution Handler Tests (SMELL-001 God Object Refactor)
 *
 * TDD tests for ToolExecutionHandler - POST / endpoint (critical path).
 * Tests written FIRST (RED phase), then implementation (GREEN phase).
 *
 * @see https://github.com/aberemia24/code-executor-MCP/issues/42
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolExecutionHandler } from '../../src/handlers/tool-execution-handler.js';
import { AllowlistValidator, ToolCallTracker } from '../../src/proxy-helpers.js';
import type { MCPClientPool } from '../../src/mcp-client-pool.js';
import type { SchemaCache } from '../../src/schema-cache.js';
import { SchemaValidator } from '../../src/schema-validator.js';
import { MetricsExporter } from '../../src/metrics-exporter.js';
import type { IncomingMessage, ServerResponse } from 'http';

describe('ToolExecutionHandler', () => {
  let handler: ToolExecutionHandler;
  let allowlistValidator: AllowlistValidator;
  let toolCallTracker: ToolCallTracker;
  let mockMCPClientPool: MCPClientPool;
  let mockSchemaCache: SchemaCache;
  let schemaValidator: SchemaValidator;
  let metricsExporter: MetricsExporter;

  beforeEach(() => {
    allowlistValidator = new AllowlistValidator(['mcp__test__allowed_tool']);
    toolCallTracker = new ToolCallTracker();
    schemaValidator = new SchemaValidator();
    metricsExporter = new MetricsExporter();

    // Mock MCP client pool
    mockMCPClientPool = {
      callTool: vi.fn().mockResolvedValue({ result: 'success' }),
    } as unknown as MCPClientPool;

    // Mock schema cache with valid CachedToolSchema format
    mockSchemaCache = {
      getToolSchema: vi.fn().mockResolvedValue({
        name: 'mcp__test__allowed_tool',
        description: 'Test tool',
        inputSchema: {
          type: 'object',
          properties: {
            param1: { type: 'string' },
          },
          required: ['param1'],
        },
      }),
    } as unknown as SchemaCache;

    handler = new ToolExecutionHandler({
      mcpClientPool: mockMCPClientPool,
      metricsExporter,
      allowlistValidator,
      toolCallTracker,
      schemaCache: mockSchemaCache,
      schemaValidator,
    });
  });

  describe('Happy Path', () => {
    it('should_executeToolSuccessfully_when_validRequest', async () => {
      const mockRequest = createMockPostRequest({
        toolName: 'mcp__test__allowed_tool',
        params: { param1: 'value1' },
      });
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.result).toEqual({ result: 'success' });
    });

    it('should_trackToolCall_when_executionSucceeds', async () => {
      const mockRequest = createMockPostRequest({
        toolName: 'mcp__test__allowed_tool',
        params: { param1: 'value1' },
      });
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      const calls = handler.getToolCalls();
      expect(calls).toContain('mcp__test__allowed_tool');
    });

    it('should_callMCPClientPool_withCorrectParams', async () => {
      const mockRequest = createMockPostRequest({
        toolName: 'mcp__test__allowed_tool',
        params: { param1: 'test-value' },
      });
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(mockMCPClientPool.callTool).toHaveBeenCalledWith(
        'mcp__test__allowed_tool',
        { param1: 'test-value' }
      );
    });
  });

  describe('Allowlist Validation', () => {
    it('should_return403_when_toolNotInAllowlist', async () => {
      const mockRequest = createMockPostRequest({
        toolName: 'mcp__evil__forbidden_tool',
        params: {},
      });
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(mockResponse.writeHead).toHaveBeenCalledWith(403);

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.error).toContain('not in allowlist');
      expect(body.allowedTools).toContain('mcp__test__allowed_tool');
      expect(body.suggestion).toContain('mcp__evil__forbidden_tool');
    });

    it('should_notCallMCPClientPool_when_toolNotAllowed', async () => {
      const mockRequest = createMockPostRequest({
        toolName: 'mcp__evil__forbidden_tool',
        params: {},
      });
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(mockMCPClientPool.callTool).not.toHaveBeenCalled();
    });

    it('should_showEmptyAllowlist_when_noToolsAllowed', async () => {
      const emptyHandler = new ToolExecutionHandler({
        mcpClientPool: mockMCPClientPool,
        metricsExporter,
        allowlistValidator: new AllowlistValidator([]), // Empty allowlist
        toolCallTracker,
        schemaCache: mockSchemaCache,
        schemaValidator,
      });

      const mockRequest = createMockPostRequest({
        toolName: 'mcp__test__any_tool',
        params: {},
      });
      const mockResponse = createMockResponse();

      await emptyHandler.handle(mockRequest, mockResponse, 'valid-token');

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.allowedTools).toContain('(empty - no tools allowed)');
    });
  });

  describe('Schema Validation', () => {
    it('should_return400_when_paramsMissingRequired', async () => {
      const mockRequest = createMockPostRequest({
        toolName: 'mcp__test__allowed_tool',
        params: {}, // Missing required param1
      });
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(mockResponse.writeHead).toHaveBeenCalledWith(400, {
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.error).toContain('param1');
    });

    it('should_return400_when_paramsWrongType', async () => {
      const mockRequest = createMockPostRequest({
        toolName: 'mcp__test__allowed_tool',
        params: { param1: 123 }, // Number instead of string
      });
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(mockResponse.writeHead).toHaveBeenCalledWith(400, {
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.error).toBeDefined();
    });

    it('should_skipValidation_when_noSchemaAvailable', async () => {
      // Mock: No schema available for tool
      vi.spyOn(mockSchemaCache, 'getToolSchema').mockResolvedValue(null);

      const mockRequest = createMockPostRequest({
        toolName: 'mcp__test__allowed_tool',
        params: { anything: 'goes' }, // Any params accepted
      });
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      // Should execute tool despite no schema
      expect(mockMCPClientPool.callTool).toHaveBeenCalled();
      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'application/json',
      });
    });
  });

  describe('Tool Execution Errors', () => {
    it('should_return500_when_toolExecutionFails', async () => {
      vi.spyOn(mockMCPClientPool, 'callTool').mockRejectedValue(
        new Error('MCP tool execution failed')
      );

      const mockRequest = createMockPostRequest({
        toolName: 'mcp__test__allowed_tool',
        params: { param1: 'value1' },
      });
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(mockResponse.writeHead).toHaveBeenCalledWith(500);

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.error).toContain('MCP tool call failed');
      expect(body.error).toContain('MCP tool execution failed');
    });

    it('should_trackFailedToolCall_when_executionFails', async () => {
      vi.spyOn(mockMCPClientPool, 'callTool').mockRejectedValue(
        new Error('Tool error')
      );

      const mockRequest = createMockPostRequest({
        toolName: 'mcp__test__allowed_tool',
        params: { param1: 'value1' },
      });
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      const summary = handler.getToolCallSummary();
      expect(summary).toHaveLength(1);
      expect(summary[0].toolName).toBe('mcp__test__allowed_tool');
      expect(summary[0].errorCount).toBe(1);
      expect(summary[0].lastErrorMessage).toContain('Tool error');
    });

    it('should_recordDuration_when_toolFails', async () => {
      vi.spyOn(mockMCPClientPool, 'callTool').mockRejectedValue(
        new Error('Tool error')
      );

      const mockRequest = createMockPostRequest({
        toolName: 'mcp__test__allowed_tool',
        params: { param1: 'value1' },
      });
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      const summary = handler.getToolCallSummary();
      expect(summary[0].totalDurationMs).toBeGreaterThan(0);
    });
  });

  describe('Request Parsing', () => {
    it('should_return500_when_requestBodyInvalidJSON', async () => {
      const mockRequest = createMockPostRequest('invalid-json{{{');
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(mockResponse.writeHead).toHaveBeenCalledWith(500);

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.error).toBeDefined();
    });

    it('should_parseJSONBody_correctly', async () => {
      const mockRequest = createMockPostRequest({
        toolName: 'mcp__test__allowed_tool',
        params: { param1: 'test' },
      });
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      // Verify tool called with parsed params
      expect(mockMCPClientPool.callTool).toHaveBeenCalledWith(
        'mcp__test__allowed_tool',
        { param1: 'test' }
      );
    });
  });

  describe('Tool Call Tracking', () => {
    it('should_getToolCalls_returnAllCalls', async () => {
      const mockRequest1 = createMockPostRequest({
        toolName: 'mcp__test__allowed_tool',
        params: { param1: 'value1' },
      });
      const mockRequest2 = createMockPostRequest({
        toolName: 'mcp__test__allowed_tool',
        params: { param1: 'value2' },
      });

      await handler.handle(mockRequest1, createMockResponse(), 'token1');
      await handler.handle(mockRequest2, createMockResponse(), 'token2');

      const calls = handler.getToolCalls();
      expect(calls).toHaveLength(2);
      expect(calls[0]).toBe('mcp__test__allowed_tool');
      expect(calls[1]).toBe('mcp__test__allowed_tool');
    });

    it('should_getToolCallSummary_aggregateStats', async () => {
      const mockRequest = createMockPostRequest({
        toolName: 'mcp__test__allowed_tool',
        params: { param1: 'value1' },
      });

      await handler.handle(mockRequest, createMockResponse(), 'token');

      const summary = handler.getToolCallSummary();
      expect(summary).toHaveLength(1);
      expect(summary[0].toolName).toBe('mcp__test__allowed_tool');
      expect(summary[0].callCount).toBe(1);
      expect(summary[0].successCount).toBe(1);
      expect(summary[0].errorCount).toBe(0);
    });
  });

  describe('Metrics Recording', () => {
    it('should_recordSuccessMetrics_when_toolSucceeds', async () => {
      const recordSpy = vi.spyOn(metricsExporter, 'recordHttpRequest');
      const durationSpy = vi.spyOn(metricsExporter, 'recordHttpDuration');

      const mockRequest = createMockPostRequest({
        toolName: 'mcp__test__allowed_tool',
        params: { param1: 'value1' },
      });
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(recordSpy).toHaveBeenCalledWith('POST', 200);
      expect(durationSpy).toHaveBeenCalledWith('POST', '/', expect.any(Number));
    });

    it('should_recordErrorMetrics_when_toolFails', async () => {
      vi.spyOn(mockMCPClientPool, 'callTool').mockRejectedValue(
        new Error('Tool error')
      );

      const recordSpy = vi.spyOn(metricsExporter, 'recordHttpRequest');
      const durationSpy = vi.spyOn(metricsExporter, 'recordHttpDuration');

      const mockRequest = createMockPostRequest({
        toolName: 'mcp__test__allowed_tool',
        params: { param1: 'value1' },
      });
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(recordSpy).toHaveBeenCalledWith('POST', 500);
      expect(durationSpy).toHaveBeenCalledWith('POST', '/', expect.any(Number));
    });

    it('should_record403Metrics_when_allowlistBlocks', async () => {
      const recordSpy = vi.spyOn(metricsExporter, 'recordHttpRequest');

      const mockRequest = createMockPostRequest({
        toolName: 'mcp__evil__forbidden_tool',
        params: {},
      });
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(recordSpy).toHaveBeenCalledWith('POST', 403);
    });

    it('should_record400Metrics_when_schemaValidationFails', async () => {
      const recordSpy = vi.spyOn(metricsExporter, 'recordHttpRequest');

      const mockRequest = createMockPostRequest({
        toolName: 'mcp__test__allowed_tool',
        params: {}, // Missing required param1
      });
      const mockResponse = createMockResponse();

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(recordSpy).toHaveBeenCalledWith('POST', 400);
    });
  });
});

// ============================================================================
// Test Helpers
// ============================================================================

interface MockServerResponse extends ServerResponse {
  _chunks: string[];
}

function createMockPostRequest(body: object | string): IncomingMessage {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const chunks = [Buffer.from(bodyStr)];

  return {
    method: 'POST',
    url: '/',
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  } as unknown as IncomingMessage;
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
