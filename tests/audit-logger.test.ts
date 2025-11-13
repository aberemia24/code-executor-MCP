/**
 * Tests for Audit Logger
 *
 * US7 (FR-7): Audit Log Rotation Policy
 * Validates daily rotation, 30-day retention, and AsyncLock protection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { AuditLogger } from '../src/audit-logger.js';
import type { AuditLogEntry } from '../src/interfaces/audit-logger.js';

// Test directory for audit logs (will be cleaned up after tests)
const TEST_LOG_DIR = path.join(process.cwd(), '.test-audit-logs');

describe('AuditLogger (US7: FR-7)', () => {
  let auditLogger: AuditLogger;

  beforeEach(async () => {
    // Clean up test directory before each test
    try {
      await fs.rm(TEST_LOG_DIR, { recursive: true, force: true });
    } catch (error) {
      // Directory might not exist, that's ok
    }

    // Create fresh audit logger instance with test directory
    auditLogger = new AuditLogger({
      logDir: TEST_LOG_DIR,
      retentionDays: 30
    });
  });

  afterEach(async () => {
    // Clean up after each test
    try {
      await fs.rm(TEST_LOG_DIR, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  /**
   * T070: Daily Rotation Test
   *
   * ACCEPTANCE CRITERIA:
   * - Creates new log file at midnight UTC
   * - Log file naming: audit-YYYY-MM-DD.log
   * - Previous day's logs preserved
   * - Rotation happens automatically
   */
  describe('Daily Rotation (T070)', () => {
    it('should_createLogFileWithDateFormat_when_logWritten', async () => {
      const entry: AuditLogEntry = {
        timestamp: new Date().toISOString(),
        correlationId: 'test-123',
        eventType: 'tool_call',
        status: 'success'
      };

      await auditLogger.log(entry);

      // Verify log file created with date format
      const files = await fs.readdir(TEST_LOG_DIR);
      const datePattern = /^audit-\d{4}-\d{2}-\d{2}\.log$/;
      const logFiles = files.filter(f => datePattern.test(f));

      expect(logFiles.length).toBeGreaterThan(0);
      expect(logFiles[0]).toMatch(datePattern);
    });

    it('should_useCurrentDate_when_filenameGenerated', async () => {
      const entry: AuditLogEntry = {
        timestamp: new Date().toISOString(),
        correlationId: 'test-123',
        eventType: 'discovery',
        status: 'success'
      };

      await auditLogger.log(entry);

      // Get today's date in YYYY-MM-DD format
      const today = new Date().toISOString().split('T')[0];
      const expectedFilename = `audit-${today}.log`;

      const files = await fs.readdir(TEST_LOG_DIR);
      expect(files).toContain(expectedFilename);
    });

    it('should_createNewFile_when_rotationCalled', async () => {
      // Write to current log
      await auditLogger.log({
        timestamp: new Date().toISOString(),
        correlationId: 'before-rotation',
        eventType: 'tool_call',
        status: 'success'
      });

      // Force rotation
      await auditLogger.rotate();

      // Write to new log
      await auditLogger.log({
        timestamp: new Date().toISOString(),
        correlationId: 'after-rotation',
        eventType: 'tool_call',
        status: 'success'
      });

      // Verify both entries exist
      const files = await fs.readdir(TEST_LOG_DIR);
      expect(files.length).toBeGreaterThan(0);

      // Read log file content
      const today = new Date().toISOString().split('T')[0];
      const logPath = path.join(TEST_LOG_DIR, `audit-${today}.log`);
      const content = await fs.readFile(logPath, 'utf-8');

      // Both entries should be in the log
      expect(content).toContain('before-rotation');
      expect(content).toContain('after-rotation');
    });
  });

  /**
   * T071: 30-Day Retention Test
   *
   * ACCEPTANCE CRITERIA:
   * - Auto-delete logs older than AUDIT_LOG_RETENTION_DAYS (default: 30)
   * - Configurable via environment variable
   * - Cleanup runs automatically
   * - Recent logs preserved
   */
  describe('30-Day Retention (T071)', () => {
    it('should_deleteOldLogs_when_cleanupCalled', async () => {
      // Create mock old log file (35 days ago)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 35);
      const oldFilename = `audit-${oldDate.toISOString().split('T')[0]}.log`;
      const oldLogPath = path.join(TEST_LOG_DIR, oldFilename);

      await fs.mkdir(TEST_LOG_DIR, { recursive: true });
      await fs.writeFile(oldLogPath, 'old log content\n', 'utf-8');

      // Create recent log file
      const recentDate = new Date();
      const recentFilename = `audit-${recentDate.toISOString().split('T')[0]}.log`;
      const recentLogPath = path.join(TEST_LOG_DIR, recentFilename);
      await fs.writeFile(recentLogPath, 'recent log content\n', 'utf-8');

      // Run cleanup
      await auditLogger.cleanup();

      // Verify old log deleted, recent log preserved
      const files = await fs.readdir(TEST_LOG_DIR);
      expect(files).not.toContain(oldFilename);
      expect(files).toContain(recentFilename);
    });

    it('should_respectRetentionDays_when_customValueProvided', async () => {
      // Create logger with 7-day retention
      const shortRetentionLogger = new AuditLogger({
        logDir: TEST_LOG_DIR,
        retentionDays: 7
      });

      // Create log file 10 days old (should be deleted)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);
      const oldFilename = `audit-${oldDate.toISOString().split('T')[0]}.log`;
      const oldLogPath = path.join(TEST_LOG_DIR, oldFilename);

      await fs.mkdir(TEST_LOG_DIR, { recursive: true });
      await fs.writeFile(oldLogPath, 'old log\n', 'utf-8');

      // Create log file 5 days old (should be kept)
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 5);
      const recentFilename = `audit-${recentDate.toISOString().split('T')[0]}.log`;
      const recentLogPath = path.join(TEST_LOG_DIR, recentFilename);
      await fs.writeFile(recentLogPath, 'recent log\n', 'utf-8');

      await shortRetentionLogger.cleanup();

      const files = await fs.readdir(TEST_LOG_DIR);
      expect(files).not.toContain(oldFilename);
      expect(files).toContain(recentFilename);
    });

    it('should_preserveAllLogs_when_withinRetentionPeriod', async () => {
      // Create multiple recent log files
      await fs.mkdir(TEST_LOG_DIR, { recursive: true });

      const filenames: string[] = [];
      for (let i = 0; i < 5; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const filename = `audit-${date.toISOString().split('T')[0]}.log`;
        filenames.push(filename);

        await fs.writeFile(
          path.join(TEST_LOG_DIR, filename),
          `log ${i}\n`,
          'utf-8'
        );
      }

      await auditLogger.cleanup();

      // All recent logs should still exist
      const files = await fs.readdir(TEST_LOG_DIR);
      filenames.forEach(filename => {
        expect(files).toContain(filename);
      });
    });
  });

  /**
   * T072: AsyncLock Protection Test
   *
   * ACCEPTANCE CRITERIA:
   * - Concurrent writes protected by AsyncLock
   * - No interleaved log entries (each entry complete JSON line)
   * - Write order preserved
   * - No race conditions or data corruption
   */
  describe('AsyncLock Protection (T072)', () => {
    it('should_preventInterleavedWrites_when_concurrentLogsWritten', async () => {
      // Write 100 entries concurrently
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 100; i++) {
        const entry: AuditLogEntry = {
          timestamp: new Date().toISOString(),
          correlationId: `concurrent-${i}`,
          eventType: 'tool_call',
          status: 'success',
          metadata: { index: i }
        };

        promises.push(auditLogger.log(entry));
      }

      await Promise.all(promises);

      // Read log file
      const today = new Date().toISOString().split('T')[0];
      const logPath = path.join(TEST_LOG_DIR, `audit-${today}.log`);
      const content = await fs.readFile(logPath, 'utf-8');

      // Parse each line as JSON (should not throw)
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(100);

      const parsedEntries = lines.map(line => JSON.parse(line));

      // Verify all 100 entries present
      const correlationIds = parsedEntries.map(e => e.correlationId);
      for (let i = 0; i < 100; i++) {
        expect(correlationIds).toContain(`concurrent-${i}`);
      }
    });

    it('should_writeCompleteJSONLines_when_concurrentAccess', async () => {
      // Concurrent writes with varying entry sizes
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 50; i++) {
        const entry: AuditLogEntry = {
          timestamp: new Date().toISOString(),
          correlationId: `test-${i}`,
          eventType: 'tool_call',
          status: 'success',
          metadata: {
            iteration: i,
            largeData: 'x'.repeat(i * 10) // Varying sizes
          }
        };

        promises.push(auditLogger.log(entry));
      }

      await Promise.all(promises);

      // Read and parse log file
      const today = new Date().toISOString().split('T')[0];
      const logPath = path.join(TEST_LOG_DIR, `audit-${today}.log`);
      const content = await fs.readFile(logPath, 'utf-8');
      const lines = content.trim().split('\n');

      // Every line should be valid JSON
      lines.forEach((line, index) => {
        expect(() => JSON.parse(line)).not.toThrow();
        const parsed = JSON.parse(line);
        expect(parsed).toHaveProperty('timestamp');
        expect(parsed).toHaveProperty('correlationId');
        expect(parsed).toHaveProperty('eventType');
      });
    });
  });

  /**
   * JSONL Format Test (T077)
   *
   * ACCEPTANCE CRITERIA:
   * - One JSON object per line
   * - Streaming parser compatible
   * - No trailing commas, no array wrapper
   * - Newline-delimited
   */
  describe('JSONL Format (T077)', () => {
    it('should_writeOneJSONPerLine_when_multipleEntriesLogged', async () => {
      const entries: AuditLogEntry[] = [
        {
          timestamp: new Date().toISOString(),
          correlationId: 'entry-1',
          eventType: 'auth_failure',
          status: 'failure'
        },
        {
          timestamp: new Date().toISOString(),
          correlationId: 'entry-2',
          eventType: 'tool_call',
          status: 'success'
        },
        {
          timestamp: new Date().toISOString(),
          correlationId: 'entry-3',
          eventType: 'discovery',
          status: 'success'
        }
      ];

      for (const entry of entries) {
        await auditLogger.log(entry);
      }

      // Read log file
      const today = new Date().toISOString().split('T')[0];
      const logPath = path.join(TEST_LOG_DIR, `audit-${today}.log`);
      const content = await fs.readFile(logPath, 'utf-8');

      // Verify JSONL format
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(3);

      // Each line should be valid JSON
      const parsed = lines.map(line => JSON.parse(line));
      expect(parsed[0].correlationId).toBe('entry-1');
      expect(parsed[1].correlationId).toBe('entry-2');
      expect(parsed[2].correlationId).toBe('entry-3');
    });

    it('should_notHaveArrayWrapper_when_fileRead', async () => {
      await auditLogger.log({
        timestamp: new Date().toISOString(),
        correlationId: 'test',
        eventType: 'tool_call',
        status: 'success'
      });

      const today = new Date().toISOString().split('T')[0];
      const logPath = path.join(TEST_LOG_DIR, `audit-${today}.log`);
      const content = await fs.readFile(logPath, 'utf-8');

      // Should not start with '[' (no array wrapper)
      expect(content.trim()).not.toMatch(/^\[/);
      // Should not end with ']'
      expect(content.trim()).not.toMatch(/\]$/);
    });
  });

  /**
   * Flush Test
   *
   * ACCEPTANCE CRITERIA:
   * - Ensures all buffered entries written to disk
   * - Called during graceful shutdown
   * - No data loss on process termination
   */
  describe('Flush', () => {
    it('should_writeAllPendingEntries_when_flushCalled', async () => {
      // Log multiple entries
      for (let i = 0; i < 10; i++) {
        await auditLogger.log({
          timestamp: new Date().toISOString(),
          correlationId: `flush-test-${i}`,
          eventType: 'tool_call',
          status: 'success'
        });
      }

      // Flush to ensure all written
      await auditLogger.flush();

      // Verify all entries present
      const today = new Date().toISOString().split('T')[0];
      const logPath = path.join(TEST_LOG_DIR, `audit-${today}.log`);
      const content = await fs.readFile(logPath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(10);
    });
  });
});
