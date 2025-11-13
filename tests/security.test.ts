/**
 * Unit tests for SecurityValidator
 */

import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import { SecurityValidator } from '../src/security.js';
import { initConfig } from '../src/config.js';
import * as fs from 'fs/promises';

// Mock fs for audit logging tests
vi.mock('fs/promises', () => ({
  appendFile: vi.fn(),
}));

describe('SecurityValidator', () => {
  let validator: SecurityValidator;

  beforeAll(async () => {
    // Initialize config once for all tests
    // Set minimal env vars for testing
    process.env.ALLOWED_PROJECTS = process.cwd();
    await initConfig();
  });

  beforeEach(() => {
    validator = new SecurityValidator();
    vi.clearAllMocks();
  });

  describe('validateAllowlist', () => {
    it('should_validate_correct_mcp_tool_names', () => {
      const tools = [
        'mcp__zen__codereview',
        'mcp__filesystem__read_file',
        'mcp__fetcher__fetch'
      ];

      expect(() => validator.validateAllowlist(tools)).not.toThrow();
    });

    it('should_throw_for_invalid_tool_name_format', () => {
      const tools = ['invalid_tool'];

      expect(() => validator.validateAllowlist(tools))
        .toThrow(/Invalid MCP tool name: invalid_tool/);
    });

    it('should_throw_for_missing_mcp_prefix', () => {
      const tools = ['zen__codereview'];

      expect(() => validator.validateAllowlist(tools))
        .toThrow(/Must match pattern: mcp__<server>__<tool>/);
    });

    it('should_validate_empty_allowlist', () => {
      expect(() => validator.validateAllowlist([])).not.toThrow();
    });

    it('should_validate_each_tool_in_array', () => {
      const tools = [
        'mcp__zen__codereview',
        'invalid',
        'mcp__filesystem__read'
      ];

      expect(() => validator.validateAllowlist(tools))
        .toThrow(/Invalid MCP tool name: invalid/);
    });
  });

  describe('validatePermissions', () => {
    it('should_throw_for_any_path_when_allowed_projects_empty', async () => {
      // When ALLOWED_PROJECTS env var is not set, it's an empty array
      const permissions = {
        read: ['/home/user/projects/DopaMind'],
        write: [],
        net: []
      };

      await expect(validator.validatePermissions(permissions))
        .rejects.toThrow(/Read path not allowed/);
    });

    it('should_throw_for_paths_outside_allowed_projects', async () => {
      const permissions = {
        read: ['/etc/passwd'],
        write: [],
        net: []
      };

      await expect(validator.validatePermissions(permissions))
        .rejects.toThrow(/Read path not allowed/);
    });

    it('should_throw_for_invalid_write_paths', async () => {
      const permissions = {
        read: [],
        write: ['/etc'],
        net: []
      };

      await expect(validator.validatePermissions(permissions))
        .rejects.toThrow(/Write path not allowed/);
    });

    it('should_handle_empty_permissions', async () => {
      const permissions = {
        read: [],
        write: [],
        net: []
      };

      await expect(validator.validatePermissions(permissions)).resolves.not.toThrow();
    });

    it('should_validate_network_host_format', async () => {
      const permissions = {
        read: [],
        write: [],
        net: ['localhost', 'example.com', 'api.example.com:8080']
      };

      await expect(validator.validatePermissions(permissions)).resolves.not.toThrow();
    });

    it('should_throw_for_invalid_network_host_format', async () => {
      const permissions = {
        read: [],
        write: [],
        net: ['invalid_host!@#']
      };

      await expect(validator.validatePermissions(permissions))
        .rejects.toThrow(/Invalid network host format/);
    });
  });

  describe('validateCode', () => {
    it('should_validate_safe_code', () => {
      const code = 'console.log("Hello world");';
      const result = validator.validateCode(code);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should_detect_eval_usage', () => {
      const code1 = 'eval("console.log(1)")';
      const result1 = validator.validateCode(code1);
      expect(result1.valid).toBe(false);

      const code2 = 'const x = eval("test")';
      const result2 = validator.validateCode(code2);
      expect(result2.valid).toBe(false);
    });

    it('should_detect_function_constructor', () => {
      const code = 'new Function("return 1")()';
      const result = validator.validateCode(code);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('dangerous pattern');
    });

    it('should_detect_require_usage', () => {
      const code = 'const fs = require("fs")';
      const result = validator.validateCode(code);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('dangerous pattern');
    });

    it('should_detect_dynamic_import', () => {
      const code = 'await import("child_process")';
      const result = validator.validateCode(code);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('dangerous pattern');
    });

    it('should_detect_child_process_import', () => {
      const code = 'import { exec } from "child_process"';
      const result = validator.validateCode(code);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('dangerous pattern');
    });

    it('should_detect_deno_run', () => {
      const code = 'Deno.run({ cmd: ["ls"] })';
      const result = validator.validateCode(code);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('dangerous pattern');
    });

    it('should_detect_exec_usage', () => {
      const code = 'exec("rm -rf /")';
      const result = validator.validateCode(code);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('dangerous pattern');
    });

    it('should_detect_settimeout_with_string', () => {
      const code = 'setTimeout("alert(1)", 1000)';
      const result = validator.validateCode(code);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('dangerous pattern');
    });

    it('should_allow_settimeout_with_function', () => {
      const code = 'setTimeout(() => console.log(1), 1000)';
      const result = validator.validateCode(code);

      expect(result.valid).toBe(true);
    });

    it('should_detect_constructor_constructor_pattern', () => {
      const code = 'foo.constructor.constructor("alert(1)")()';
      const result = validator.validateCode(code);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // Pattern is: \.constructor\.constructor
    });

    it('should_warn_for_very_long_code', () => {
      const code = 'x'.repeat(150000);
      const result = validator.validateCode(code);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Code is very long');
    });

    it('should_allow_normal_length_code', () => {
      const code = 'x'.repeat(50000);
      const result = validator.validateCode(code);

      expect(result.warnings).toEqual([]);
    });

    it('should_detect_multiple_dangerous_patterns', () => {
      const code = 'eval("1"); new Function("2"); require("fs");';
      const result = validator.validateCode(code);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });

    it('should_detect_patterns_with_different_syntax', () => {
      // Test that patterns catch dangerous code in different contexts
      const result1 = validator.validateCode('globalThis.eval("x")');
      const result2 = validator.validateCode('window["eval"]("code")');
      const result3 = validator.validateCode('import("child_process")');

      // At least globalThis['eval'] should be caught
      expect(result1.valid || result2.valid || result3.valid).toBe(false);
    });

    it('should_skip_dangerous_pattern_check_when_flag_true', () => {
      const code = 'eval("console.log(1)")';
      const result = validator.validateCode(code, true);

      // Should be valid when skipping pattern check
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      // Should have a warning about skipped validation
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Dangerous pattern validation skipped');
    });

    it('should_validate_dangerous_patterns_when_flag_false', () => {
      const code = 'eval("console.log(1)")';
      const result = validator.validateCode(code, false);

      // Should be invalid when not skipping pattern check
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('dangerous pattern');
    });

    it('should_validate_dangerous_patterns_when_flag_undefined', () => {
      const code = 'new Function("return 1")()';
      const result = validator.validateCode(code);

      // Default behavior: validate dangerous patterns
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('dangerous pattern');
    });

    it('should_allow_multiple_dangerous_patterns_when_skip_true', () => {
      const code = 'eval("1"); new Function("2"); require("fs");';
      const result = validator.validateCode(code, true);

      // Should be valid when skipping
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      // Should only have skip warning
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain('Dangerous pattern validation skipped');
    });

    it('should_still_warn_for_long_code_when_skip_true', () => {
      const code = 'eval("x"); ' + 'y'.repeat(150000);
      const result = validator.validateCode(code, true);

      // Should be valid (no dangerous pattern errors)
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      // Should have both skip warning AND long code warning
      expect(result.warnings.length).toBe(2);
      expect(result.warnings.some(w => w.includes('Dangerous pattern validation skipped'))).toBe(true);
      expect(result.warnings.some(w => w.includes('Code is very long'))).toBe(true);
    });
  });

  describe('auditLog', () => {
    it('should_not_write_when_audit_log_disabled', async () => {
      // ENABLE_AUDIT_LOG is false by default
      const entry = {
        allowedTools: ['mcp__zen__codereview'],
        toolsCalled: ['mcp__zen__codereview'],
        executionTimeMs: 1000,
        success: true,
      };

      await validator.auditLog(entry, 'console.log("test")');

      // Should not call appendFile when audit logging is disabled
      expect(fs.appendFile).not.toHaveBeenCalled();
    });

    it('should_not_fail_execution_when_audit_fails', async () => {
      vi.mocked(fs.appendFile).mockRejectedValue(new Error('Disk full'));

      const entry = {
        allowedTools: [],
        toolsCalled: [],
        executionTimeMs: 100,
        success: true,
      };

      // Should not throw
      await expect(validator.auditLog(entry, 'test')).resolves.toBeUndefined();
    });
  });

  describe('isAuditLogEnabled', () => {
    it('should_return_boolean', () => {
      const result = validator.isAuditLogEnabled();

      expect(typeof result).toBe('boolean');
    });
  });
});
