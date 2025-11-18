/**
 * DependencyChecker Tests
 *
 * **TDD PHASE:** RED (Failing Tests) → GREEN (Implementation)
 * **COVERAGE TARGET:** 90%+
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create mock function using vi.hoisted to ensure it's available before module loads
const { mockExecPromise } = vi.hoisted(() => {
  return {
    mockExecPromise: vi.fn(),
  };
});

// Mock the modules before importing DependencyChecker
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: () => mockExecPromise,
}));

// Now import DependencyChecker after mocks are set up
import { DependencyChecker } from '../../src/cli/dependency-checker.js';

describe('DependencyChecker', () => {
  let checker: DependencyChecker;

  beforeEach(() => {
    checker = new DependencyChecker();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkNodeVersion', () => {
    it('should_returnAvailable_when_nodeVersionValid', async () => {
      // Mock node --version returning v22.0.0
      mockExecPromise.mockResolvedValue({ stdout: 'v22.0.0\n', stderr: '' });

      const result = await checker.checkNodeVersion();

      expect(result.available).toBe(true);
      expect(result.version).toBe('22.0.0');
      expect(result.message).toContain('Node.js v22.0.0');
    });

    it('should_returnAvailable_when_nodeVersionAboveMinimum', async () => {
      // Mock node --version returning v23.1.0
      mockExecPromise.mockResolvedValue({ stdout: 'v23.1.0\n', stderr: '' });

      const result = await checker.checkNodeVersion();

      expect(result.available).toBe(true);
      expect(result.version).toBe('23.1.0');
    });

    it('should_returnUnavailable_when_nodeVersionTooOld', async () => {
      // Mock node --version returning v20.0.0 (< 22)
      mockExecPromise.mockResolvedValue({ stdout: 'v20.0.0\n', stderr: '' });

      const result = await checker.checkNodeVersion();

      expect(result.available).toBe(false);
      expect(result.version).toBe('20.0.0');
      expect(result.message).toContain('Node.js version 20.0.0 is below minimum 22.0.0');
    });

    it('should_returnUnavailable_when_nodeNotInstalled', async () => {
      // Mock node command not found
      mockExecPromise.mockRejectedValue(new Error('command not found: node'));

      const result = await checker.checkNodeVersion();

      expect(result.available).toBe(false);
      expect(result.version).toBeUndefined();
      expect(result.message).toContain('Node.js not found');
    });

    it('should_handleInvalidVersionFormat_when_parsingFails', async () => {
      // Mock invalid version string
      mockExecPromise.mockResolvedValue({ stdout: 'invalid-version\n', stderr: '' });

      const result = await checker.checkNodeVersion();

      expect(result.available).toBe(false);
      expect(result.message).toContain('Could not parse');
    });
  });

  describe('checkPythonVersion', () => {
    it('should_returnAvailable_when_pythonVersionValid', async () => {
      // Mock python3 --version returning Python 3.11.0
      mockExecPromise.mockResolvedValue({ stdout: 'Python 3.11.0\n', stderr: '' });

      const result = await checker.checkPythonVersion();

      expect(result.available).toBe(true);
      expect(result.version).toBe('3.11.0');
      expect(result.message).toContain('Python 3.11.0');
    });

    it('should_returnAvailable_when_pythonVersionAtMinimum', async () => {
      // Mock python3 --version returning Python 3.9.0 (minimum)
      mockExecPromise.mockResolvedValue({ stdout: 'Python 3.9.0\n', stderr: '' });

      const result = await checker.checkPythonVersion();

      expect(result.available).toBe(true);
      expect(result.version).toBe('3.9.0');
    });

    it('should_returnUnavailable_when_pythonVersionTooOld', async () => {
      // Mock python3 --version returning Python 3.8.0 (< 3.9)
      mockExecPromise.mockResolvedValue({ stdout: 'Python 3.8.0\n', stderr: '' });

      const result = await checker.checkPythonVersion();

      expect(result.available).toBe(false);
      expect(result.version).toBe('3.8.0');
      expect(result.message).toContain('Python version 3.8.0 is below minimum 3.9.0');
    });

    it('should_returnUnavailable_when_pythonNotInstalled', async () => {
      // Mock python3 and python commands both fail
      mockExecPromise.mockRejectedValue(new Error('command not found'));

      const result = await checker.checkPythonVersion();

      expect(result.available).toBe(false);
      expect(result.version).toBeUndefined();
      expect(result.message).toContain('Python not found');
    });

    it('should_usePythonFallback_when_python3NotFound', async () => {
      // Mock python3 fails, python succeeds (Windows scenario)
      mockExecPromise
        .mockRejectedValueOnce(new Error('python3: command not found')) // First call fails
        .mockResolvedValueOnce({ stdout: 'Python 3.11.0\n', stderr: '' }); // Fallback succeeds

      const result = await checker.checkPythonVersion();

      expect(result.available).toBe(true);
      expect(result.version).toBe('3.11.0');
      expect(mockExecPromise).toHaveBeenCalledTimes(2); // Both commands tried
    });
  });

  describe('checkTypeScriptCompiler', () => {
    it('should_returnAvailable_when_tscInstalled', async () => {
      // Mock tsc --version returning Version 5.3.3
      mockExecPromise.mockResolvedValue({ stdout: 'Version 5.3.3\n', stderr: '' });

      const result = await checker.checkTypeScriptCompiler();

      expect(result.available).toBe(true);
      expect(result.version).toBe('5.3.3');
      expect(result.message).toContain('TypeScript compiler 5.3.3');
    });

    it('should_returnUnavailable_when_tscNotInstalled', async () => {
      // Mock tsc command not found
      mockExecPromise.mockRejectedValue(new Error('command not found: tsc'));

      const result = await checker.checkTypeScriptCompiler();

      expect(result.available).toBe(false);
      expect(result.version).toBeUndefined();
      expect(result.message).toContain('TypeScript compiler not found');
    });
  });

  describe('checkPip', () => {
    it('should_returnAvailable_when_pipInstalled', async () => {
      // Mock pip --version returning pip 23.3.1
      mockExecPromise.mockResolvedValue({
        stdout: 'pip 23.3.1 from /usr/local/lib/python3.11/site-packages/pip (python 3.11)\n',
        stderr: ''
      });

      const result = await checker.checkPip();

      expect(result.available).toBe(true);
      expect(result.version).toBe('23.3.1');
      expect(result.message).toContain('pip 23.3.1');
    });

    it('should_returnUnavailable_when_pipNotInstalled', async () => {
      // Mock pip command not found
      mockExecPromise.mockRejectedValue(new Error('command not found: pip'));

      const result = await checker.checkPip();

      expect(result.available).toBe(false);
      expect(result.version).toBeUndefined();
      expect(result.message).toContain('pip not found');
    });

    it('should_usePip3Fallback_when_pipNotFound', async () => {
      // Mock pip fails, pip3 succeeds (Linux/macOS scenario)
      mockExecPromise
        .mockRejectedValueOnce(new Error('pip: command not found')) // First call fails
        .mockResolvedValueOnce({ stdout: 'pip 23.3.1 from /usr/local/lib\n', stderr: '' }); // Fallback succeeds

      const result = await checker.checkPip();

      expect(result.available).toBe(true);
      expect(result.version).toBe('23.3.1');
      expect(mockExecPromise).toHaveBeenCalledTimes(2); // Both commands tried
    });
  });

  describe('checkAllDependencies', () => {
    it('should_returnAllAvailable_when_allDependenciesInstalled', async () => {
      // Mock all commands returning valid versions
      mockExecPromise
        .mockResolvedValueOnce({ stdout: 'v22.0.0\n', stderr: '' }) // node
        .mockResolvedValueOnce({ stdout: 'Python 3.11.0\n', stderr: '' }) // python3
        .mockResolvedValueOnce({ stdout: 'Version 5.3.3\n', stderr: '' }) // tsc
        .mockResolvedValueOnce({ stdout: 'pip 23.3.1 from /usr/local/lib\n', stderr: '' }); // pip

      const result = await checker.checkAllDependencies();

      expect(result.node.available).toBe(true);
      expect(result.python.available).toBe(true);
      expect(result.typescript.available).toBe(true);
      expect(result.pip.available).toBe(true);
    });

    it('should_returnMixedResults_when_someDependenciesMissing', async () => {
      // Mock Node.js and TypeScript available, Python and pip missing
      mockExecPromise
        .mockResolvedValueOnce({ stdout: 'v22.0.0\n', stderr: '' }) // node
        .mockRejectedValueOnce(new Error('command not found')) // python3
        .mockResolvedValueOnce({ stdout: 'Version 5.3.3\n', stderr: '' }) // tsc
        .mockRejectedValueOnce(new Error('command not found')); // pip

      const result = await checker.checkAllDependencies();

      expect(result.node.available).toBe(true);
      expect(result.python.available).toBe(false);
      expect(result.typescript.available).toBe(true);
      expect(result.pip.available).toBe(false);
    });
  });
});
