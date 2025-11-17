/**
 * Error Type Guard Tests (TYPE-001)
 *
 * Tests for runtime type guards that replace unsafe error casts.
 *
 * @see https://github.com/aberemia24/code-executor-MCP/issues/43
 */

import { describe, it, expect } from 'vitest';
import { isError, isErrnoException, normalizeError } from '../src/utils.js';

describe('Error Type Guards (TYPE-001)', () => {
  describe('isError()', () => {
    it('should_returnTrue_when_ErrorInstance', () => {
      const err = new Error('test error');
      expect(isError(err)).toBe(true);
    });

    it('should_returnTrue_when_CustomErrorSubclass', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }
      const err = new CustomError('custom');
      expect(isError(err)).toBe(true);
    });

    it('should_returnFalse_when_string', () => {
      expect(isError('error string')).toBe(false);
    });

    it('should_returnFalse_when_number', () => {
      expect(isError(42)).toBe(false);
    });

    it('should_returnFalse_when_plainObject', () => {
      expect(isError({ message: 'error' })).toBe(false);
    });

    it('should_returnFalse_when_null', () => {
      expect(isError(null)).toBe(false);
    });

    it('should_returnFalse_when_undefined', () => {
      expect(isError(undefined)).toBe(false);
    });

    it('should_returnFalse_when_array', () => {
      expect(isError([1, 2, 3])).toBe(false);
    });
  });

  describe('isErrnoException()', () => {
    it('should_returnTrue_when_validErrnoException', () => {
      const err = {
        code: 'ENOENT',
        errno: -2,
        syscall: 'open',
        path: '/nonexistent',
        message: 'File not found',
      };
      expect(isErrnoException(err)).toBe(true);
    });

    it('should_returnTrue_when_minimalErrnoException', () => {
      // Only 'code' is required
      const err = { code: 'ENOENT' };
      expect(isErrnoException(err)).toBe(true);
    });

    it('should_returnFalse_when_codeIsNumber', () => {
      const err = { code: 404 };
      expect(isErrnoException(err)).toBe(false);
    });

    it('should_returnFalse_when_noCodeProperty', () => {
      const err = { message: 'error' };
      expect(isErrnoException(err)).toBe(false);
    });

    it('should_returnFalse_when_null', () => {
      expect(isErrnoException(null)).toBe(false);
    });

    it('should_returnFalse_when_string', () => {
      expect(isErrnoException('ENOENT')).toBe(false);
    });

    it('should_returnFalse_when_ErrorInstance', () => {
      const err = new Error('ENOENT');
      expect(isErrnoException(err)).toBe(false);
    });

    it('should_returnTrue_when_ErrorWithCodeProperty', () => {
      const err = new Error('File not found');
      (err as NodeJS.ErrnoException).code = 'ENOENT';
      expect(isErrnoException(err)).toBe(true);
    });
  });

  describe('normalizeError()', () => {
    it('should_returnSameError_when_ErrorInstance', () => {
      const original = new Error('test error');
      const normalized = normalizeError(original);
      expect(normalized).toBe(original); // Same instance
      expect(normalized.message).toBe('test error');
    });

    it('should_wrapString_in_Error', () => {
      const normalized = normalizeError('error string');
      expect(normalized).toBeInstanceOf(Error);
      expect(normalized.message).toBe('error string');
    });

    it('should_serializeObject_to_Error', () => {
      const obj = { code: 'ENOENT', message: 'Not found' };
      const normalized = normalizeError(obj);
      expect(normalized).toBeInstanceOf(Error);
      expect(normalized.message).toBe(JSON.stringify(obj));
    });

    it('should_convertNumber_to_Error', () => {
      const normalized = normalizeError(42);
      expect(normalized).toBeInstanceOf(Error);
      expect(normalized.message).toBe('42');
    });

    it('should_convertNull_to_Error', () => {
      const normalized = normalizeError(null);
      expect(normalized).toBeInstanceOf(Error);
      expect(normalized.message).toBe('null');
    });

    it('should_convertUndefined_to_Error', () => {
      const normalized = normalizeError(undefined);
      expect(normalized).toBeInstanceOf(Error);
      expect(normalized.message).toBe('undefined');
    });

    it('should_handleCircularReferences_gracefully', () => {
      const circular: { self?: unknown } = {};
      circular.self = circular;

      const normalized = normalizeError(circular);
      expect(normalized).toBeInstanceOf(Error);
      // Should not throw, message will contain circular reference indicator
      expect(normalized.message).toBeTruthy();
    });

    it('should_preserveStackTrace_when_ErrorInstance', () => {
      const original = new Error('test');
      const normalized = normalizeError(original);
      expect(normalized.stack).toBe(original.stack);
    });

    it('should_createStackTrace_when_newError', () => {
      const normalized = normalizeError('string error');
      expect(normalized.stack).toBeTruthy();
      expect(normalized.stack).toContain('Error: string error');
    });
  });

  describe('Integration Patterns', () => {
    it('should_handleFileSystemErrors_safely', () => {
      // Simulate fs.readFile error
      const fsError = {
        code: 'ENOENT',
        errno: -2,
        syscall: 'open',
        path: '/nonexistent/file.txt',
      };

      // Pattern: Check if ENOENT, otherwise throw normalized error
      if (isErrnoException(fsError) && fsError.code === 'ENOENT') {
        // Handle missing file gracefully
        expect(fsError.code).toBe('ENOENT');
      } else {
        throw normalizeError(fsError);
      }
    });

    it('should_handleUnknownErrors_safely', () => {
      const unknownError = 'Something went wrong';

      // Pattern: Normalize unknown errors
      const normalized = normalizeError(unknownError);
      expect(normalized).toBeInstanceOf(Error);
      expect(normalized.message).toBe('Something went wrong');
    });

    it('should_chainTypeGuards_for_robustness', () => {
      const testError = (err: unknown) => {
        if (isErrnoException(err) && err.code === 'ENOENT') {
          return 'file-not-found';
        }
        if (isError(err)) {
          return err.message;
        }
        return normalizeError(err).message;
      };

      expect(testError({ code: 'ENOENT' })).toBe('file-not-found');
      expect(testError(new Error('test'))).toBe('test');
      expect(testError('string')).toBe('string');
    });
  });
});
