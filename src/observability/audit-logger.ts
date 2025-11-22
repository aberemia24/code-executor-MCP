/**
 * Audit Logger with Daily Rotation and Retention Policy
 *
 * US7 (FR-7): Audit Log Rotation Policy
 *
 * Features:
 * - Daily log rotation (new file per day)
 * - 30-day retention (configurable)
 * - JSONL format (one JSON object per line)
 * - AsyncLock protection for concurrent writes
 * - Automatic cleanup of old logs
 *
 * Constitutional Principle 6 (Concurrency):
 * - AsyncLock prevents race conditions on file writes
 * - Thread-safe append operations
 *
 * @see https://jsonlines.org/
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import AsyncLock from 'async-lock';
import { z } from 'zod';
import { normalizeError } from './utils.js';
import type { IAuditLogger, AuditLogEntry } from './interfaces/audit-logger.js';

/**
 * Audit Logger Configuration
 */
export interface AuditLoggerOptions {
  /** Directory for audit logs (default: ~/.code-executor/audit-logs) */
  logDir?: string;
  /** Retention period in days (default: 30) */
  retentionDays?: number;
}

/**
 * Environment Variable Validation Schema
 *
 * Constitutional Principle 4: Type Safety + Runtime Safety
 * All external inputs (including env vars) must be validated.
 *
 * WHY: Prevents:
 * - Path injection via HOME manipulation
 * - Invalid retention values (negative, zero, non-numeric)
 * - Silent failures with default values
 */
const AuditLoggerEnvSchema = z.object({
  HOME: z.string().optional(),
  USERPROFILE: z.string().optional(),
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
});

/**
 * Audit Logger Implementation
 *
 * Provides immutable audit trail with:
 * - Daily rotation (audit-YYYY-MM-DD.log)
 * - 30-day retention policy
 * - JSONL format for streaming parsers
 * - AsyncLock protection for concurrent writes
 *
 * USAGE:
 * ```typescript
 * const logger = new AuditLogger();
 * await logger.log({
 *   timestamp: new Date().toISOString(),
 *   correlationId: 'abc-123',
 *   eventType: 'tool_call',
 *   status: 'success'
 * });
 * ```
 */
export class AuditLogger implements IAuditLogger {
  private logDir: string;
  private retentionDays: number;
  private lock: AsyncLock;

  /**
   * Current log file path (cached for performance)
   * Invalidated on rotation
   */
  private currentLogFile: string | null = null;

  constructor(options: AuditLoggerOptions = {}) {
    // Validate environment variables with Zod (Constitutional Principle 4)
    const env = AuditLoggerEnvSchema.parse(process.env);

    // Default to ~/.code-executor/audit-logs
    // FIX: Use validated env vars (prevents path injection)
    const homeDir = env.HOME || env.USERPROFILE || '/tmp';
    this.logDir = options.logDir || path.join(homeDir, '.code-executor', 'audit-logs');

    // Default retention: 30 days
    // WHY: Compliance requirements typically mandate 30-90 days
    // FIX: Use validated retention days (prevents invalid values)
    this.retentionDays = options.retentionDays ?? env.AUDIT_LOG_RETENTION_DAYS;

    // T076: AsyncLock for concurrent write protection
    // WHY: Prevents interleaved JSON lines (data corruption)
    this.lock = new AsyncLock();
  }

  /**
   * T074: Get log filename for current day
   *
   * Format: audit-YYYY-MM-DD.log (ISO 8601 date format)
   * WHY: Lexicographically sortable, unambiguous timezone (UTC)
   *
   * @returns Log filename for today
   */
  private getLogFilename(): string {
    // Use UTC for consistency across timezones
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return `audit-${today}.log`;
  }

  /**
   * Get full path to current log file
   *
   * @returns Absolute path to today's log file
   */
  private getLogPath(): string {
    if (!this.currentLogFile) {
      this.currentLogFile = path.join(this.logDir, this.getLogFilename());
    }
    return this.currentLogFile;
  }

