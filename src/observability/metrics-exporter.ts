/**
 * Prometheus Metrics Exporter
 *
 * Integrates prom-client for monitoring:
 * - Cache metrics (hits/misses with cache_type label)
 * - HTTP metrics (requests counter, duration histogram)
 * - Circuit breaker metrics (state gauge: 0=closed, 1=open, 0.5=half-open)
 * - Connection pool metrics (active connections, queue depth, queue wait time)
 *
 * WHY: Histogram buckets (0.01-5s) optimized for web service latency patterns.
 * Most web requests complete under 1s, but we track up to 5s for timeout detection.
 */

import * as promClient from 'prom-client';
import type { IMetricsExporter, MetricDefinition } from './interfaces/metrics-exporter.js';

/**
 * Circuit breaker state values for Prometheus gauge
 */
const CIRCUIT_STATE_VALUES = {
  closed: 0,
  open: 1,
  'half-open': 0.5,
} as const;

export type CircuitState = keyof typeof CIRCUIT_STATE_VALUES;

/**
 * MetricsExporter class
 *
 * Implements IMetricsExporter interface with both generic methods (for extensibility)
 * and domain-specific convenience methods (for ergonomics).
 *
 * DESIGN DECISION: Provides high-level API (recordCacheHit, recordHttpRequest) as
 * syntactic sugar over low-level API (incrementCounter, setGauge). This follows
 * the Facade pattern - simpler interface for common use cases while maintaining
 * flexibility through the generic interface methods.
 */
export class MetricsExporter implements IMetricsExporter {
  private registry: promClient.Registry;

  // Cache metrics
  private cacheHitsCounter: promClient.Counter<'cache_type'>;
  private cacheMissesCounter: promClient.Counter<'cache_type'>;

  // HTTP metrics
  private httpRequestsCounter: promClient.Counter<'method' | 'status'>;
  private httpDurationHistogram: promClient.Histogram<'method' | 'endpoint'>;

  // Circuit breaker metrics
  private circuitBreakerStateGauge: promClient.Gauge<'server'>;

  // Connection pool metrics
  private poolActiveConnectionsGauge: promClient.Gauge;
  private poolQueueDepthGauge: promClient.Gauge;
  private poolQueueWaitHistogram: promClient.Histogram;

