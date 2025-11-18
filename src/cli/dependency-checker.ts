/**
 * DependencyChecker - Validates runtime dependencies for wrapper generation
 *
 * **RESPONSIBILITY (SRP):** Check Node.js, Python, TypeScript, pip availability and versions
 * **WHY:** Centralized dependency validation provides early feedback before wrapper generation
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { DependencyCheckResult, AllDependenciesResult } from './types.js';

const execPromise = promisify(exec);

/**
 * DependencyChecker - Validate runtime dependencies
 *
 * **DESIGN:** Each check method is independent (parallel execution friendly)
 * **ERROR HANDLING:** Non-blocking warnings (returns availability status, doesn't throw)
 */
export class DependencyChecker {
  private readonly MIN_NODE_VERSION = 22;
  private readonly MIN_PYTHON_VERSION = [3, 9]; // [major, minor]

  /**
   * Check Node.js version
   *
   * **MINIMUM:** Node.js 22.0.0+
   * **COMMAND:** node --version
   * **FORMAT:** v22.0.0 → parsed to 22.0.0
   *
   * @returns Dependency check result with availability and version info
   */
  async checkNodeVersion(): Promise<DependencyCheckResult> {
    try {
      const { stdout } = await execPromise('node --version');
      const versionString = stdout.trim(); // e.g., "v22.0.0"

      // Parse version (remove 'v' prefix)
      const match = versionString.match(/v?(\d+)\.(\d+)\.(\d+)/);
      if (!match) {
        return {
          available: false,
          message: `Could not parse Node.js version from: ${versionString}`,
        };
      }

      // Use direct index access to satisfy TypeScript strict mode
      const major = parseInt(match[1]!, 10);
      const minor = parseInt(match[2]!, 10);
      const patch = parseInt(match[3]!, 10);
      const version = `${major}.${minor}.${patch}`;

      // Check minimum version
      if (major < this.MIN_NODE_VERSION) {
        return {
          available: false,
          version,
          message: `Node.js version ${version} is below minimum ${this.MIN_NODE_VERSION}.0.0. Please upgrade: https://nodejs.org`,
        };
      }

      return {
        available: true,
        version,
        message: `Node.js v${version} detected (meets minimum v${this.MIN_NODE_VERSION}.0.0)`,
      };
    } catch {
      return {
        available: false,
        message: `Node.js not found. Please install Node.js ${this.MIN_NODE_VERSION}+ from https://nodejs.org`,
      };
    }
  }

  /**
   * Check Python version
   *
   * **MINIMUM:** Python 3.9.0+
   * **COMMAND:** python3 --version (or python --version on Windows)
   * **FORMAT:** Python 3.11.0 → parsed to 3.11.0
   *
   * @returns Dependency check result with availability and version info
   */
  async checkPythonVersion(): Promise<DependencyCheckResult> {
    try {
      // Try python3 first (Linux/macOS), fallback to python (Windows)
      let stdout: string;
      try {
        const result = await execPromise('python3 --version');
        stdout = result.stdout;
      } catch {
        const result = await execPromise('python --version');
        stdout = result.stdout;
      }

      const versionString = stdout.trim(); // e.g., "Python 3.11.0"

      // Parse version
      const match = versionString.match(/Python (\d+)\.(\d+)\.(\d+)/);
      if (!match) {
        return {
          available: false,
          message: `Could not parse Python version from: ${versionString}`,
        };
      }

      // Use direct index access to satisfy TypeScript strict mode
      const major = parseInt(match[1]!, 10);
      const minor = parseInt(match[2]!, 10);
      const patch = parseInt(match[3]!, 10);
      const version = `${major}.${minor}.${patch}`;

      // Check minimum version
      const [minMajor, minMinor] = this.MIN_PYTHON_VERSION as [number, number];
      if (major < minMajor || (major === minMajor && minor < minMinor)) {
        return {
          available: false,
          version,
          message: `Python version ${version} is below minimum ${minMajor}.${minMinor}.0. Please upgrade: https://python.org`,
        };
      }

      return {
        available: true,
        version,
        message: `Python ${version} detected (meets minimum ${minMajor}.${minMinor}.0)`,
      };
    } catch {
      return {
        available: false,
        message: `Python not found. Please install Python 3.9+ from https://python.org`,
      };
    }
  }

  /**
   * Check TypeScript compiler availability
   *
   * **COMMAND:** tsc --version
   * **FORMAT:** Version 5.3.3 → parsed to 5.3.3
   * **NOTE:** No minimum version enforced (any tsc version accepted)
   *
   * @returns Dependency check result with availability and version info
   */
  async checkTypeScriptCompiler(): Promise<DependencyCheckResult> {
    try {
      const { stdout } = await execPromise('tsc --version');
      const versionString = stdout.trim(); // e.g., "Version 5.3.3"

      // Parse version
      const match = versionString.match(/Version (\d+)\.(\d+)\.(\d+)/);
      if (!match) {
        // tsc found but version parsing failed - still consider available
        return {
          available: true,
          message: `TypeScript compiler detected (version: ${versionString})`,
        };
      }

      const version = `${match[1]}.${match[2]}.${match[3]}`;

      return {
        available: true,
        version,
        message: `TypeScript compiler ${version} detected`,
      };
    } catch {
      return {
        available: false,
        message: `TypeScript compiler not found. Install with: npm install -g typescript`,
      };
    }
  }

  /**
   * Check pip availability
   *
   * **COMMAND:** pip --version (or pip3 --version)
   * **FORMAT:** pip 23.3.1 from ... → parsed to 23.3.1
   * **NOTE:** No minimum version enforced (any pip version accepted)
   *
   * @returns Dependency check result with availability and version info
   */
  async checkPip(): Promise<DependencyCheckResult> {
    try {
      // Try pip first, fallback to pip3
      let stdout: string;
      try {
        const result = await execPromise('pip --version');
        stdout = result.stdout;
      } catch {
        const result = await execPromise('pip3 --version');
        stdout = result.stdout;
      }

      const versionString = stdout.trim(); // e.g., "pip 23.3.1 from ..."

      // Parse version
      const match = versionString.match(/pip (\d+)\.(\d+)\.(\d+)/);
      if (!match) {
        // pip found but version parsing failed - still consider available
        return {
          available: true,
          message: `pip detected (version: ${versionString.split(' ')[0]})`,
        };
      }

      const version = `${match[1]}.${match[2]}.${match[3]}`;

      return {
        available: true,
        version,
        message: `pip ${version} detected`,
      };
    } catch {
      return {
        available: false,
        message: `pip not found. Install with: python -m ensurepip or https://pip.pypa.io`,
      };
    }
  }

  /**
   * Check all dependencies in parallel
   *
   * **PARALLEL:** Uses Promise.all for concurrent checks (O(1) amortized)
   * **RESILIENT:** Partial failures don't block other checks
   *
   * @returns Object with check results for all dependencies
   */
  async checkAllDependencies(): Promise<AllDependenciesResult> {
    const [node, python, typescript, pip] = await Promise.all([
      this.checkNodeVersion(),
      this.checkPythonVersion(),
      this.checkTypeScriptCompiler(),
      this.checkPip(),
    ]);

    return { node, python, typescript, pip };
  }
}
