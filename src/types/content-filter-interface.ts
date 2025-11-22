/**
 * Interface for Content Filtering in MCP Sampling
 *
 * Provides dependency inversion for content filtering, allowing different
 * implementations (regex-based, ML-based, etc.) to be swapped.
 */
export interface IContentFilter {
  /**
   * Scan content for secrets and PII violations
   *
   * @param content - Text content to scan (typically LLM response)
   * @returns Object containing violations array and filtered content
   */
  scan(content: string): {
    violations: Array<{type: string; pattern: string; count: number}>;
    filtered: string;
  };

  /**
   * Filter content by redacting or rejecting based on policy
   *
   * @param content - Text content to filter
   * @param rejectOnViolation - If true, throws on violations. If false, returns redacted content.
   * @returns Filtered content (may be redacted)
   * @throws Error if rejectOnViolation=true and violations found
   */
  filter(content: string, rejectOnViolation?: boolean): string;

  /**
   * Check if content contains any violations
   *
   * @param content - Text content to check
   * @returns True if violations detected, false otherwise
   */
  hasViolations(content: string): boolean;

  /**
   * Get list of supported detection patterns
   *
   * @returns Array of pattern names (e.g., ['openai_key', 'email', 'ssn'])
   */
  getSupportedPatterns(): string[];
}

