/**
 * Security Regression Tests: Dangerous Pattern Validation Bypass Attacks
 *
 * P0 Security Issue: Verify dangerous pattern detection blocks attempts to bypass
 * validation using various encoding and obfuscation techniques.
 *
 * NOTE: Pattern validation is defense-in-depth, NOT a security boundary.
 * Real security comes from Deno sandbox permissions and process isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SecurityValidator } from '../../src/validation/security-validator.js';

describe('Dangerous Pattern Validation Bypass Attacks (P0 Security)', () => {
  let validator: SecurityValidator;

  beforeEach(() => {
    validator = new SecurityValidator();
  });

  // Helper function to check if code is blocked
  function expectBlocked(code: string) {
    const result = validator.validateCode(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('dangerous pattern'))).toBe(true);
  }

  // Helper function to check if code is allowed
  function expectAllowed(code: string) {
    const result = validator.validateCode(code);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  }

  describe('JavaScript eval() Bypass Attempts', () => {
    it('should_block_directEvalCall', () => {
      expectBlocked('eval("console.log(1)")');
    });

    it('should_block_evalWithWhitespace', () => {
      expectBlocked('eval   ("code")');
    });

    it('should_block_evalWithNewlines', () => {
      expectBlocked('eval\n("code")');
    });

    it('should_block_globalThisBracketEval', () => {
      expectBlocked('globalThis["eval"]("code")');
    });

    it('should_block_globalThisSingleQuoteEval', () => {
      expectBlocked("globalThis['eval']('code')");
    });

    it('should_block_caseInsensitiveEval', () => {
      expectBlocked('EVAL("code")');
    });

    it('should_block_mixedCaseEval', () => {
      expectBlocked('EvAl("code")');
    });
  });

  describe('JavaScript Function Constructor Bypass Attempts', () => {
    it('should_block_functionConstructor', () => {
      expectBlocked('Function("return 1")()');
    });

    it('should_block_newFunction', () => {
      expectBlocked('new Function("return 1")()');
    });

    it('should_block_constructorConstructor', () => {
      expectBlocked('const a = {}; a.constructor.constructor("code")()');
    });
  });

  describe('JavaScript Dynamic Import Bypass Attempts', () => {
    it('should_block_requireCall', () => {
      expectBlocked('require("child_process")');
    });

    it('should_block_dynamicImport', () => {
      expectBlocked('import("fs")');
    });

    it('should_block_childProcessImport', () => {
      expectBlocked('import { exec } from "child_process"');
    });

    it('should_block_nodeChildProcessImport', () => {
      expectBlocked('import { spawn } from "node:child_process"');
    });
  });

  describe('Deno-Specific Bypass Attempts', () => {
    it('should_block_denoRun', () => {
      expectBlocked('Deno.run({ cmd: ["ls"] })');
    });

    it('should_block_denoCommand', () => {
      expectBlocked('new Deno.Command("ls")');
    });

    it('should_block_caseInsensitiveDeno', () => {
      expectBlocked('DENO.RUN({ cmd: ["ls"] })');
    });
  });

  describe('JavaScript exec/spawn Bypass Attempts', () => {
    it('should_block_exec', () => {
      expectBlocked('exec("ls")');
    });

    it('should_block_execSync', () => {
      expectBlocked('execSync("ls")');
    });

    it('should_block_execFile', () => {
      expectBlocked('execFile("ls", ["-la"])');
    });
  });

  describe('JavaScript Timer Bypass Attempts', () => {
    it('should_block_setTimeoutWithString', () => {
      expectBlocked('setTimeout("eval(1)", 1000)');
    });

    it('should_block_setIntervalWithString', () => {
      expectBlocked('setInterval("eval(1)", 1000)');
    });

    it('should_block_setTimeoutWithBackticks', () => {
      expectBlocked('setTimeout(`eval(1)`, 1000)');
    });
  });

  describe('Python __import__ Bypass Attempts', () => {
    it('should_block_pythonImport', () => {
      expectBlocked('__import__("os")');
    });

    it('should_block_caseInsensitivePythonImport', () => {
      expectBlocked('__IMPORT__("os")');
    });
  });

  describe('Python exec/compile Bypass Attempts', () => {
    it('should_block_pythonExec', () => {
      expectBlocked('exec("print(1)")');
    });

    it('should_block_pythonCompile', () => {
      expectBlocked('compile("print(1)", "<string>", "exec")');
    });
  });

  describe('Python pickle/subprocess Bypass Attempts', () => {
    it('should_block_pickleLoads', () => {
      expectBlocked('pickle.loads(data)');
    });

    it('should_block_osSystem', () => {
      expectBlocked('os.system("ls")');
    });

    it('should_block_subprocessRun', () => {
      expectBlocked('subprocess.run(["ls"])');
    });

    it('should_block_subprocessCall', () => {
      expectBlocked('subprocess.call(["ls"])');
    });

    it('should_block_subprocessPopen', () => {
      expectBlocked('subprocess.Popen(["ls"])');
    });

    it('should_block_subprocessCheckOutput', () => {
      expectBlocked('subprocess.check_output(["ls"])');
    });
  });

  describe('Python File System Bypass Attempts', () => {
    it('should_block_pythonOpenWrite', () => {
      expectBlocked('open("file.txt", "w")');
    });

    it('should_block_pythonOpenWritePlus', () => {
      expectBlocked('open("file.txt", "w+")');
    });
  });

  describe('Python Scope Access Bypass Attempts', () => {
    it('should_block_pythonGlobals', () => {
      expectBlocked('globals()["__builtins__"]');
    });

    it('should_block_pythonLocals', () => {
      expectBlocked('locals()["secret"]');
    });

    it('should_block_pythonBuiltins', () => {
      expectBlocked('__builtins__["eval"]');
    });
  });

  describe('Legitimate Code (Sanity Check)', () => {
    it('should_allow_safeConsoleLog', () => {
      expectAllowed('console.log("hello")');
    });

    it('should_allow_safeArithmetic', () => {
      expectAllowed('const result = 2 + 2');
    });

    it('should_allow_safeFunctionDefinition', () => {
      expectAllowed('function add(a, b) { return a + b; }');
    });

    it('should_allow_safeArrayOperations', () => {
      expectAllowed('const arr = [1, 2, 3]; arr.map(x => x * 2)');
    });

    it('should_allow_safeObjectOperations', () => {
      expectAllowed('const obj = { a: 1, b: 2 }; Object.keys(obj)');
    });

    it('should_allow_normalSetTimeout', () => {
      // setTimeout with function (not string) is safe
      expectAllowed('setTimeout(() => console.log("hi"), 1000)');
    });

    it('should_allow_wordEvalInComment', () => {
      // Word "eval" in comment is safe
      expectAllowed('// This function does not use eval\nconst x = 1');
    });

    it('should_allow_wordEvalInString', () => {
      // Word "eval" in string literal is safe (not a function call)
      expectAllowed('const msg = "Do not use eval"');
    });
  });

  describe('Pattern Validation Configuration', () => {
    it('should_skip_validation_when_flagSet', () => {
      // Test skip flag (for performance when validation not needed)
      const code = 'eval("dangerous")';
      const result = validator.validateCode(code, true);

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });
  });
});
