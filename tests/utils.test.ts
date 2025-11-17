/**
 * Unit tests for utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  truncateOutput,
  hashCode,
  formatErrorResponse,
  isValidMCPToolName,
  extractServerName,
  formatDuration,
  isAllowedPath,
  sanitizeOutput,
  normalizeError,
  formatExecutionResultForCli,
} from '../src/utils.js';
import { ErrorType } from '../src/types.js';

describe('truncateOutput', () => {
  it('should_not_truncate_when_below_limit', () => {
    const text = 'Short output';
    const result = truncateOutput(text);

    expect(result).toBe(text);
  });

  it('should_truncate_when_above_limit', () => {
    const text = 'x'.repeat(50000); // 50k characters (limit is 25k)
    const result = truncateOutput(text);

    expect(result).toContain('[Output truncated:');
    expect(result).toContain('25000 more characters');
    expect(result.length).toBeLessThan(text.length);
  });

  it('should_include_truncation_message', () => {
    const text = 'x'.repeat(50000);
    const result = truncateOutput(text);

    expect(result).toMatch(/\[Output truncated: \d+ more characters\. Consider filtering/);
  });
});

describe('hashCode', () => {
  it('should_return_sha256_hex_string', () => {
    const code = 'console.log("test")';
    const hash = hashCode(code);

    expect(hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 is 64 hex chars
  });

  it('should_return_same_hash_for_same_code', () => {
    const code = 'console.log("test")';

    const hash1 = hashCode(code);
    const hash2 = hashCode(code);

    expect(hash1).toBe(hash2);
  });

  it('should_return_different_hash_for_different_code', () => {
    const code1 = 'console.log("test1")';
    const code2 = 'console.log("test2")';

    const hash1 = hashCode(code1);
    const hash2 = hashCode(code2);

    expect(hash1).not.toBe(hash2);
  });

  it('should_handle_empty_string', () => {
    const hash = hashCode('');

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('formatErrorResponse', () => {
  it('should_format_error_with_all_fields', () => {
    const error = new Error('Test error');
    const response = formatErrorResponse(error, ErrorType.EXECUTION, 'Try again');

    expect(response.error).toBe('Test error');
    expect(response.errorType).toBe(ErrorType.EXECUTION);
    expect(response.suggestion).toBe('Try again');
  });

  it('should_handle_error_without_suggestion', () => {
    const error = new Error('Test error');
    const response = formatErrorResponse(error, ErrorType.VALIDATION);

    expect(response.error).toBe('Test error');
    expect(response.errorType).toBe(ErrorType.VALIDATION);
    expect(response.suggestion).toBeUndefined();
  });

  it('should_convert_non_error_to_string', () => {
    const response = formatErrorResponse('Plain string error', ErrorType.SECURITY);

    expect(response.error).toBe('Plain string error');
    expect(response.errorType).toBe(ErrorType.SECURITY);
  });

  it('should_handle_unknown_error_types', () => {
    const customObject = { custom: 'data' };
    const response = formatErrorResponse(customObject, ErrorType.MCP);

    // String(object) returns '[object Object]'
    expect(response.error).toBe('[object Object]');
    expect(response.errorType).toBe(ErrorType.MCP);
  });
});

describe('isValidMCPToolName', () => {
  it('should_return_true_for_valid_tool_names', () => {
    expect(isValidMCPToolName('mcp__zen__codereview')).toBe(true);
    expect(isValidMCPToolName('mcp__filesystem__read_file')).toBe(true);
    expect(isValidMCPToolName('mcp__fetcher__fetch')).toBe(true);
  });

  it('should_return_false_for_invalid_formats', () => {
    expect(isValidMCPToolName('invalid')).toBe(false);
    expect(isValidMCPToolName('mcp_zen_codereview')).toBe(false); // Single underscore
    expect(isValidMCPToolName('mcp__zen')).toBe(false); // Missing tool name
    expect(isValidMCPToolName('zen__codereview')).toBe(false); // Missing mcp prefix
  });

  it('should_accept_uppercase_letters_in_server_names', () => {
    // Uppercase in server names (Linear, Notion)
    expect(isValidMCPToolName('mcp__Linear__search_documentation')).toBe(true);
    expect(isValidMCPToolName('mcp__Notion__fetch')).toBe(true);
    expect(isValidMCPToolName('mcp__Zen__codereview')).toBe(true);
    expect(isValidMCPToolName('mcp__GitHub__list_issues')).toBe(true);
  });

  it('should_accept_hyphens_in_tool_names', () => {
    // Hyphens in tool names (Context7)
    expect(isValidMCPToolName('mcp__context7__resolve-library-id')).toBe(true);
    expect(isValidMCPToolName('mcp__context7__get-library-docs')).toBe(true);
    expect(isValidMCPToolName('mcp__zen__code-review')).toBe(true);
  });

  it('should_reject_hyphens_in_server_names', () => {
    // Hyphens NOT allowed in server names
    expect(isValidMCPToolName('mcp__zen-test__codereview')).toBe(false);
    expect(isValidMCPToolName('mcp__my-server__tool')).toBe(false);
  });

  it('should_reject_unsupported_special_characters', () => {
    // Dots, spaces, and other special chars still not allowed
    expect(isValidMCPToolName('mcp__zen__code.review')).toBe(false);
    expect(isValidMCPToolName('mcp__zen__code review')).toBe(false);
    expect(isValidMCPToolName('mcp__zen@server__tool')).toBe(false);
  });

  it('should_require_lowercase_mcp_prefix', () => {
    // MCP prefix must be lowercase (protocol specification)
    expect(isValidMCPToolName('MCP__zen__codereview')).toBe(false);
    expect(isValidMCPToolName('Mcp__zen__codereview')).toBe(false);
    expect(isValidMCPToolName('mcp__zen__codereview')).toBe(true); // Correct
  });
});

describe('extractServerName', () => {
  it('should_extract_server_name_from_valid_tool_name', () => {
    expect(extractServerName('mcp__zen__codereview')).toBe('zen');
    expect(extractServerName('mcp__filesystem__read')).toBe('filesystem');
    expect(extractServerName('mcp__fetcher__fetch')).toBe('fetcher');
  });

  it('should_throw_for_invalid_format', () => {
    expect(() => extractServerName('invalid')).toThrow(/Invalid MCP tool name format/);
    expect(() => extractServerName('mcp__zen')).toThrow(/Invalid MCP tool name format/);
  });
});

describe('formatDuration', () => {
  it('should_format_milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('should_format_seconds', () => {
    expect(formatDuration(1000)).toBe('1.00s');
    expect(formatDuration(5500)).toBe('5.50s');
    expect(formatDuration(59999)).toBe('60.00s');
  });

  it('should_format_minutes_and_seconds', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(125000)).toBe('2m 5s');
  });

  it('should_handle_zero', () => {
    expect(formatDuration(0)).toBe('0ms');
  });
});

describe('sanitizeOutput', () => {
  it('should_remove_ansi_escape_codes', () => {
    const output = '\x1b[31mRed text\x1b[0m Normal text';
    const sanitized = sanitizeOutput(output);

    expect(sanitized).toBe('Red text Normal text');
    expect(sanitized).not.toContain('\x1b');
  });

  it('should_handle_multiple_escape_codes', () => {
    const output = '\x1b[1m\x1b[32mBold green\x1b[0m\x1b[0m';
    const sanitized = sanitizeOutput(output);

    expect(sanitized).toBe('Bold green');
  });

  it('should_handle_output_without_escape_codes', () => {
    const output = 'Plain text';
    const sanitized = sanitizeOutput(output);

    expect(sanitized).toBe(output);
  });

  it('should_handle_empty_string', () => {
    expect(sanitizeOutput('')).toBe('');
  });
});

describe('normalizeError', () => {
  it('should_normalize_error_object_with_context', () => {
    const error = new Error('Original error');
    const normalized = normalizeError(error, 'Failed to process');

    expect(normalized).toBeInstanceOf(Error);
    expect(normalized.message).toBe('Failed to process: Original error');
  });

  it('should_normalize_string_error_with_context', () => {
    const normalized = normalizeError('Something went wrong', 'API call failed');

    expect(normalized).toBeInstanceOf(Error);
    expect(normalized.message).toBe('API call failed: Something went wrong');
  });

  it('should_normalize_unknown_error_types', () => {
    const normalized = normalizeError({ custom: 'error' }, 'Operation failed');

    expect(normalized).toBeInstanceOf(Error);
    // TYPE-001 fix: normalizeError now JSON.stringify's objects instead of toString()
    expect(normalized.message).toBe('Operation failed: {"custom":"error"}');
  });

  it('should_handle_null_and_undefined', () => {
    const normalized1 = normalizeError(null, 'Null error');
    const normalized2 = normalizeError(undefined, 'Undefined error');

    expect(normalized1.message).toBe('Null error: null');
    expect(normalized2.message).toBe('Undefined error: undefined');
  });

  it('should_preserve_error_stack_trace', () => {
    const error = new Error('Original error');
    const normalized = normalizeError(error, 'Context');

    // Stack trace should exist (though message is updated)
    expect(normalized.stack).toBeDefined();
  });

  it('should_be_used_for_DRY_error_handling', () => {
    // Demonstrates DRY pattern across codebase
    const errors = [
      new Error('DB error'),
      'String error',
      { custom: 'object' }
    ];

    errors.forEach(error => {
      const normalized = normalizeError(error, 'Process failed');
      expect(normalized).toBeInstanceOf(Error);
      expect(normalized.message).toContain('Process failed:');
    });
  });
});

describe('formatExecutionResultForCli', () => {
  it('should_render_success_result_with_sections', () => {
    const formatted = formatExecutionResultForCli({
      success: true,
      output: 'Hello\nWorld',
      executionTimeMs: 1500,
      toolCallsMade: ['mcp__example__tool'],
    });

    expect(formatted).toContain('Status: SUCCESS');
    expect(formatted).toContain('Stdout:');
    expect(formatted).toContain('  Hello');
    expect(formatted).toContain('  World');
    expect(formatted).toContain('Stderr:');
    expect(formatted).toContain('  (none)');
    expect(formatted).toContain('Duration:');
    expect(formatted).toContain('  1.50s');
    expect(formatted).toContain('Tool Calls:');
    expect(formatted).toContain('  - mcp__example__tool');
  });

  it('should_render_failure_with_error_output', () => {
    const formatted = formatExecutionResultForCli({
      success: false,
      output: '',
      error: 'ReferenceError: x is not defined',
      executionTimeMs: 250,
      toolCallsMade: [],
    });

    expect(formatted).toContain('Status: FAILURE');
    expect(formatted).toContain('Stdout:');
    expect(formatted).toContain('  (none)');
    expect(formatted).toContain('Stderr:');
    expect(formatted).toContain('  ReferenceError: x is not defined');
    expect(formatted).toContain('Duration:');
    expect(formatted).toContain('  250ms');
    expect(formatted).toContain('Tool Calls:');
    expect(formatted).toContain('  None');
  });

  it('should_mark_timeouts_with_dedicated_status', () => {
    const formatted = formatExecutionResultForCli({
      success: false,
      output: '',
      error: 'Execution timeout after 30.00s',
      executionTimeMs: 30000,
      toolCallsMade: ['mcp__slow__tool'],
    });

    expect(formatted).toContain('Status: TIMEOUT');
    expect(formatted).toContain('Tool Calls:');
    expect(formatted).toContain('  - mcp__slow__tool');
  });

  it('should_apply_optional_ansi_styling', () => {
    const formatted = formatExecutionResultForCli(
      {
        success: true,
        output: '',
        executionTimeMs: 10,
      },
      { useColor: true }
    );

    expect(formatted).toContain('\u001b[1;32mStatus: SUCCESS\u001b[0m');
    expect(formatted).toContain('\u001b[1mStdout:\u001b[0m');
  });
});
