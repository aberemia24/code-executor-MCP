/**
 * Security Regression Tests: Allowlist Bypass Attacks
 *
 * P0 Security Issue: Verify allowlist enforcement prevents unauthorized tool execution
 * via attempts to bypass using:
 * - Tools not in allowlist (should be blocked)
 * - Discovery endpoint (should bypass - BY DESIGN per constitution)
 * - Execution endpoint (should enforce allowlist strictly)
 * - Partial tool name matches
 * - Wildcard patterns
 * - String concatenation/encoding
 * - Case variations
 * - Empty/null allowlists
 *
 * Constitutional Exception: Discovery bypasses allowlist (read-only metadata)
 * but execution enforces allowlist (write operation). This is intentional.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AllowlistValidator } from '../../src/proxy-helpers.js';

describe('Allowlist Bypass Attack Protection (P0 Security)', () => {
  describe('Basic Allowlist Enforcement', () => {
    let validator: AllowlistValidator;

    beforeEach(() => {
      validator = new AllowlistValidator([
        'mcp__filesystem__read_file',
        'mcp__zen__codereview',
      ]);
    });

    it('should_allow_toolInAllowlist', () => {
      expect(() => {
        validator.validate('mcp__filesystem__read_file');
      }).not.toThrow();
    });

    it('should_block_toolNotInAllowlist', () => {
      expect(() => {
        validator.validate('mcp__filesystem__write_file');
      }).toThrow(/not in allowlist/);
    });

    it('should_block_nonExistentTool', () => {
      expect(() => {
        validator.validate('mcp__nonexistent__tool');
      }).toThrow(/not in allowlist/);
    });
  });

  describe('Partial Match Bypass Attempts', () => {
    let validator: AllowlistValidator;

    beforeEach(() => {
      validator = new AllowlistValidator([
        'mcp__filesystem__read_file',
      ]);
    });

    it('should_block_partialToolNamePrefix', () => {
      expect(() => {
        validator.validate('mcp__filesystem__read');
      }).toThrow(/not in allowlist/);
    });

    it('should_block_partialToolNameSuffix', () => {
      expect(() => {
        validator.validate('read_file');
      }).toThrow(/not in allowlist/);
    });

    it('should_block_subsetMatch', () => {
      // Attacker tries: if "read_file" is in allowlist, maybe "read" works?
      expect(() => {
        validator.validate('mcp__filesystem__read');
      }).toThrow(/not in allowlist/);
    });

    it('should_block_supersetMatch', () => {
      // Attacker adds extra suffix hoping for partial match
      expect(() => {
        validator.validate('mcp__filesystem__read_file_extra');
      }).toThrow(/not in allowlist/);
    });
  });

  describe('Wildcard Pattern Bypass Attempts', () => {
    let validator: AllowlistValidator;

    beforeEach(() => {
      validator = new AllowlistValidator([
        'mcp__filesystem__read_file',
      ]);
    });

    it('should_block_wildcardInToolName', () => {
      // Attacker tries wildcard patterns
      expect(() => {
        validator.validate('mcp__filesystem__*');
      }).toThrow(/not in allowlist/);
    });

    it('should_block_regexPatternAttempt', () => {
      // Attacker tries regex patterns
      expect(() => {
        validator.validate('mcp__filesystem__.*');
      }).toThrow(/not in allowlist/);
    });

    it('should_block_questionMarkWildcard', () => {
      expect(() => {
        validator.validate('mcp__filesystem__read_fil?');
      }).toThrow(/not in allowlist/);
    });

    it('should_block_starStarGlobPattern', () => {
      expect(() => {
        validator.validate('mcp__**__read_file');
      }).toThrow(/not in allowlist/);
    });
  });

  describe('Case Sensitivity Bypass Attempts', () => {
    let validator: AllowlistValidator;

    beforeEach(() => {
      validator = new AllowlistValidator([
        'mcp__filesystem__read_file',
      ]);
    });

    it('should_block_uppercaseVariation', () => {
      expect(() => {
        validator.validate('MCP__FILESYSTEM__READ_FILE');
      }).toThrow(/not in allowlist/);
    });

    it('should_block_mixedCaseVariation', () => {
      expect(() => {
        validator.validate('mcp__FileSystem__Read_File');
      }).toThrow(/not in allowlist/);
    });

    it('should_block_camelCaseVariation', () => {
      expect(() => {
        validator.validate('mcp__filesystem__readFile');
      }).toThrow(/not in allowlist/);
    });
  });

  describe('String Encoding Bypass Attempts', () => {
    let validator: AllowlistValidator;

    beforeEach(() => {
      validator = new AllowlistValidator([
        'mcp__filesystem__read_file',
      ]);
    });

    it('should_block_urlEncodedToolName', () => {
      // URL encoding: _ becomes %5F
      expect(() => {
        validator.validate('mcp%5F%5Ffilesystem%5F%5Fread%5Ffile');
      }).toThrow(/not in allowlist/);
    });

    it('should_block_base64EncodedToolName', () => {
      // Base64 encoding
      const encoded = Buffer.from('mcp__filesystem__read_file').toString('base64');
      expect(() => {
        validator.validate(encoded);
      }).toThrow(/not in allowlist/);
    });

    it('should_block_unicodeEscapeSequence', () => {
      // Unicode escape: mcp\u005f\u005ffilesystem...
      expect(() => {
        validator.validate('mcp\\u005f\\u005ffilesystem\\u005f\\u005fread\\u005ffile');
      }).toThrow(/not in allowlist/);
    });

    it('should_block_hexEncodedCharacters', () => {
      // Hex encoding: m = \x6d, c = \x63, p = \x70
      expect(() => {
        validator.validate('\\x6d\\x63\\x70__filesystem__read_file');
      }).toThrow(/not in allowlist/);
    });
  });

  describe('Null/Empty Bypass Attempts', () => {
    let validator: AllowlistValidator;

    beforeEach(() => {
      validator = new AllowlistValidator([
        'mcp__filesystem__read_file',
      ]);
    });

    it('should_block_emptyString', () => {
      expect(() => {
        validator.validate('');
      }).toThrow(/not in allowlist/);
    });

    it('should_block_whitespaceOnly', () => {
      expect(() => {
        validator.validate('   ');
      }).toThrow(/not in allowlist/);
    });

    it('should_block_nullCharacterInjection', () => {
      // Null character injection (NUL byte)
      expect(() => {
        validator.validate('mcp__filesystem__read_file\0');
      }).toThrow(/not in allowlist/);
    });

    it('should_block_newlineInjection', () => {
      expect(() => {
        validator.validate('mcp__filesystem__read_file\n');
      }).toThrow(/not in allowlist/);
    });
  });

  describe('Empty Allowlist Edge Cases', () => {
    let validator: AllowlistValidator;

    beforeEach(() => {
      validator = new AllowlistValidator([]);
    });

    it('should_block_anyToolWhenAllowlistEmpty', () => {
      expect(() => {
        validator.validate('mcp__filesystem__read_file');
      }).toThrow(/not in allowlist/);
    });

    it('should_block_emptyStringWithEmptyAllowlist', () => {
      expect(() => {
        validator.validate('');
      }).toThrow(/not in allowlist/);
    });
  });

  describe('Allowlist with Wildcards (If Supported)', () => {
    // NOTE: Current implementation does NOT support wildcards in allowlist
    // These tests verify that wildcard patterns in allowlist are treated literally

    it('should_treatWildcardLiterally_inAllowlist', () => {
      const validator = new AllowlistValidator(['mcp__filesystem__*']);

      // Only exact match works (literal "*")
      expect(() => {
        validator.validate('mcp__filesystem__*');
      }).not.toThrow();

      // Wildcard does NOT expand to match other tools
      expect(() => {
        validator.validate('mcp__filesystem__read_file');
      }).toThrow(/not in allowlist/);
    });

    it('should_treatRegexPatternLiterally_inAllowlist', () => {
      const validator = new AllowlistValidator(['mcp__filesystem__.*']);

      // Only exact match works (literal ".*")
      expect(() => {
        validator.validate('mcp__filesystem__.*');
      }).not.toThrow();

      // Regex does NOT expand
      expect(() => {
        validator.validate('mcp__filesystem__read_file');
      }).toThrow(/not in allowlist/);
    });
  });

  describe('Non-Throwing Validation (isAllowed)', () => {
    let validator: AllowlistValidator;

    beforeEach(() => {
      validator = new AllowlistValidator([
        'mcp__filesystem__read_file',
      ]);
    });

    it('should_returnTrue_whenToolInAllowlist', () => {
      expect(validator.isAllowed('mcp__filesystem__read_file')).toBe(true);
    });

    it('should_returnFalse_whenToolNotInAllowlist', () => {
      expect(validator.isAllowed('mcp__filesystem__write_file')).toBe(false);
    });

    it('should_returnFalse_forPartialMatch', () => {
      expect(validator.isAllowed('mcp__filesystem__read')).toBe(false);
    });

    it('should_returnFalse_forWildcard', () => {
      expect(validator.isAllowed('mcp__filesystem__*')).toBe(false);
    });
  });

  describe('Get Allowlist Immutability', () => {
    it('should_returnCopyOfAllowlist', () => {
      const original = ['mcp__filesystem__read_file'];
      const validator = new AllowlistValidator(original);

      const returned = validator.getAllowedTools();

      // Modify returned array
      returned.push('mcp__filesystem__write_file');

      // Original allowlist should be unchanged
      expect(() => {
        validator.validate('mcp__filesystem__write_file');
      }).toThrow(/not in allowlist/);
    });
  });

  describe('Real-World Attack Scenarios', () => {
    let validator: AllowlistValidator;

    beforeEach(() => {
      validator = new AllowlistValidator([
        'mcp__filesystem__read_file',
        'mcp__zen__codereview',
      ]);
    });

    it('should_block_attemptToExecuteShellCommand', () => {
      // Attacker tries to execute shell command via non-existent tool
      expect(() => {
        validator.validate('mcp__shell__exec');
      }).toThrow(/not in allowlist/);
    });

    it('should_block_attemptToAccessDatabase', () => {
      // Attacker tries to access database via non-allowed tool
      expect(() => {
        validator.validate('mcp__database__query');
      }).toThrow(/not in allowlist/);
    });

    it('should_block_attemptToCallAdminTool', () => {
      // Attacker tries to call admin/privileged tool
      expect(() => {
        validator.validate('mcp__admin__delete_user');
      }).toThrow(/not in allowlist/);
    });

    it('should_block_attemptToBypassViaToolChaining', () => {
      // Attacker tries to chain tools (not supported)
      expect(() => {
        validator.validate('mcp__filesystem__read_file|mcp__shell__exec');
      }).toThrow(/not in allowlist/);
    });
  });

  describe('Constitutional Exception: Discovery Bypass (By Design)', () => {
    // These tests document that discovery BYPASSES allowlist (intentional)
    // while execution ENFORCES allowlist

    it('should_document_discoveryBypassesAllowlist', () => {
      // Discovery endpoint returns ALL tools, regardless of allowlist
      // This is intentional per spec.md Section 2 (Constitutional Exceptions)
      // and architecture.md Section 4.2 (Security Trade-Off)

      const validator = new AllowlistValidator([
        'mcp__filesystem__read_file',
      ]);

      // Execution enforces allowlist
      expect(() => {
        validator.validate('mcp__filesystem__write_file');
      }).toThrow(/not in allowlist/);

      // Discovery would return this tool (not tested here, documented intent)
      // Security model: discovery = read (metadata), execution = write (action)
    });

    it('should_document_executionEnforcesAllowlist', () => {
      // Execution ALWAYS enforces allowlist (two-tier security)
      const validator = new AllowlistValidator([
        'mcp__filesystem__read_file',
      ]);

      // Even if tool discovered, execution requires allowlist
      expect(() => {
        validator.validate('mcp__zen__codereview');
      }).toThrow(/not in allowlist/);
    });
  });
});
