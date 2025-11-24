/**
 * Unit tests for MetricsExporter
 *
 * Tests Prometheus metrics integration for monitoring:
 * - Cache metrics (hits/misses)
 * - HTTP metrics (requests, duration histogram)
 * - Circuit breaker metrics (state gauge)
 * - Connection pool metrics (active connections, queue depth)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MetricsExporter } from '../src/observability/metrics-exporter.js';

describe('MetricsExporter', () => {
  let metricsExporter: MetricsExporter;

  beforeEach(() => {
    metricsExporter = new MetricsExporter();
  });

  afterEach(() => {
    // Clear all metrics between tests
    metricsExporter.reset();
  });

  describe('T079: Prometheus metrics registration', () => {
    it('should register cache hit counter', async () => {
      metricsExporter.recordCacheHit('schema');
      const metrics = await metricsExporter.getMetrics();
      expect(metrics).toContain('cache_hits_total{cache_type="schema"}');
    });

    it('should register cache miss counter', async () => {
      metricsExporter.recordCacheMiss('schema');
      const metrics = await metricsExporter.getMetrics();
      expect(metrics).toContain('cache_misses_total{cache_type="schema"}');
    });

    it('should register HTTP request counter with status and method labels', async () => {
      metricsExporter.recordHttpRequest('POST', 200);
      const metrics = await metricsExporter.getMetrics();
      expect(metrics).toContain('http_requests_total{method="POST",status="200"}');
    });

    it('should register HTTP request duration histogram', async () => {
      metricsExporter.recordHttpDuration('POST', '/mcp/tools', 0.15);
      const metrics = await metricsExporter.getMetrics();
      expect(metrics).toContain('http_request_duration_seconds');
    });

    it('should register circuit breaker state gauge', async () => {
      metricsExporter.setCircuitBreakerState('filesystem', 'closed');
      const metrics = await metricsExporter.getMetrics();
      expect(metrics).toContain('circuit_breaker_state{server="filesystem"}');
    });

    it('should register pool active connections gauge', async () => {
      metricsExporter.setPoolActiveConnections(5);
      const metrics = await metricsExporter.getMetrics();
      expect(metrics).toContain('pool_active_connections');
    });

    it('should register pool queue depth gauge', async () => {
      metricsExporter.setPoolQueueDepth(10);
      const metrics = await metricsExporter.getMetrics();
      expect(metrics).toContain('pool_queue_depth');
    });

    it('should register pool queue wait histogram', async () => {
      metricsExporter.recordPoolQueueWait(0.25);
      const metrics = await metricsExporter.getMetrics();
      expect(metrics).toContain('pool_queue_wait_seconds');
    });
  });

  describe('T080: HTTP histogram buckets (web service optimized)', () => {
    it('should use buckets: 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5 seconds', async () => {
      const expectedBuckets = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

      // Record durations at each bucket boundary
      expectedBuckets.forEach(duration => {
        metricsExporter.recordHttpDuration('GET', '/health', duration);
      });

      const metrics = await metricsExporter.getMetrics();

      // Verify all bucket boundaries appear in output
      expectedBuckets.forEach(bucket => {
        expect(metrics).toMatch(new RegExp(`le="${bucket}"`));
      });
    });

    it('should include +Inf bucket for histogram', async () => {
      metricsExporter.recordHttpDuration('GET', '/health', 10.5); // Above max bucket
      const metrics = await metricsExporter.getMetrics();
      expect(metrics).toContain('le="+Inf"');
    });
  });

  describe('T081: Metrics text format output (Prometheus exposition format)', () => {
    it('should return Prometheus text format with HELP and TYPE', async () => {
      metricsExporter.recordCacheHit('schema');
      const metrics = await metricsExporter.getMetrics();

      // Verify HELP line
      expect(metrics).toMatch(/# HELP cache_hits_total/);

      // Verify TYPE line
      expect(metrics).toMatch(/# TYPE cache_hits_total counter/);

      // Verify metric line with value
      expect(metrics).toMatch(/cache_hits_total\{cache_type="schema"\} 1/);
    });

    it('should format histogram with _bucket, _sum, _count suffixes', async () => {
      metricsExporter.recordHttpDuration('GET', '/health', 0.1);
      const metrics = await metricsExporter.getMetrics();

      // Histogram should have bucket suffixes
      expect(metrics).toContain('http_request_duration_seconds_bucket');

      // Histogram should have sum
      expect(metrics).toContain('http_request_duration_seconds_sum');

      // Histogram should have count
      expect(metrics).toContain('http_request_duration_seconds_count');
    });

    it('should format gauge with current value', async () => {
      metricsExporter.setPoolActiveConnections(7);
      const metrics = await metricsExporter.getMetrics();

      expect(metrics).toMatch(/pool_active_connections 7/);
    });

    it('should format counter with cumulative value', async () => {
      metricsExporter.recordCacheHit('schema');
      metricsExporter.recordCacheHit('schema');
      metricsExporter.recordCacheHit('schema');
      const metrics = await metricsExporter.getMetrics();

      expect(metrics).toMatch(/cache_hits_total\{cache_type="schema"\} 3/);
    });
  });

  describe('Cache metrics', () => {
    it('should track cache hits with cache_type label', async () => {
      metricsExporter.recordCacheHit('schema');
      metricsExporter.recordCacheHit('schema');
      const metrics = await metricsExporter.getMetrics();
      expect(metrics).toMatch(/cache_hits_total\{cache_type="schema"\} 2/);
    });

    it('should track cache misses with cache_type label', async () => {
      metricsExporter.recordCacheMiss('schema');
      const metrics = await metricsExporter.getMetrics();
      expect(metrics).toMatch(/cache_misses_total\{cache_type="schema"\} 1/);
    });

    it('should support multiple cache types', async () => {
      metricsExporter.recordCacheHit('schema');
      metricsExporter.recordCacheHit('redis');
      const metrics = await metricsExporter.getMetrics();

      expect(metrics).toContain('cache_type="schema"');
      expect(metrics).toContain('cache_type="redis"');
    });
  });

  describe('HTTP metrics', () => {
    it('should track requests with method and status labels', async () => {
      metricsExporter.recordHttpRequest('POST', 200);
      metricsExporter.recordHttpRequest('POST', 200);
      metricsExporter.recordHttpRequest('GET', 404);
      const metrics = await metricsExporter.getMetrics();

      expect(metrics).toMatch(/http_requests_total\{method="POST",status="200"\} 2/);
      expect(metrics).toMatch(/http_requests_total\{method="GET",status="404"\} 1/);
    });

    it('should track request duration with method and endpoint labels', async () => {
      metricsExporter.recordHttpDuration('GET', '/health', 0.05);
      metricsExporter.recordHttpDuration('POST', '/mcp/tools', 0.15);
      const metrics = await metricsExporter.getMetrics();

      expect(metrics).toContain('method="GET"');
      expect(metrics).toContain('endpoint="/health"');
      expect(metrics).toContain('method="POST"');
      expect(metrics).toContain('endpoint="/mcp/tools"');
    });
  });

  describe('Circuit breaker metrics', () => {
    it('should set circuit breaker state as gauge (0=closed, 1=open, 0.5=half-open)', async () => {
      metricsExporter.setCircuitBreakerState('filesystem', 'closed');
      let metrics = await metricsExporter.getMetrics();
      expect(metrics).toMatch(/circuit_breaker_state\{server="filesystem"\} 0/);

      metricsExporter.setCircuitBreakerState('filesystem', 'open');
      metrics = await metricsExporter.getMetrics();
      expect(metrics).toMatch(/circuit_breaker_state\{server="filesystem"\} 1/);

      metricsExporter.setCircuitBreakerState('filesystem', 'half-open');
      metrics = await metricsExporter.getMetrics();
      expect(metrics).toMatch(/circuit_breaker_state\{server="filesystem"\} 0\.5/);
    });

    it('should track multiple circuit breakers with server label', async () => {
      metricsExporter.setCircuitBreakerState('filesystem', 'closed');
      metricsExporter.setCircuitBreakerState('zen', 'open');
      const metrics = await metricsExporter.getMetrics();

      expect(metrics).toContain('server="filesystem"');
      expect(metrics).toContain('server="zen"');
    });
  });

  describe('Connection pool metrics', () => {
    it('should track active connections as gauge', async () => {
      metricsExporter.setPoolActiveConnections(3);
      let metrics = await metricsExporter.getMetrics();
      expect(metrics).toMatch(/pool_active_connections 3/);

      metricsExporter.setPoolActiveConnections(5);
      metrics = await metricsExporter.getMetrics();
      expect(metrics).toMatch(/pool_active_connections 5/);
    });

    it('should track queue depth as gauge', async () => {
      metricsExporter.setPoolQueueDepth(15);
      const metrics = await metricsExporter.getMetrics();
      expect(metrics).toMatch(/pool_queue_depth 15/);
    });

    it('should track queue wait time as histogram', async () => {
      metricsExporter.recordPoolQueueWait(0.25);
      metricsExporter.recordPoolQueueWait(0.8);
      const metrics = await metricsExporter.getMetrics();

      expect(metrics).toContain('pool_queue_wait_seconds');
      expect(metrics).toMatch(/pool_queue_wait_seconds_count 2/);
    });
  });

  describe('Metrics endpoint integration', () => {
    it('should return all metrics in single response', async () => {
      // Record various metrics
      metricsExporter.recordCacheHit('schema');
      metricsExporter.recordHttpRequest('GET', 200);
      metricsExporter.setCircuitBreakerState('filesystem', 'closed');
      metricsExporter.setPoolActiveConnections(5);

      const metrics = await metricsExporter.getMetrics();

      // All metrics should be present in single output
      expect(metrics).toContain('cache_hits_total');
      expect(metrics).toContain('http_requests_total');
      expect(metrics).toContain('circuit_breaker_state');
      expect(metrics).toContain('pool_active_connections');
    });

    it('should be compatible with Prometheus scraper', async () => {
      metricsExporter.recordHttpRequest('POST', 200);
      const metrics = await metricsExporter.getMetrics();

      // Verify Prometheus text format compliance
      const lines = metrics.split('\n');
      const hasHelp = lines.some(line => line.startsWith('# HELP'));
      const hasType = lines.some(line => line.startsWith('# TYPE'));
      const hasMetric = lines.some(line => !line.startsWith('#') && line.trim().length > 0);

      expect(hasHelp).toBe(true);
      expect(hasType).toBe(true);
      expect(hasMetric).toBe(true);
    });
  });

  describe('Reset functionality', () => {
    it('should clear all metrics when reset', async () => {
      metricsExporter.recordCacheHit('schema');
      metricsExporter.recordHttpRequest('GET', 200);
      metricsExporter.setCircuitBreakerState('filesystem', 'open');

      // Verify metrics are set
      let metrics = await metricsExporter.getMetrics();
      expect(metrics).toContain('cache_hits_total{cache_type="schema"} 1');
      expect(metrics).toContain('http_requests_total{method="GET",status="200"} 1');
      expect(metrics).toContain('circuit_breaker_state{server="filesystem"} 1');

      metricsExporter.reset();

      // After reset, only HELP and TYPE lines remain (labeled metrics don't appear until set)
      metrics = await metricsExporter.getMetrics();
      expect(metrics).toContain('# HELP cache_hits_total');
      expect(metrics).toContain('# TYPE cache_hits_total counter');

      // Labeled metrics don't appear until they're set again after reset
      expect(metrics).not.toContain('cache_hits_total{cache_type="schema"}');
      expect(metrics).not.toContain('http_requests_total{method="GET",status="200"}');
      expect(metrics).not.toContain('circuit_breaker_state{server="filesystem"}');
    });
  });
});
