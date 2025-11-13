/**
 * Unit tests for MCPProxyServer /metrics endpoint
 *
 * Tests Prometheus metrics endpoint authentication and format:
 * - 401 when no auth token provided
 * - 401 when invalid auth token provided
 * - 200 when valid auth token provided
 * - Prometheus text format validation
 * - Security: Information disclosure prevention
 *
 * FIX: Added missing test coverage for metrics endpoint authentication
 * (identified in Phase 6 code review)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MCPProxyServer } from '../src/mcp-proxy-server.js';
import type { MCPClientPool } from '../src/mcp-client-pool.js';
import { MetricsExporter } from '../src/metrics-exporter.js';
import * as http from 'http';

describe('MCPProxyServer - /metrics Endpoint Authentication', () => {
  let proxyServer: MCPProxyServer;
  let mockMCPClientPool: MCPClientPool;
  let metricsExporter: MetricsExporter;
  let port: number;
  let authToken: string;

  beforeEach(async () => {
    // Mock MCP Client Pool with all required methods
    mockMCPClientPool = {
      callTool: vi.fn().mockResolvedValue({ result: 'success' }),
      listAllTools: vi.fn().mockReturnValue([]), // Synchronous method
      listAllToolSchemas: vi.fn().mockResolvedValue([]),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as MCPClientPool;

    // Create metrics exporter
    metricsExporter = new MetricsExporter();

    // Create proxy server with metrics exporter
    proxyServer = new MCPProxyServer(
      mockMCPClientPool,
      ['mcp__test__tool'],
      metricsExporter,
      500 // discovery timeout
    );

    // Start server
    const result = await proxyServer.start();
    port = result.port;
    authToken = result.authToken;
  });

  afterEach(async () => {
    await proxyServer.stop();
  });

  describe('Authentication Requirements', () => {
    it('should_return401_when_noAuthTokenProvided', async () => {
      const response = await fetch(`http://127.0.0.1:${port}/metrics`);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toContain('Unauthorized');
      expect(body.hint).toContain('Authorization: Bearer');
    });

    it('should_return401_when_invalidAuthTokenProvided', async () => {
      const response = await fetch(`http://127.0.0.1:${port}/metrics`, {
        headers: {
          'Authorization': 'Bearer invalid-token-12345',
        },
      });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toContain('Unauthorized');
    });

    it('should_return401_when_malformedAuthHeader', async () => {
      const response = await fetch(`http://127.0.0.1:${port}/metrics`, {
        headers: {
          'Authorization': 'NotBearer ' + authToken,
        },
      });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toContain('Unauthorized');
    });

    it('should_return401_when_authHeaderMissingBearerPrefix', async () => {
      const response = await fetch(`http://127.0.0.1:${port}/metrics`, {
        headers: {
          'Authorization': authToken, // Missing "Bearer " prefix
        },
      });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toContain('Unauthorized');
    });
  });

  describe('Successful Metrics Retrieval', () => {
    it('should_return200_when_validAuthTokenProvided', async () => {
      const response = await fetch(`http://127.0.0.1:${port}/metrics`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/plain');
    });

    it('should_returnPrometheusTextFormat_when_authenticated', async () => {
      const response = await fetch(`http://127.0.0.1:${port}/metrics`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });
      const body = await response.text();

      // Verify Prometheus exposition format
      expect(body).toMatch(/# HELP/);
      expect(body).toMatch(/# TYPE/);

      // Verify expected metric names
      expect(body).toContain('cache_hits_total');
      expect(body).toContain('cache_misses_total');
      expect(body).toContain('http_requests_total');
      expect(body).toContain('http_request_duration_seconds');
    });

    it('should_includeMetricMetadata_when_authenticated', async () => {
      const response = await fetch(`http://127.0.0.1:${port}/metrics`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });
      const body = await response.text();

      // Verify HELP lines (human-readable descriptions)
      expect(body).toMatch(/# HELP cache_hits_total/);
      expect(body).toMatch(/# HELP http_requests_total/);

      // Verify TYPE lines (counter, gauge, histogram)
      expect(body).toMatch(/# TYPE cache_hits_total counter/);
      expect(body).toMatch(/# TYPE http_requests_total counter/);
      expect(body).toMatch(/# TYPE http_request_duration_seconds histogram/);
      expect(body).toMatch(/# TYPE pool_active_connections gauge/);
    });
  });

  describe('Metrics Content Validation', () => {
    it('should_includeAllRegisteredMetrics_when_authenticated', async () => {
      // Record some metrics
      metricsExporter.recordCacheHit('schema');
      metricsExporter.recordHttpRequest('POST', 200);
      metricsExporter.setCircuitBreakerState('test-server', 'closed');
      metricsExporter.setPoolActiveConnections(5);

      const response = await fetch(`http://127.0.0.1:${port}/metrics`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });
      const body = await response.text();

      // Verify all metric types present
      expect(body).toContain('cache_hits_total{cache_type="schema"} 1');
      expect(body).toContain('http_requests_total{method="POST",status="200"} 1');
      expect(body).toContain('circuit_breaker_state{server="test-server"} 0');
      expect(body).toContain('pool_active_connections 5');
    });

    it('should_includeHistogramBuckets_when_authenticated', async () => {
      // Record HTTP duration
      metricsExporter.recordHttpDuration('GET', '/test', 0.15);

      const response = await fetch(`http://127.0.0.1:${port}/metrics`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });
      const body = await response.text();

      // Verify histogram structure
      expect(body).toContain('http_request_duration_seconds_bucket');
      expect(body).toContain('http_request_duration_seconds_sum');
      expect(body).toContain('http_request_duration_seconds_count');

      // Verify bucket boundaries
      expect(body).toMatch(/le="0\.01"/);
      expect(body).toMatch(/le="0\.1"/);
      expect(body).toMatch(/le="1"/);
      expect(body).toMatch(/le="\+Inf"/);
    });
  });

  describe('Security: Information Disclosure Prevention', () => {
    it('should_notLeakAuthToken_in401Response', async () => {
      const response = await fetch(`http://127.0.0.1:${port}/metrics`);
      const body = await response.text();

      // Verify auth token not leaked in error response
      expect(body).not.toContain(authToken);
    });

    it('should_notLeakSensitiveMetrics_without_authentication', async () => {
      // Record potentially sensitive metrics
      metricsExporter.recordCacheHit('api-keys'); // Sensitive cache type
      metricsExporter.setCircuitBreakerState('internal-service', 'open');

      const response = await fetch(`http://127.0.0.1:${port}/metrics`);

      expect(response.status).toBe(401);

      const body = await response.text();
      // Verify metrics not leaked in unauthorized response
      expect(body).not.toContain('api-keys');
      expect(body).not.toContain('internal-service');
    });

    it('should_requireAuthentication_onEveryRequest', async () => {
      // First request with valid auth
      const response1 = await fetch(`http://127.0.0.1:${port}/metrics`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });
      expect(response1.status).toBe(200);

      // Second request without auth (no session persistence)
      const response2 = await fetch(`http://127.0.0.1:${port}/metrics`);
      expect(response2.status).toBe(401);
    });
  });

  describe('Content-Type Headers', () => {
    it('should_returnPrometheusContentType_when_authenticated', async () => {
      const response = await fetch(`http://127.0.0.1:${port}/metrics`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      const contentType = response.headers.get('content-type');
      expect(contentType).toBe('text/plain; version=0.0.4');
    });

    it('should_returnJSONContentType_on401Error', async () => {
      const response = await fetch(`http://127.0.0.1:${port}/metrics`);

      const contentType = response.headers.get('content-type');
      expect(contentType).toContain('application/json');
    });
  });

  describe('Edge Cases', () => {
    it('should_handleConcurrentMetricsRequests', async () => {
      // Make 5 concurrent requests
      const requests = Array(5).fill(null).map(() =>
        fetch(`http://127.0.0.1:${port}/metrics`, {
          headers: {
            'Authorization': `Bearer ${authToken}`,
          },
        })
      );

      const responses = await Promise.all(requests);

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });

    it('should_returnEmptyMetrics_whenNoDataRecorded', async () => {
      // Create new exporter with no recorded metrics
      const freshExporter = new MetricsExporter();
      const freshServer = new MCPProxyServer(
        mockMCPClientPool,
        ['mcp__test__tool'],
        freshExporter,
        500
      );

      const result = await freshServer.start();

      try {
        const response = await fetch(`http://127.0.0.1:${result.port}/metrics`, {
          headers: {
            'Authorization': `Bearer ${result.authToken}`,
          },
        });
        const body = await response.text();

        expect(response.status).toBe(200);
        // Should have HELP and TYPE lines but no values recorded
        expect(body).toMatch(/# HELP/);
        expect(body).toMatch(/# TYPE/);
      } finally {
        await freshServer.stop();
      }
    });
  });
});
