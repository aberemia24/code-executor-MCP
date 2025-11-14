/**
 * Security Regression Tests: Symlink Traversal Attacks
 *
 * P0 Security Issue: Verify path validation properly resolves symlinks
 * and blocks attempts to escape allowed paths via:
 * - Symlinks to parent directories (../, ../../, etc.)
 * - Symlinks to absolute paths outside allowed roots
 * - Symlinks to sensitive system files (/etc/passwd, /etc/shadow)
 * - Double/nested symlinks (symlink → symlink → target)
 * - Symlink loops (symlink → symlink → symlink → ...)
 * - Relative symlinks that resolve outside allowed paths
 *
 * These tests verify the complete symlink resolution flow using realpath().
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isAllowedPath } from '../../src/utils.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('Symlink Traversal Attack Protection (P0 Security)', () => {
  let testDir: string;
  let allowedDir: string;
  let forbiddenDir: string;
  let sensitiveFile: string;

  beforeAll(async () => {
    // Create test directory structure
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'symlink-test-'));
    allowedDir = path.join(testDir, 'allowed');
    forbiddenDir = path.join(testDir, 'forbidden');

    await fs.mkdir(allowedDir, { recursive: true });
    await fs.mkdir(forbiddenDir, { recursive: true });

    // Create a sensitive file to simulate /etc/passwd
    sensitiveFile = path.join(forbiddenDir, 'sensitive.txt');
    await fs.writeFile(sensitiveFile, 'sensitive data', 'utf-8');

    // Create a safe file in allowed directory
    await fs.writeFile(
      path.join(allowedDir, 'safe.txt'),
      'safe data',
      'utf-8'
    );
  });

  afterAll(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Parent Directory Traversal via Symlinks', () => {
    it('should_block_symlinkToParentDirectory', async () => {
      // Create symlink: allowed/escape -> ../forbidden
      const symlinkPath = path.join(allowedDir, 'escape');
      await fs.symlink('../forbidden', symlinkPath);

      const allowed = await isAllowedPath(symlinkPath, [allowedDir]);

      expect(allowed).toBe(false);

      // Cleanup
      await fs.unlink(symlinkPath);
    });

    it('should_block_symlinkToGrandparentDirectory', async () => {
      // Create symlink: allowed/escape -> ../../
      const symlinkPath = path.join(allowedDir, 'escape2');
      await fs.symlink('../../', symlinkPath);

      const allowed = await isAllowedPath(symlinkPath, [allowedDir]);

      expect(allowed).toBe(false);

      // Cleanup
      await fs.unlink(symlinkPath);
    });

    it('should_block_multipleParentTraversal', async () => {
      // Create symlink: allowed/escape -> ../../../../../../../etc
      const symlinkPath = path.join(allowedDir, 'deep-escape');
      await fs.symlink('../../../../../../../etc', symlinkPath);

      const allowed = await isAllowedPath(symlinkPath, [allowedDir]);

      expect(allowed).toBe(false);

      // Cleanup
      await fs.unlink(symlinkPath);
    });
  });

  describe('Absolute Path Symlink Attacks', () => {
    it('should_block_symlinkToAbsolutePathOutsideRoot', async () => {
      // Create symlink: allowed/escape -> /tmp/forbidden
      const symlinkPath = path.join(allowedDir, 'abs-escape');
      await fs.symlink(forbiddenDir, symlinkPath);

      const allowed = await isAllowedPath(symlinkPath, [allowedDir]);

      expect(allowed).toBe(false);

      // Cleanup
      await fs.unlink(symlinkPath);
    });

    it('should_block_symlinkToSystemFile', async () => {
      // Create symlink: allowed/passwd -> /etc/passwd (if exists)
      const symlinkPath = path.join(allowedDir, 'passwd');

      // Use our test sensitive file as proxy for /etc/passwd
      await fs.symlink(sensitiveFile, symlinkPath);

      const allowed = await isAllowedPath(symlinkPath, [allowedDir]);

      expect(allowed).toBe(false);

      // Cleanup
      await fs.unlink(symlinkPath);
    });

    it('should_block_symlinkToTmpDirectory', async () => {
      // Create symlink: allowed/tmp -> /tmp
      const symlinkPath = path.join(allowedDir, 'tmp');
      await fs.symlink('/tmp', symlinkPath);

      const allowed = await isAllowedPath(symlinkPath, [allowedDir]);

      expect(allowed).toBe(false);

      // Cleanup
      await fs.unlink(symlinkPath);
    });
  });

  describe('Nested Symlink Attacks (Double/Triple Indirection)', () => {
    it('should_block_doubleSymlinkTraversal', async () => {
      // Create chain: allowed/link1 -> link2 -> ../forbidden
      const link2 = path.join(allowedDir, 'link2');
      const link1 = path.join(allowedDir, 'link1');

      await fs.symlink('../forbidden', link2);
      await fs.symlink('link2', link1);

      const allowed = await isAllowedPath(link1, [allowedDir]);

      expect(allowed).toBe(false);

      // Cleanup
      await fs.unlink(link1);
      await fs.unlink(link2);
    });

    it('should_block_tripleSymlinkTraversal', async () => {
      // Create chain: allowed/link1 -> link2 -> link3 -> ../forbidden
      const link3 = path.join(allowedDir, 'link3');
      const link2 = path.join(allowedDir, 'link2');
      const link1 = path.join(allowedDir, 'link1');

      await fs.symlink('../forbidden', link3);
      await fs.symlink('link3', link2);
      await fs.symlink('link2', link1);

      const allowed = await isAllowedPath(link1, [allowedDir]);

      expect(allowed).toBe(false);

      // Cleanup
      await fs.unlink(link1);
      await fs.unlink(link2);
      await fs.unlink(link3);
    });
  });

  describe('Symlink Loop Detection', () => {
    it('should_handle_symlinkLoop_gracefully', async () => {
      // Create loop: allowed/link1 -> link2, link2 -> link1
      const link1 = path.join(allowedDir, 'loop1');
      const link2 = path.join(allowedDir, 'loop2');

      await fs.symlink('loop2', link1);
      await fs.symlink('loop1', link2);

      // realpath() should detect loop and throw ELOOP error
      // isAllowedPath should catch this and return false
      const allowed = await isAllowedPath(link1, [allowedDir]);

      expect(allowed).toBe(false);

      // Cleanup
      await fs.unlink(link1);
      await fs.unlink(link2);
    });
  });

  describe('Relative Path Symlink Attacks', () => {
    it('should_block_relativeSymlinkResolvingOutside', async () => {
      // Create subdirectory: allowed/subdir/
      const subdir = path.join(allowedDir, 'subdir');
      await fs.mkdir(subdir);

      // Create symlink: allowed/subdir/escape -> ../../forbidden
      const symlinkPath = path.join(subdir, 'escape');
      await fs.symlink('../../forbidden', symlinkPath);

      const allowed = await isAllowedPath(symlinkPath, [allowedDir]);

      expect(allowed).toBe(false);

      // Cleanup
      await fs.unlink(symlinkPath);
      await fs.rmdir(subdir);
    });

    it('should_block_dotDotSlashInSymlinkTarget', async () => {
      // Create symlink: allowed/escape -> ../forbidden/sensitive.txt
      const symlinkPath = path.join(allowedDir, 'escape-sensitive');
      await fs.symlink('../forbidden/sensitive.txt', symlinkPath);

      const allowed = await isAllowedPath(symlinkPath, [allowedDir]);

      expect(allowed).toBe(false);

      // Cleanup
      await fs.unlink(symlinkPath);
    });
  });

  describe('Legitimate Symlinks (Sanity Check)', () => {
    it('should_allow_symlinkWithinAllowedDirectory', async () => {
      // Create symlink: allowed/link -> allowed/safe.txt
      const symlinkPath = path.join(allowedDir, 'safe-link');
      await fs.symlink('safe.txt', symlinkPath);

      const allowed = await isAllowedPath(symlinkPath, [allowedDir]);

      expect(allowed).toBe(true);

      // Cleanup
      await fs.unlink(symlinkPath);
    });

    it('should_allow_absoluteSymlinkToAllowedDirectory', async () => {
      // Create symlink: allowed/abs-link -> /tmp/.../allowed/safe.txt
      const targetPath = path.join(allowedDir, 'safe.txt');
      const symlinkPath = path.join(allowedDir, 'abs-safe-link');
      await fs.symlink(targetPath, symlinkPath);

      const allowed = await isAllowedPath(symlinkPath, [allowedDir]);

      expect(allowed).toBe(true);

      // Cleanup
      await fs.unlink(symlinkPath);
    });

    it('should_allow_relativeSymlinkToSubdirectory', async () => {
      // Create subdirectory: allowed/subdir/
      const subdir = path.join(allowedDir, 'subdir2');
      await fs.mkdir(subdir);

      // Create file: allowed/subdir/file.txt
      const filePath = path.join(subdir, 'file.txt');
      await fs.writeFile(filePath, 'data', 'utf-8');

      // Create symlink: allowed/link -> subdir/file.txt
      const symlinkPath = path.join(allowedDir, 'subdir-link');
      await fs.symlink('subdir2/file.txt', symlinkPath);

      const allowed = await isAllowedPath(symlinkPath, [allowedDir]);

      expect(allowed).toBe(true);

      // Cleanup
      await fs.unlink(symlinkPath);
      await fs.unlink(filePath);
      await fs.rmdir(subdir);
    });
  });

  describe('Edge Cases', () => {
    it('should_returnFalse_when_symlinkTargetDoesNotExist', async () => {
      // Create symlink to non-existent target
      const symlinkPath = path.join(allowedDir, 'broken-link');
      await fs.symlink('non-existent-target', symlinkPath);

      // realpath() fails on broken symlink
      const allowed = await isAllowedPath(symlinkPath, [allowedDir]);

      expect(allowed).toBe(false);

      // Cleanup
      await fs.unlink(symlinkPath);
    });

    it('should_returnFalse_when_pathIsSymlinkToDirectory', async () => {
      // Create symlink: allowed/dir-link -> forbidden/
      const symlinkPath = path.join(allowedDir, 'forbidden-dir-link');
      await fs.symlink(forbiddenDir, symlinkPath);

      const allowed = await isAllowedPath(symlinkPath, [allowedDir]);

      expect(allowed).toBe(false);

      // Cleanup
      await fs.unlink(symlinkPath);
    });

    it('should_handle_emptyAllowedRoots', async () => {
      const somePath = path.join(allowedDir, 'safe.txt');

      const allowed = await isAllowedPath(somePath, []);

      expect(allowed).toBe(false);
    });
  });

  describe('Real-World Attack Scenarios', () => {
    it('should_block_etcPasswdSymlinkAttack', async () => {
      // Simulate: user creates symlink to /etc/passwd
      const symlinkPath = path.join(allowedDir, 'passwd');

      // Use our test sensitive file
      await fs.symlink(sensitiveFile, symlinkPath);

      const allowed = await isAllowedPath(symlinkPath, [allowedDir]);

      expect(allowed).toBe(false);

      // Cleanup
      await fs.unlink(symlinkPath);
    });

    it('should_block_procSelfEnvironAttack', async () => {
      // Simulate: symlink to /proc/self/environ (Linux)
      const symlinkPath = path.join(allowedDir, 'environ');

      // Use forbidden directory as proxy for /proc
      await fs.symlink(forbiddenDir, symlinkPath);

      const allowed = await isAllowedPath(symlinkPath, [allowedDir]);

      expect(allowed).toBe(false);

      // Cleanup
      await fs.unlink(symlinkPath);
    });

    it('should_block_sshPrivateKeySymlink', async () => {
      // Simulate: symlink to ~/.ssh/id_rsa
      const symlinkPath = path.join(allowedDir, 'id_rsa');

      // Use sensitive file as proxy
      await fs.symlink(sensitiveFile, symlinkPath);

      const allowed = await isAllowedPath(symlinkPath, [allowedDir]);

      expect(allowed).toBe(false);

      // Cleanup
      await fs.unlink(symlinkPath);
    });
  });
});
