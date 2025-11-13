/**
 * Security validation and audit logging
 */

import * as fs from 'fs/promises';
import { isAuditLogEnabled, getAuditLogPath, getAllowedReadPaths } from './config.js';
import { isValidMCPToolName, isAllowedPath, hashCode } from './utils.js';
import { validateNetworkPermissions } from './network-security.js';
import type { AuditLogEntry, CodeValidationResult, SandboxPermissions } from './types.js';

/**
 * Dangerous code patterns to block
 *
 * ⚠️ **CRITICAL SECURITY WARNING** ⚠️
 *
 * This pattern-based blocking is **NOT A SECURITY BOUNDARY** and provides only
 * **DEFENSE-IN-DEPTH** protection. It can be trivially bypassed using:
 *
 * - String concatenation: `global['ev'+'al']`, `__import__('o'+'s')`
 * - Unicode escapes: `eval\u0028`, `\u0065val`
 * - Computed properties: `globalThis['pro'+'cess']`
 * - Character codes: `String.fromCharCode(101,118,97,108)` // "eval"
 * - Template literals, comments, and other obfuscation
 *
 * **DO NOT RELY ON THIS FOR SECURITY**
 *
 * Real security MUST come from:
 * 1. Deno sandbox permissions (--no-env, --allow-read, --allow-write, --allow-net)
 * 2. Resource limits (--v8-flags=--max-old-space-size)
 * 3. Process isolation (Docker/gVisor/Firecracker)
 * 4. Network policies (block localhost/private IPs)
 * 5. MCP tool allowlists with minimal privileges
 *
 * This validation helps catch **ACCIDENTAL** misuse and provides audit trail,
 * but assume attackers can bypass it. Design security assuming code can execute
 * anything within the sandbox's permission set.
 *
 * Comprehensive patterns to detect dangerous operations.
 * Covers both JavaScript/TypeScript and Python dangerous patterns.
 */
const DANGEROUS_PATTERNS = [
  // JavaScript/TypeScript patterns
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

  // Python patterns
  /\b__import__\s*\(/gi,                     // __import__() - dynamic imports
  /\bexec\s*\(/gi,                           // exec() - execute arbitrary code
  /\bcompile\s*\(/gi,                        // compile() - compile code objects
  /pickle\.loads/gi,                         // pickle.loads() - deserialization RCE
  /\bos\.system/gi,                          // os.system() - shell command execution
  /subprocess\.(run|call|Popen|check_output)/gi, // subprocess - process spawning
  /\bopen\s*\(.*['"]w/gi,                    // open() in write mode (file system access)
  /\bglobals\s*\(/gi,                        // globals() - access to global scope
  /\blocals\s*\(/gi,                         // locals() - access to local scope
  /\b__builtins__/gi,                        // __builtins__ - access to built-in functions
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
   *
   * SECURITY: Now async to support realpath() symlink resolution in isAllowedPath
   */
  async validatePermissions(permissions: SandboxPermissions): Promise<void> {
    const allowedProjects = getAllowedReadPaths();

    // Validate read paths
    if (permissions.read) {
      for (const path of permissions.read) {
        if (!(await isAllowedPath(path, allowedProjects))) {
          throw new Error(
            `Read path not allowed: ${path}. ` +
            `Must be within: ${allowedProjects.join(', ')}`
          );
        }
      }
    }

    // Validate write paths
    if (permissions.write) {
      for (const path of permissions.write) {
        // Write paths are more restricted - only /tmp by default
        const allowedWritePaths = ['/tmp', ...allowedProjects];
        if (!(await isAllowedPath(path, allowedWritePaths))) {
          throw new Error(
            `Write path not allowed: ${path}. ` +
            `Must be within: ${allowedWritePaths.join(', ')}`
          );
        }
      }
    }

    // Validate network hosts (format + SSRF protection)
    if (permissions.net) {
      // Basic format validation
      for (const host of permissions.net) {
        if (!/^[a-zA-Z0-9.-]+(:[0-9]+)?$/.test(host)) {
          throw new Error(
            `Invalid network host format: ${host}. ` +
            `Expected format: hostname[:port]`
          );
        }
      }

      // SECURITY: SSRF protection - validate against blocked hosts
      const networkValidation = validateNetworkPermissions(permissions.net);
      if (!networkValidation.valid) {
        throw new Error(
          `Network permissions include blocked hosts for SSRF protection: ` +
          `${networkValidation.blockedHosts.join(', ')}. ` +
          `Blocked categories: localhost (except for MCP proxy), private networks ` +
          `(10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), cloud metadata endpoints ` +
          `(169.254.169.254, metadata.google.internal).`
        );
      }

      // Log warnings for informational purposes
      if (networkValidation.warnings.length > 0) {
        for (const warning of networkValidation.warnings) {
          console.warn('[SECURITY]', warning);
        }
      }
    }
  }

  /**
   * Validate code for dangerous patterns
   *
   * ⚠️ SECURITY NOTE: This is defense-in-depth only, NOT a security boundary.
   * Attackers can bypass regex patterns. Real security comes from sandbox
   * permissions, resource limits, and process isolation.
   *
   * This helps catch accidental misuse and provides audit trail.
   *
   * @param code - Code to validate
   * @param skipDangerousPatternCheck - Skip dangerous pattern validation (optional)
   */
  validateCode(code: string, skipDangerousPatternCheck = false): CodeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for dangerous patterns (defense-in-depth, not security boundary)
    if (!skipDangerousPatternCheck) {
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(code)) {
          // SECURITY: Use generic error message to avoid revealing exact pattern
          errors.push(
            `Code contains potentially dangerous pattern. ` +
            `This pattern is blocked as defense-in-depth protection.`
          );
        }
      }
    } else {
      // Log warning when validation is skipped
      warnings.push(
        `Dangerous pattern validation skipped. ` +
        `Ensure sandbox permissions are properly configured for security.`
      );
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
  async auditLog(entry: Omit<AuditLogEntry, 'timestamp' | 'codeHash' | 'codeLength'>, code: string): Promise<void> {
    if (!isAuditLogEnabled()) {
      return;
    }

    const fullEntry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      codeHash: hashCode(code),
      codeLength: Buffer.byteLength(code, 'utf-8'),
      ...entry,
    };

    try {
      const logLine = JSON.stringify(fullEntry) + '\n';
      await fs.appendFile(getAuditLogPath(), logLine, 'utf-8');
    } catch (error) {
      // Don't fail execution if audit logging fails
      console.error('Failed to write audit log:', error);
    }
  }

  /**
   * Check if audit logging is enabled
   */
  isAuditLogEnabled(): boolean {
    return isAuditLogEnabled();
  }
}