  constructor() {
    // Create new registry (isolated from global registry for testing)
    this.registry = new promClient.Registry();

    // Cache metrics
    this.cacheHitsCounter = new promClient.Counter({
      name: 'cache_hits_total',
      help: 'Total number of cache hits',
      labelNames: ['cache_type'] as const,
      registers: [this.registry],
    });

    this.cacheMissesCounter = new promClient.Counter({
      name: 'cache_misses_total',
      help: 'Total number of cache misses',
      labelNames: ['cache_type'] as const,
      registers: [this.registry],
    });

    // HTTP metrics
    this.httpRequestsCounter = new promClient.Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'status'] as const,
      registers: [this.registry],
    });

    /**
     * WHY: Histogram buckets optimized for web service latency patterns.
     *
     * Bucket rationale:
     * - 0.01s (10ms): Fast cached responses
     * - 0.05s (50ms): Typical API response time
     * - 0.1s (100ms): Target P95 for discovery calls
     * - 0.25s (250ms): Warning threshold
     * - 0.5s (500ms): Discovery timeout threshold
     * - 1s: User-perceivable delay
     * - 2.5s: High latency warning
     * - 5s: Near-timeout (sandbox default 30s, queue 30s)
     *
     * These buckets allow precise measurement of P50, P95, P99 latencies
     * for different operation types (cache hits, MCP calls, queue waits).
     */
    this.httpDurationHistogram = new promClient.Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'endpoint'] as const,
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });

    // Circuit breaker metrics
    this.circuitBreakerStateGauge = new promClient.Gauge({
      name: 'circuit_breaker_state',
      help: 'Circuit breaker state (0=closed, 1=open, 0.5=half-open)',
      labelNames: ['server'] as const,
      registers: [this.registry],
    });

    // Connection pool metrics
    this.poolActiveConnectionsGauge = new promClient.Gauge({
      name: 'pool_active_connections',
      help: 'Number of active connections in the pool',
      registers: [this.registry],
    });

    this.poolQueueDepthGauge = new promClient.Gauge({
      name: 'pool_queue_depth',
      help: 'Number of requests waiting in the connection queue',
      registers: [this.registry],
    });

    /**
     * FIX: Different bucket strategy than HTTP duration histogram
     *
     * WHY: Queue wait times have DIFFERENT distribution than HTTP requests:
     * - HTTP requests: Typically <100ms (cached), <500ms (discovery)
     * - Queue waits: Can be MUCH longer (up to 30s timeout per spec.md NFR-2)
     *
     * Bucket rationale (optimized for queue backpressure detection):
     * - 0.1s-0.5s: Fast queue processing (healthy state)
     * - 1s-5s: Queue building up (warning zone)
     * - 10s-15s: Queue backpressure (critical zone)
     * - 30s: Timeout boundary (failure state)
     *
     * This distribution allows detecting queue backpressure patterns that
     * would be invisible with HTTP-optimized buckets (most waits → +Inf bucket).
     */
    this.poolQueueWaitHistogram = new promClient.Histogram({
      name: 'pool_queue_wait_seconds',
      help: 'Time spent waiting in connection queue in seconds',
      buckets: [0.1, 0.5, 1, 2.5, 5, 10, 15, 30],
      registers: [this.registry],
    });
  }

  /**
   * Record cache hit
   * @param cacheType - Type of cache (e.g., 'schema', 'redis')
   */
  recordCacheHit(cacheType: string): void {
    this.cacheHitsCounter.labels(cacheType).inc();
  }

  /**
   * Record cache miss
   * @param cacheType - Type of cache (e.g., 'schema', 'redis')
   */
  recordCacheMiss(cacheType: string): void {
    this.cacheMissesCounter.labels(cacheType).inc();
  }

  /**
   * Record HTTP request
   * @param method - HTTP method (GET, POST, etc.)
   * @param status - HTTP status code
   */
  recordHttpRequest(method: string, status: number): void {
    this.httpRequestsCounter.labels(method, status.toString()).inc();
  }

  /**
   * Record HTTP request duration
   * @param method - HTTP method
   * @param endpoint - Request endpoint
   * @param durationSeconds - Duration in seconds
   */
  recordHttpDuration(method: string, endpoint: string, durationSeconds: number): void {
    this.httpDurationHistogram.labels(method, endpoint).observe(durationSeconds);
  }

  /**
   * Set circuit breaker state
   * @param server - MCP server name
   * @param state - Circuit state ('closed', 'open', 'half-open')
   */
  setCircuitBreakerState(server: string, state: CircuitState): void {
    const value = CIRCUIT_STATE_VALUES[state];
    this.circuitBreakerStateGauge.labels(server).set(value);
  }

  /**
   * Set active connections count
   * @param count - Number of active connections
   */
  setPoolActiveConnections(count: number): void {
    this.poolActiveConnectionsGauge.set(count);
  }

  /**
   * Set queue depth
   * @param depth - Number of requests in queue
   */
  setPoolQueueDepth(depth: number): void {
    this.poolQueueDepthGauge.set(depth);
  }

  /**
   * Record queue wait time
   * @param durationSeconds - Wait duration in seconds
   */
  recordPoolQueueWait(durationSeconds: number): void {
    this.poolQueueWaitHistogram.observe(durationSeconds);
  }

  /**
   * Get all metrics in Prometheus text format
   * @returns Prometheus exposition format string
   */
  async getMetrics(): Promise<string> {
    return await this.registry.metrics();
  }

  /**
   * Reset all metrics (for testing)
   */
  reset(): void {
    this.registry.resetMetrics();
  }

  // ========================================================================
  // IMetricsExporter Interface Implementation (Generic Low-Level API)
  // ========================================================================

  /**
   * Register a new metric dynamically
   *
   * NOTE: Primarily for testing/extensibility. Production code should use
   * the pre-registered domain-specific methods (recordCacheHit, etc.)
   *
   * @param definition - Metric definition
   */
  registerMetric(definition: MetricDefinition): void {
    const { name, type, help, labelNames = [], buckets } = definition;

    switch (type) {
      case 'counter':
        new promClient.Counter({
          name,
          help,
          labelNames,
          registers: [this.registry],
        });
        break;

      case 'gauge':
        new promClient.Gauge({
          name,
          help,
          labelNames,
          registers: [this.registry],
        });
        break;

      case 'histogram':
        new promClient.Histogram({
          name,
          help,
          labelNames,
          buckets: buckets || [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
          registers: [this.registry],
        });
        break;

      default:
        throw new Error(`Unknown metric type: ${type}`);
    }
  }

  /**
   * Increment a counter metric
   *
   * @param name - Metric name
   * @param labels - Label values
   * @param value - Amount to increment (default: 1)
   */
  incrementCounter(name: string, labels?: Record<string, string>, value: number = 1): void {
    const metric = this.registry.getSingleMetric(name) as promClient.Counter<string> | undefined;
    if (!metric) {
      throw new Error(`Counter metric '${name}' not found. Call registerMetric() first.`);
    }

    if (labels) {
      metric.labels(labels).inc(value);
    } else {
      metric.inc(value);
    }
  }

  /**
   * Set a gauge metric to a specific value
   *
   * @param name - Metric name
   * @param value - Current value
   * @param labels - Label values
   */
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const metric = this.registry.getSingleMetric(name) as promClient.Gauge<string> | undefined;
    if (!metric) {
      throw new Error(`Gauge metric '${name}' not found. Call registerMetric() first.`);
    }

    if (labels) {
      metric.labels(labels).set(value);
    } else {
      metric.set(value);
    }
  }

  /**
   * Record a histogram observation
   *
   * @param name - Metric name
   * @param value - Observed value (e.g., latency in seconds)
   * @param labels - Label values
   */
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const metric = this.registry.getSingleMetric(name) as promClient.Histogram<string> | undefined;
    if (!metric) {
      throw new Error(`Histogram metric '${name}' not found. Call registerMetric() first.`);
    }

    if (labels) {
      metric.labels(labels).observe(value);
    } else {
      metric.observe(value);
    }
  }

  /**
   * Export all metrics in Prometheus text format (async version)
   *
   * Alias for getMetrics() to satisfy interface contract
   *
   * NOTE: The interface defines this as returning string, but prom-client's
   * metrics() is async. This is a known limitation of the interface design.
   * We provide async implementation to match prom-client's actual API.
   *
   * @returns Prometheus exposition format (text/plain)
   */
  async exportMetrics(): Promise<string> {
    return await this.registry.metrics();
  }
}
