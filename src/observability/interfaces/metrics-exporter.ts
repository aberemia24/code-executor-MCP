/**
 * Metrics Exporter Interface
 *
 * Exports Prometheus-compatible metrics for monitoring and alerting.
 * Metrics are ephemeral (reset on server restart).
 *
 * Metric types:
 * - Counter: Monotonically increasing (e.g., total requests)
 * - Gauge: Current value (e.g., active connections)
 * - Histogram: Distribution of values (e.g., latency buckets)
 *
 * @see https://prometheus.io/docs/concepts/metric_types/
 */

export type MetricType = 'counter' | 'gauge' | 'histogram';

export interface MetricDefinition {
  /** Metric name (e.g., http_requests_total) */
  name: string;
  /** Metric type */
  type: MetricType;
  /** Human-readable description */
  help: string;
  /** Label names (e.g., ['status', 'method']) */
  labelNames?: string[];
  /** Histogram buckets (only for histogram type) */
  buckets?: number[];
}

export interface IMetricsExporter {
  /**
   * Registers a new metric
   *
   * Must be called before recording any values
   *
   * @param definition - Metric definition
   * @throws {Error} If metric with same name already registered or definition is invalid
   */
  registerMetric(definition: MetricDefinition): void;

  /**
   * Increments a counter metric
   *
   * @param name - Metric name
   * @param labels - Label values (e.g., {status: '200', method: 'POST'})
   * @param value - Amount to increment (default: 1)
   */
  incrementCounter(name: string, labels?: Record<string, string>, value?: number): void;

  /**
   * Sets a gauge metric to a specific value
   *
   * @param name - Metric name
   * @param value - Current value
   * @param labels - Label values
   */
  setGauge(name: string, value: number, labels?: Record<string, string>): void;

  /**
   * Records a histogram observation
   *
   * @param name - Metric name
   * @param value - Observed value (e.g., latency in seconds)
   * @param labels - Label values
   */
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void;

  /**
   * Exports all metrics in Prometheus text format
   *
   * FIX: Update to async to match prom-client API
   *
   * @returns Prometheus exposition format (text/plain)
   */
  exportMetrics(): Promise<string>;

  /**
   * Resets all metrics to initial state
   *
   * Use case: Testing, manual reset
   */
  reset(): void;
}
