/**
 * Audit Logger Interface
 *
 * Provides immutable security/operations audit trail with daily rotation.
 * Uses JSONL format (one JSON object per line) for streaming parsers.
 *
 * Security considerations:
 * - No sensitive data in logs (API keys hashed with SHA-256)
 * - Concurrent writes protected by AsyncLock
 * - Daily rotation with 30-day retention
 *
 * @see https://jsonlines.org/
 */

export type AuditEventType =
  | 'auth_failure'
  | 'rate_limited'
  | 'circuit_open'
  | 'queue_full'
  | 'tool_call'
  | 'shutdown'
  | 'discovery';

export type AuditStatus = 'success' | 'failure' | 'rejected';

export interface AuditLogEntry {
  /** UTC timestamp (ISO 8601) */
  timestamp: string;
  /** Request correlation ID (for distributed tracing) */
  correlationId: string;
  /** Event type */
  eventType: AuditEventType;
  /** Hashed client identifier (SHA-256, never plaintext API key) */
  clientId?: string;
  /** Client IP address (for auth failures) */
  clientIp?: string;
  /** MCP tool called (if applicable) */
  toolName?: string;
  /** Hash of params (SHA-256, audit without sensitive data) */
  paramsHash?: string;
  /** Status */
  status: AuditStatus;
  /** Sanitized error message (no secrets, no stack traces) */
  errorMessage?: string;
  /** Request duration in milliseconds */
  latencyMs?: number;
  /** Extensible metadata */
  metadata?: Record<string, unknown>;
}

export interface IAuditLogger {
  /**
   * Appends audit log entry to current day's log file
   *
   * File naming: ~/.code-executor/audit-logs/audit-YYYY-MM-DD.log
   * Protected by AsyncLock to prevent interleaved writes
   *
   * @param entry - Audit log entry to append
   * @throws {Error} If file system write fails or AsyncLock acquisition fails
   */
  log(entry: AuditLogEntry): Promise<void>;

  /**
   * Flushes any buffered log entries to disk
   *
   * Use case: Graceful shutdown, ensure no logs lost
   * @throws {Error} If file system sync fails
   */
  flush(): Promise<void>;

  /**
   * Rotates log file (creates new file for current day)
   *
   * Called automatically at midnight UTC
   * @throws {Error} If file system operations fail (mkdir, rename, write)
   */
  rotate(): Promise<void>;

  /**
   * Deletes log files older than retention period
   *
   * Default retention: 30 days (configurable via AUDIT_LOG_RETENTION_DAYS)
   * @throws {Error} If file system delete operations fail
   */
  cleanup(): Promise<void>;
}
