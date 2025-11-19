/**
 * Utility functions for Code Executor MCP Server
 */

import * as crypto from 'crypto';
import { CHARACTER_LIMIT } from './config.js';
import type { ErrorResponse, ErrorType, ExecutionResult } from './types.js';

/**
 * Truncate text to character limit with clear indicator
 */
export function truncateOutput(text: string): string {
  if (text.length <= CHARACTER_LIMIT) {
    return text;
  }

  const truncated = text.slice(0, CHARACTER_LIMIT);
  const remaining = text.length - CHARACTER_LIMIT;

  return `${truncated}\n\n[Output truncated: ${remaining} more characters. Consider filtering or limiting output in your code.]`;
}

/**
 * Create SHA-256 hash of code
 */
export function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/**
 * Format error response with actionable message (TYPE-001 fix)
 */
export function formatErrorResponse(
  error: unknown,
  errorType: ErrorType,
  suggestion?: string
): ErrorResponse {
  // Use isError() type guard instead of instanceof
  const errorMessage = isError(error) ? error.message : String(error);

  return {
    error: errorMessage,
    errorType,
    suggestion,
  };
}

/**
 * Validate MCP tool name format
 */
export function isValidMCPToolName(toolName: string): boolean {
  // Format: mcp__<server>__<tool>
  // Allow uppercase (Linear, Notion), hyphens (Context7 tools), and underscores
  const pattern = /^mcp__[a-zA-Z0-9_-]+__[a-zA-Z0-9_-]+$/;
  return pattern.test(toolName);
}

/**
 * Extract server name from MCP tool name
 */
export function extractServerName(toolName: string): string {
  // mcp__zen__codereview -> zen
  const parts = toolName.split('__');
  if (parts.length !== 3 || !parts[1]) {
    throw new Error(`Invalid MCP tool name format: ${toolName}`);
  }
  return parts[1];
}

/**
 * Format duration in human-readable form
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

export interface ExecutionResultFormatterOptions {
  /** Enable ANSI color styling */
  useColor?: boolean;
  /** Indentation (number of spaces or string) */
  indent?: number | string;
}

/**
 * Render ExecutionResult objects into a human friendly multi-section string.
 */
export function formatExecutionResultForCli(
  result: ExecutionResult,
  options: ExecutionResultFormatterOptions = {}
): string {
  const useColor = options.useColor ?? false;
  const indentString =
    typeof options.indent === 'number'
      ? ' '.repeat(Math.max(0, options.indent))
      : options.indent ?? '  ';

  const applyStyle = (text: string, ...codes: string[]) => {
    if (!useColor || codes.length === 0) {
      return text;
    }
    const prefix = `\u001b[${codes.join(';')}m`;
    const suffix = '\u001b[0m';
    return `${prefix}${text}${suffix}`;
  };

  const status = (() => {
    if (result.success) {
      return 'SUCCESS';
    }

    const errorText = result.error?.toLowerCase() ?? '';
    if (errorText.includes('timeout')) {
      return 'TIMEOUT';
    }

    return 'FAILURE';
  })();

  const statusColor =
    status === 'SUCCESS' ? '32' : status === 'FAILURE' ? '31' : '33';

  const sections: string[] = [];
  sections.push(applyStyle(`Status: ${status}`, '1', statusColor));

  const formatBlock = (title: string, content: string | undefined) => {
    sections.push(applyStyle(`${title}:`, '1'));
    const lines = content && content.length > 0 ? content.split(/\r?\n/) : ['(none)'];
    for (const line of lines) {
      sections.push(`${indentString}${line}`);
    }
  };

  formatBlock('Stdout', result.output);
  formatBlock('Stderr', result.error);

  sections.push(applyStyle('Duration:', '1'));
  sections.push(`${indentString}${formatDuration(result.executionTimeMs)}`);

  sections.push(applyStyle('Tool Calls:', '1'));
  const toolCalls = result.toolCallsMade ?? [];
  if (toolCalls.length === 0) {
    sections.push(`${indentString}None`);
  } else {
    for (const toolCall of toolCalls) {
      sections.push(`${indentString}- ${toolCall}`);
    }
  }

  return sections.join('\n');
}