  /**
   * Ensure log directory exists
   *
   * Creates directory recursively if missing
   * @throws {Error} If directory creation fails
   */
  private async ensureLogDir(): Promise<void> {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
    } catch (error) {
      // TYPE-001 fix: Use normalizeError for consistency
      const err = normalizeError(error);
      throw new Error(`Failed to create audit log directory ${this.logDir}: ${err.message}`);
    }
  }

  /**
   * T073-T077: Append audit log entry to current day's log file
   *
   * Protected by AsyncLock to prevent race conditions
   * JSONL format: one JSON object per line
   *
   * @param entry - Audit log entry to append
   * @throws {Error} If file write fails or AsyncLock acquisition fails
   */
  async log(entry: AuditLogEntry): Promise<void> {
    // T076: Acquire lock for concurrent write protection
    await this.lock.acquire('log-write', async () => {
      // Ensure log directory exists
      await this.ensureLogDir();

      // Get current log file path
      const logPath = this.getLogPath();

      // T077: JSONL format - one JSON object per line
      // WHY: Streaming parsers can read line-by-line
      // No array wrapper, no trailing commas
      const jsonLine = JSON.stringify(entry) + '\n';

      // Append to log file (atomic write)
      // T076: AsyncLock ensures no interleaved writes
      try {
        await fs.appendFile(logPath, jsonLine, 'utf-8');
      } catch (error) {
        // TYPE-001 fix: Use normalizeError for consistency
        const err = normalizeError(error);
        throw new Error(`Failed to write audit log entry: ${err.message}`);
      }
    });
  }

  /**
   * Flush any buffered log entries to disk
   *
   * Use case: Graceful shutdown, ensure no logs lost
   * Currently a no-op since we use appendFile (no buffering)
   *
   * @throws {Error} If file system sync fails
   */
  async flush(): Promise<void> {
    // Node.js fs.appendFile() is already synchronous to disk
    // No additional flushing needed
    // WHY: appendFile uses O_APPEND flag which is atomic
    // FUTURE: If we add buffering for performance, implement flush here
    return Promise.resolve();
  }

  /**
   * T074: Rotate log file (creates new file for current day)
   *
   * Called automatically at midnight UTC
   * Invalidates cached log file path
   *
   * FIX: Wrap in AsyncLock to prevent race condition with concurrent log() calls
   * Constitutional Principle 6: Concurrency Safety
   *
   * Race condition scenario (without lock):
   * - Thread 1: log() acquires lock, starts writing to old file
   * - Thread 2: rotate() invalidates cache (no lock)
   * - Thread 1: continues writing to old file (wrong day!)
   *
   * @throws {Error} If file system operations fail
   */
  async rotate(): Promise<void> {
    await this.lock.acquire('log-write', async () => {
      // Invalidate cached log file path (protected by lock)
      // Next log() call will get new filename
      this.currentLogFile = null;

      // Ensure directory exists for new log file
      await this.ensureLogDir();

      // Note: No need to create new file explicitly
      // log() will create it on first write
    });
  }

  /**
   * T075: Delete log files older than retention period
   *
   * Default retention: 30 days (configurable via AUDIT_LOG_RETENTION_DAYS)
   * Runs automatically as background task
   *
   * @throws {Error} If file system delete operations fail
   */
  async cleanup(): Promise<void> {
    try {
      // Ensure directory exists
      await this.ensureLogDir();

      // List all log files
      const files = await fs.readdir(this.logDir);

      // Filter audit log files (audit-YYYY-MM-DD.log)
      const auditLogPattern = /^audit-(\d{4})-(\d{2})-(\d{2})\.log$/;
      const auditLogs = files.filter(f => auditLogPattern.test(f));

      // Calculate cutoff date (retentionDays ago)
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
      cutoffDate.setHours(0, 0, 0, 0); // Midnight

      // Delete logs older than cutoff
      for (const filename of auditLogs) {
        const match = filename.match(auditLogPattern);
        if (!match) continue;

        // Parse date from filename
        const [, year, month, day] = match;
        const logDate = new Date(`${year}-${month}-${day}`);

        // Delete if older than retention period
        if (logDate < cutoffDate) {
          const logPath = path.join(this.logDir, filename);
          try {
            await fs.unlink(logPath);
          } catch (error) {
            // Log error but continue cleanup (partial success)
            console.error(`Failed to delete old audit log ${filename}:`, error);
          }
        }
      }
    } catch (error) {
      // TYPE-001 fix: Use normalizeError for consistency
      const err = normalizeError(error);
      throw new Error(`Failed to cleanup old audit logs: ${err.message}`);
    }
  }
}
