/**
 * Helper classes for MCP Proxy Server
 *
 * Extracted to follow Single Responsibility Principle (SRP)
 */

import type { ToolCallStatus, ToolCallSummaryEntry } from './types.js';

/**
 * Validates tool calls against allowlist
 */
export class AllowlistValidator {
  constructor(private allowedTools: string[]) {}

  /**
   * Check if tool is allowed
   * @throws {Error} if tool not in allowlist
   */
  validate(toolName: string): void {
    if (!this.allowedTools.includes(toolName)) {
      throw new Error(`Tool '${toolName}' not in allowlist. Add '${toolName}' to allowedTools array`);
    }
  }

  /**
   * Check if tool is allowed (non-throwing)
   */
  isAllowed(toolName: string): boolean {
    return this.allowedTools.includes(toolName);
  }

  /**
   * Get current allowlist
   */
  getAllowedTools(): string[] {
    return [...this.allowedTools];
  }
}

interface ToolCallRecord {
  toolName: string;
  durationMs: number;
  status: ToolCallStatus;
  errorMessage?: string;
  timestamp: number;
}

/**
 * Tracks which MCP tools were called during execution
 */
export class ToolCallTracker {
  private callLog: ToolCallRecord[] = [];

  /**
   * Record a tool call
   */
  track(
    toolName: string,
    details: {
      durationMs: number;
      status: ToolCallStatus;
      errorMessage?: string;
      timestamp?: number;
    }
  ): void {
    const record: ToolCallRecord = {
      toolName,
      durationMs: details.durationMs,
      status: details.status,
      errorMessage: details.errorMessage,
      timestamp: details.timestamp ?? Date.now(),
    };

    this.callLog.push(record);
  }

  /**
   * Get all tracked tool calls
   */
  getCalls(): string[] {
    return this.callLog.map((record) => record.toolName);
  }

  /**
   * Get aggregated call summary for each tool
   */
  getSummary(): ToolCallSummaryEntry[] {
    const summaryMap = new Map<
      string,
      ToolCallSummaryEntry & {
        totalDurationMs: number;
      }
    >();

    for (const record of this.callLog) {
      const existing = summaryMap.get(record.toolName);
      const baseEntry: ToolCallSummaryEntry & { totalDurationMs: number } = existing ?? {
        toolName: record.toolName,
        callCount: 0,
        successCount: 0,
        errorCount: 0,
        totalDurationMs: 0,
        averageDurationMs: 0,
      };

      const callCount = baseEntry.callCount + 1;
      const successCount = baseEntry.successCount + (record.status === 'success' ? 1 : 0);
      const errorCount = baseEntry.errorCount + (record.status === 'error' ? 1 : 0);
      const totalDurationMs = baseEntry.totalDurationMs + record.durationMs;

      const updatedEntry: ToolCallSummaryEntry & { totalDurationMs: number } = {
        ...baseEntry,
        callCount,
        successCount,
        errorCount,
        totalDurationMs,
        averageDurationMs: callCount > 0 ? totalDurationMs / callCount : 0,
        lastCallDurationMs: record.durationMs,
        lastCallStatus: record.status,
        lastErrorMessage: record.status === 'error' ? record.errorMessage : undefined,
        lastCalledAt: new Date(record.timestamp).toISOString(),
      };

      summaryMap.set(record.toolName, updatedEntry);
    }

    return Array.from(summaryMap.values()).map((entry) => ({ ...entry }));
  }

  /**
   * Clear tracked calls
   */
  clear(): void {
    this.callLog = [];
  }

  /**
   * Get unique tool names called
   */
  getUniqueCalls(): string[] {
    return [...new Set(this.callLog.map((record) => record.toolName))];
  }
}
