/**
 * Utility functions for Code Executor MCP Server
 */

import * as crypto from 'crypto';
import { CHARACTER_LIMIT } from './config.js';
import type { ErrorResponse, ErrorType } from './types.js';

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
 * Format error response with actionable message
 */
export function formatErrorResponse(
  error: unknown,
  errorType: ErrorType,
  suggestion?: string
): ErrorResponse {
  const errorMessage = error instanceof Error ? error.message : String(error);

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
  const pattern = /^mcp__[a-zA-Z0-9_]+__[a-zA-Z0-9_-]+$/;
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
 * Normalize unknown error to Error with context
 *
 * DRY utility to avoid duplicating error normalization across the codebase.
 *
 * @param error - Unknown error (can be Error, string, or any type)
 * @param context - Contextual prefix for the error message
 * @returns Normalized Error object with context
 */
export function normalizeError(error: unknown, context: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${context}: ${message}`);
}
