/**
 * Sampling Audit Logger (FR-8)
 *
 * Provides audit trail for MCP sampling calls with:
 * - SHA-256 hashing of sensitive data (no plaintext prompts/responses)
 * - AsyncLock protection for concurrent writes
 * - Content filtering violation tracking
 * - Integration with existing AuditLogger infrastructure
 *
 * Security considerations:
 * - Prompts/responses hashed with SHA-256 (never logged in plaintext)
 * - Content violations logged by type/count (no actual secrets logged)
 * - Error messages sanitized (no stack traces, no sensitive data)
 *
 * @see specs/001-mcp-sampling/spec.md (FR-8)
 */

import { createHash } from 'crypto';
import AsyncLock from 'async-lock';
import { AuditLogger } from './audit-logger.js';
import type { SamplingAuditEntry } from './types.js';

/**
 * Sampling-specific audit logger
 *
 * Extends existing AuditLogger with sampling-specific event types.
 * Uses the same daily rotation and AsyncLock protection.
 *
 * **WHY Separate Logger?**
 * - Sampling events have different schema than tool calls
 * - SHA-256 hashing required for prompts/responses
 * - Content filtering violations need structured logging
 */
export class SamplingAuditLogger {
  private auditLogger: AuditLogger;

  constructor(auditLogger?: AuditLogger) {
    // Reuse existing audit logger infrastructure
    // WHY: Single audit log directory, consistent rotation/retention
    this.auditLogger = auditLogger || new AuditLogger();
  }

  /**
   * Log sampling call with SHA-256 hashing
   *
   * **Security:**
   * - Prompts/responses MUST be hashed before calling this function
   * - Content violations logged by type/count only (no actual secrets)
   * - Error messages MUST be sanitized (no stack traces)
   *
   * @param entry - Sampling audit entry with hashed data
   * @throws {Error} If audit log write fails
   */
  async logSamplingCall(entry: SamplingAuditEntry): Promise<void> {
    // Map sampling event to audit log entry format
    await this.auditLogger.log({
      timestamp: entry.timestamp,
      correlationId: entry.executionId,
      eventType: 'tool_call', // Reuse existing event type (sampling is a tool)
      toolName: 'sampling', // Distinguish from other MCP tools
      // Store sampling-specific data in metadata
      metadata: {
        round: entry.round,
        model: entry.model,
        promptHash: entry.promptHash,
        responseHash: entry.responseHash,
        tokensUsed: entry.tokensUsed,
        durationMs: entry.durationMs,
        contentViolations: entry.contentViolations,
        // FIX: Preserve original status to avoid data loss (error vs rate_limited vs timeout)
        // WHY: AuditLogger only accepts 'success' | 'failure' | 'rejected', but sampling has more granular statuses
        originalStatus: entry.status,
      },
      status: entry.status === 'success' ? 'success' : 'failure',
      errorMessage: entry.errorMessage,
      latencyMs: entry.durationMs,
    });
  }

  /**
   * Hash content with SHA-256
   *
   * **WHY SHA-256?**
   * - Cryptographically secure (no collisions)
   * - Deterministic (same input = same hash)
   * - One-way (cannot reverse to get plaintext)
   * - Industry standard for audit trails
   *
   * **Security:**
   * - Hashed content can be used for correlation/deduplication
   * - Original plaintext NEVER appears in audit logs
   * - Prevents accidental secret leakage in logs
   *
   * @param content - Content to hash (prompt or response)
   * @returns SHA-256 hash (64 hex characters)
   */
  hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Flush audit log to disk
   *
   * Use case: Graceful shutdown, ensure no logs lost
   */
  async flush(): Promise<void> {
    await this.auditLogger.flush();
  }
}

/**
 * Global singleton instance
 *
 * WHY Singleton?
 * - Single audit logger per process (consistent rotation)
 * - AsyncLock protection shared across all sampling calls
 * - Prevents multiple log files for same day
 */
let globalSamplingAuditLogger: SamplingAuditLogger | null = null;

/**
 * AsyncLock for singleton initialization
 *
 * WHY AsyncLock?
 * - Prevents race condition in concurrent async initialization
 * - Node.js is single-threaded but async calls can interleave
 * - Ensures only one instance created even under concurrent load
 */
const singletonLock = new AsyncLock();

/**
 * Get or create global sampling audit logger
 *
 * **Thread Safety:**
 * - Protected by AsyncLock to prevent race conditions
 * - Safe for concurrent async calls
 * - Ensures single instance per process
 *
 * @returns Global singleton instance
 */
export async function getSamplingAuditLogger(): Promise<SamplingAuditLogger> {
  return await singletonLock.acquire('singleton-init', async () => {
    if (!globalSamplingAuditLogger) {
      globalSamplingAuditLogger = new SamplingAuditLogger();
    }
    return globalSamplingAuditLogger;
  });
}

/**
 * Helper function for tests: reset global logger
 *
 * **TESTING ONLY** - Do not use in production code
 */
export function resetSamplingAuditLogger(): void {
  globalSamplingAuditLogger = null;
}
