/**
 * Security validation and audit logging
 */

import * as fs from 'fs/promises';
import { ENABLE_AUDIT_LOG, AUDIT_LOG_PATH, ALLOWED_PROJECTS } from './constants.js';
import { isValidMCPToolName, isAllowedPath, hashCode } from './utils.js';
import type { AuditLogEntry, CodeValidationResult, SandboxPermissions } from './types.js';

/**
 * Dangerous code patterns to block
 *
 * Comprehensive patterns to prevent code injection and sandbox escapes
 */
const DANGEROUS_PATTERNS = [
  /\beval\s*\(/gi,                           // eval( with whitespace
  /\['eval'\]|\["eval"\]/gi,                 // globalThis['eval'] or window['eval']
  /\bFunction\s*\(/gi,                       // Function( constructor
  /new\s+Function/gi,                        // new Function
  /\.constructor\.constructor/gi,            // .constructor.constructor('code')()
  /\brequire\s*\(/gi,                        // require()
  /\bimport\s*\(/gi,                         // import() dynamic imports
  /import\s+.*['"]child_process/gi,          // import ... from 'child_process'
  /import\s+.*['"]node:child_process/gi,     // import ... from 'node:child_process'
  /Deno\.(run|Command)/gi,                   // Deno.run | Deno.Command
  /\bexec(Sync|File)?\s*\(/gi,               // exec, execSync, execFile
  /setTimeout\s*\(\s*['"`]/gi,               // setTimeout('code')
  /setInterval\s*\(\s*['"`]/gi,              // setInterval('code')
] as const;

/**
 * Security validator class
 */
export class SecurityValidator {
  /**
   * Validate MCP tool allowlist
   */
  validateAllowlist(tools: string[]): void {
    for (const tool of tools) {
      if (!isValidMCPToolName(tool)) {
        throw new Error(
          `Invalid MCP tool name: ${tool}. ` +
          `Must match pattern: mcp__<server>__<tool>`
        );
      }
    }
  }

  /**
   * Validate sandbox permissions
   */
  validatePermissions(permissions: SandboxPermissions): void {
    // Validate read paths
    if (permissions.read) {
      for (const path of permissions.read) {
        if (!isAllowedPath(path, ALLOWED_PROJECTS)) {
          throw new Error(
            `Read path not allowed: ${path}. ` +
            `Must be within: ${ALLOWED_PROJECTS.join(', ')}`
          );
        }
      }
    }

    // Validate write paths
    if (permissions.write) {
      for (const path of permissions.write) {
        // Write paths are more restricted - only /tmp by default
        const allowedWritePaths = ['/tmp', ...ALLOWED_PROJECTS];
        if (!isAllowedPath(path, allowedWritePaths)) {
          throw new Error(
            `Write path not allowed: ${path}. ` +
            `Must be within: ${allowedWritePaths.join(', ')}`
          );
        }
      }
    }

    // Validate network hosts (basic format check)
    if (permissions.net) {
      for (const host of permissions.net) {
        if (!/^[a-zA-Z0-9.-]+(:[0-9]+)?$/.test(host)) {
          throw new Error(
            `Invalid network host format: ${host}. ` +
            `Expected format: hostname[:port]`
          );
        }
      }
    }
  }

  /**
   * Validate code for dangerous patterns
   */
  validateCode(code: string): CodeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for dangerous patterns
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(code)) {
        errors.push(
          `Dangerous pattern detected: ${pattern.source}. ` +
          `This pattern is blocked for security reasons.`
        );
      }
    }

    // Check code length (basic sanity check)
    if (code.length > 100_000) {
      warnings.push(
        `Code is very long (${code.length} characters). ` +
        `Consider splitting into smaller functions for better performance.`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Create audit log entry
   */
  async auditLog(entry: Omit<AuditLogEntry, 'timestamp' | 'codeHash'>, code: string): Promise<void> {
    if (!ENABLE_AUDIT_LOG) {
      return;
    }

    const fullEntry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      codeHash: hashCode(code),
      ...entry,
    };

    try {
      const logLine = JSON.stringify(fullEntry) + '\n';
      await fs.appendFile(AUDIT_LOG_PATH, logLine, 'utf-8');
    } catch (error) {
      // Don't fail execution if audit logging fails
      console.error('Failed to write audit log:', error);
    }
  }

  /**
   * Check if audit logging is enabled
   */
  isAuditLogEnabled(): boolean {
    return ENABLE_AUDIT_LOG;
  }
}
