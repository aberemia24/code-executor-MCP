/**
 * Helper classes for MCP Proxy Server
 *
 * Extracted to follow Single Responsibility Principle (SRP)
 */

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
}

/**
 * Tracks which MCP tools were called during execution
 */
export class ToolCallTracker {
  private callLog: string[] = [];

  /**
   * Record a tool call
   */
  track(toolName: string): void {
    this.callLog.push(toolName);
  }

  /**
   * Get all tracked tool calls
   */
  getCalls(): string[] {
    return [...this.callLog];
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
    return [...new Set(this.callLog)];
  }
}