/**
 * Check if path is within allowed project roots
 *
 * SECURITY: Uses fs.realpath() to resolve symlinks and canonicalize paths
 * to prevent symlink escapes and path traversal attacks.
 *
 * Changes in this version:
 * - Now async (returns Promise<boolean>)
 * - Resolves symlinks via fs.realpath()
 * - Canonicalizes paths to prevent ../../../ attacks
 * - Handles non-existent paths gracefully (returns false)
 */
export async function isAllowedPath(path: string, allowedRoots: string[]): Promise<boolean> {
  if (allowedRoots.length === 0) {
    return false; // No paths allowed if no roots specified
  }

  try {
    // Resolve symlinks and canonicalize path
    const { realpath } = await import('fs/promises');
    const resolvedPath = await realpath(path);

    for (const root of allowedRoots) {
      try {
        const resolvedRoot = await realpath(root);

        // Use path.sep for OS-agnostic separator
        const { sep } = await import('path');

        // Exact match or proper subdirectory
        if (resolvedPath === resolvedRoot ||
            resolvedPath.startsWith(resolvedRoot + sep)) {
          return true;
        }
      } catch {
        // Root doesn't exist or not accessible - skip this root
        continue;
      }
    }

    return false;
  } catch {
    // Path doesn't exist or access denied
    return false;
  }
}

/**
 * Sanitize output for safe display
 */
export function sanitizeOutput(output: string): string {
  // Remove potential ANSI escape codes
  return output.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Type guard to check if value is an Error instance (TYPE-001 fix)
 *
 * WHY: Safer than `(error as Error)` which bypasses type safety
 *
 * @param e - Unknown value to check
 * @returns True if value is Error instance
 *
 * @example
 * ```typescript
 * catch (error: unknown) {
 *   if (isError(error)) {
 *     console.log(error.message); // ✅ Type-safe
 *   }
 * }
 * ```
 */
export function isError(e: unknown): e is Error {
  return e instanceof Error;
}

/**
 * Type guard to check if value is a Node.js ErrnoException (TYPE-001 fix)
 *
 * WHY: File system errors have `code` property (e.g., 'ENOENT')
 * that we need to check safely without casting
 *
 * @param e - Unknown value to check
 * @returns True if value has ErrnoException structure
 *
 * @example
 * ```typescript
 * catch (error: unknown) {
 *   if (isErrnoException(error) && error.code === 'ENOENT') {
 *     // Handle missing file gracefully
 *   }
 * }
 * ```
 */
export function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    typeof (e as { code: unknown }).code === 'string'
  );
}

/**
 * Normalize unknown error to Error (TYPE-001 fix)
 *
 * WHY: JavaScript allows throwing any type (string, number, object).
 * This function ensures we always have an Error with stack trace.
 *
 * @param error - Unknown thrown value
 * @returns Error instance (original if already Error, wrapped otherwise)
 *
 * @example
 * ```typescript
 * catch (error: unknown) {
 *   const err = normalizeError(error);
 *   console.error(err.message, err.stack); // ✅ Always available
 * }
 * ```
 */
export function normalizeError(error: unknown): Error;
/**
 * Normalize unknown error to Error with context
 *
 * DRY utility to avoid duplicating error normalization across the codebase.
 *
 * @param error - Unknown error (can be Error, string, or any type)
 * @param context - Contextual prefix for the error message
 * @returns Normalized Error object with context
 */
export function normalizeError(error: unknown, context: string): Error;
export function normalizeError(error: unknown, context?: string): Error {
  // If already Error, return as-is or with context
  if (isError(error)) {
    return context ? new Error(`${context}: ${error.message}`) : error;
  }

  // String: Wrap in Error
  if (typeof error === 'string') {
    const message = context ? `${context}: ${error}` : error;
    return new Error(message);
  }

  // Object: Serialize to JSON (handles circular refs gracefully)
  if (typeof error === 'object' && error !== null) {
    try {
      const serialized = JSON.stringify(error);
      const message = context ? `${context}: ${serialized}` : serialized;
      return new Error(message);
    } catch {
      // Circular reference or BigInt - fallback to toString
      const stringified = String(error);
      const message = context ? `${context}: ${stringified}` : stringified;
      return new Error(message);
    }
  }

  // Primitive types (number, boolean, null, undefined, symbol)
  const stringified = String(error);
  const message = context ? `${context}: ${stringified}` : stringified;
  return new Error(message);
}
