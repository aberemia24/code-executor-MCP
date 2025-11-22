import { promises as fs } from 'fs';
import * as path from 'path';
import { isAllowedPath } from '../utils.js';

/**
 * File system service for CLI operations with security controls.
 *
 * Provides:
 * - Path canonicalization (symlink resolution)
 * - Permission checks (read/write/execute)
 * - Path traversal prevention
 * - Allowed path validation
 *
 * Security: Uses fs.realpath() to prevent symlink escapes.
 * All paths are validated against allowed roots before operations.
 */
export class FileSystemService {
  /**
   * Canonicalize path (resolve symlinks and relative paths)
   *
   * Uses fs.realpath() to resolve symlinks, preventing symlink escape attacks.
   * For non-existent paths, falls back to path.resolve().
   *
   * @param userPath - Path to canonicalize (can be relative)
   * @returns Absolute canonical path
   */
  async canonicalizePath(userPath: string): Promise<string> {
    try {
      // Try to resolve symlinks using fs.realpath
      return await fs.realpath(userPath);
    } catch (error: unknown) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        // Path doesn't exist - just normalize it
        return path.resolve(userPath);
      }
      throw error;
    }
  }

  /**
   * Check if path is within allowed roots (prevents directory traversal)
   *
   * Validates that canonical path is within one of the allowed root directories.
   * Automatically resolves symlinks before validation.
   *
   * @param userPath - Path to validate
   * @param allowedRoots - List of allowed root directories
   * @returns True if path is allowed, false otherwise
   */
  async isPathAllowed(userPath: string, allowedRoots: string[]): Promise<boolean> {
    return isAllowedPath(userPath, allowedRoots);
  }

  /**
   * Ensure directory exists (create if needed)
   *
   * Creates directory and all parent directories recursively.
   * Safe to call on existing directories (idempotent).
   *
   * @param dirPath - Directory path to create
   */
  async ensureDirectory(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  /**
   * Check file permissions
   *
   * Tests if file/directory is accessible with specified permission.
   * Returns false for non-existent files instead of throwing.
   *
   * @param filePath - File path to check
   * @param mode - Permission mode ('read' | 'write' | 'execute')
   * @returns True if accessible, false otherwise
   */
  async checkPermissions(
    filePath: string,
    mode: 'read' | 'write' | 'execute'
  ): Promise<boolean> {
    try {
      const fsMode = mode === 'read'
        ? fs.constants.R_OK
        : mode === 'write'
        ? fs.constants.W_OK
        : fs.constants.X_OK;

      await fs.access(filePath, fsMode);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate path against security constraints
   *
   * Combines canonicalization and allowed path checking.
   * Throws descriptive error if path is not allowed.
   *
   * @param userPath - Path to validate
   * @param allowedRoots - List of allowed root directories
   * @throws Error if path is outside allowed roots
   * @returns Canonical path (if valid)
   */
  async validatePath(userPath: string, allowedRoots: string[]): Promise<string> {
    const canonicalPath = await this.canonicalizePath(userPath);
    const isAllowed = await this.isPathAllowed(canonicalPath, allowedRoots);

    if (!isAllowed) {
      throw new Error(
        `Path not allowed: ${canonicalPath}\n` +
        `Allowed roots: ${allowedRoots.join(', ')}`
      );
    }

    return canonicalPath;
  }
}
