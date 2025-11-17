/**
 * Metrics Request Handler Tests (SMELL-001 God Object Refactor)
 *
 * TDD tests for MetricsRequestHandler extracted from MCPProxyServer.
 * Tests written FIRST (RED phase), then implementation (GREEN phase).
 *
 * @see https://github.com/aberemia24/code-executor-MCP/issues/42
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetricsRequestHandler } from '../../src/handlers/metrics-request-handler.js';
import { MetricsExporter } from '../../src/metrics-exporter.js';
import type { IncomingMessage, ServerResponse } from 'http';

describe('MetricsRequestHandler', () => {
  let handler: MetricsRequestHandler;
  let metricsExporter: MetricsExporter;
  let mockRequest: IncomingMessage;
  let mockResponse: MockServerResponse;

  beforeEach(() => {
    metricsExporter = new MetricsExporter();
    handler = new MetricsRequestHandler(metricsExporter);

    // Mock request
    mockRequest = {
      method: 'GET',
      url: '/metrics',
      headers: {},
    } as IncomingMessage;

    // Mock response with captured output
    mockResponse = createMockResponse();
  });

  describe('Happy Path', () => {
    it('should_return200_when_metricsAvailable', async () => {
      // Setup: Record some metrics
      metricsExporter.recordCacheHit('schema');
      metricsExporter.recordHttpRequest('GET', 200);

      // Execute
      await handler.handle(mockRequest, mockResponse, 'valid-token');

      // Verify: 200 OK with Prometheus text format
      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/plain; version=0.0.4',
      });
      expect(mockResponse.end).toHaveBeenCalled();

      const body = getResponseBody(mockResponse);
      expect(body).toContain('cache_hits_total');
      expect(body).toContain('http_requests_total');
    });

    it('should_returnPrometheusFormat_when_successful', async () => {
      await handler.handle(mockRequest, mockResponse, 'valid-token');

      const body = getResponseBody(mockResponse);

      // Prometheus format has HELP and TYPE comments
      expect(body).toMatch(/# HELP/);
      expect(body).toMatch(/# TYPE/);
    });

    it('should_includeAllMetrics_when_requested', async () => {
      // Record various metrics
      metricsExporter.recordCacheHit('schema');
      metricsExporter.recordCacheMiss('schema');
      metricsExporter.recordHttpRequest('GET', 200);
      metricsExporter.recordHttpRequest('POST', 500);

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      const body = getResponseBody(mockResponse);

      // Verify all metric types present
      expect(body).toContain('cache_hits_total');
      expect(body).toContain('cache_misses_total');
      expect(body).toContain('http_requests_total');
    });
  });

  describe('Error Handling', () => {
    it('should_return500_when_metricsExporterThrows', async () => {
      // Setup: Mock metrics exporter failure
      vi.spyOn(metricsExporter, 'getMetrics').mockRejectedValue(
        new Error('Metrics export failed')
      );

      // Execute
      await handler.handle(mockRequest, mockResponse, 'valid-token');

      // Verify: 500 Internal Server Error with JSON error
      expect(mockResponse.writeHead).toHaveBeenCalledWith(500, {
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.error).toContain('Metrics request failed');
      expect(body.error).toContain('Metrics export failed');
    });

    it('should_handleUnexpectedErrors_gracefully', async () => {
      // Setup: Mock unexpected error type
      vi.spyOn(metricsExporter, 'getMetrics').mockRejectedValue('string error');

      // Execute
      await handler.handle(mockRequest, mockResponse, 'valid-token');

      // Verify: Still returns 500 with error message
      expect(mockResponse.writeHead).toHaveBeenCalledWith(500, {
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(getResponseBody(mockResponse));
      expect(body.error).toBeDefined();
    });
  });

  describe('Integration with MetricsExporter', () => {
    it('should_callGetMetrics_once', async () => {
      const spy = vi.spyOn(metricsExporter, 'getMetrics');

      await handler.handle(mockRequest, mockResponse, 'valid-token');

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should_returnEmptyMetrics_when_noMetricsRecorded', async () => {
      // Fresh exporter with no metrics
      const freshExporter = new MetricsExporter();
      const freshHandler = new MetricsRequestHandler(freshExporter);

      await freshHandler.handle(mockRequest, mockResponse, 'valid-token');

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/plain; version=0.0.4',
      });

      const body = getResponseBody(mockResponse);
      // Should still have metric definitions, just zero values
      expect(body).toBeTruthy();
    });
  });

  describe('Authentication', () => {
    it('should_receiveAuthToken_parameter', async () => {
      // Handler receives pre-validated token from MCPProxyServer
      // This test verifies the parameter is accepted
      await handler.handle(mockRequest, mockResponse, 'test-auth-token');

      // Verify handler executed successfully (auth already validated by proxy)
      expect(mockResponse.writeHead).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Mock ServerResponse that captures output
 */
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
