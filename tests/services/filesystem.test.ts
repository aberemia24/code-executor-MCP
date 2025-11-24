import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileSystemService } from '../../src/utils/filesystem';

describe('FileSystemService', () => {
  let fsService: FileSystemService;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `fs-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    fsService = new FileSystemService();
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('canonicalizePath', () => {
    it('should_resolveAbsolutePath_when_relativePathProvided', async () => {
      const relativePath = './test.txt';
      const absolutePath = await fsService.canonicalizePath(relativePath);

      expect(path.isAbsolute(absolutePath)).toBe(true);
      expect(absolutePath).toContain('test.txt');
    });

    it('should_resolveSymlinks_when_symlinkProvided', async () => {
      // Create real file and symlink
      const realFile = path.join(testDir, 'real.txt');
      const symlinkFile = path.join(testDir, 'link.txt');

      await fs.writeFile(realFile, 'test', 'utf-8');
      await fs.symlink(realFile, symlinkFile);

      const canonicalPath = await fsService.canonicalizePath(symlinkFile);

      expect(canonicalPath).toBe(realFile);
      expect(canonicalPath).not.toBe(symlinkFile);
    });

    it('should_handleNonExistentPaths_when_pathDoesNotExist', async () => {
      const nonExistent = path.join(testDir, 'does-not-exist.txt');

      // Should not throw, just normalize the path
      const result = await fsService.canonicalizePath(nonExistent);

      expect(path.isAbsolute(result)).toBe(true);
    });
  });

  describe('isPathAllowed', () => {
    it('should_returnTrue_when_pathWithinAllowedRoot', async () => {
      const filePath = path.join(testDir, 'allowed.txt');
      await fs.writeFile(filePath, 'test', 'utf-8'); // File must exist for realpath()

      const isAllowed = await fsService.isPathAllowed(filePath, [testDir]);

      expect(isAllowed).toBe(true);
    });

    it('should_returnFalse_when_pathOutsideAllowedRoot', async () => {
      const filePath = '/etc/passwd';

      const isAllowed = await fsService.isPathAllowed(filePath, [testDir]);

      expect(isAllowed).toBe(false);
    });

    it('should_preventTraversal_when_pathUsesParentDirectory', async () => {
      const traversalPath = path.join(testDir, '..', '..', 'etc', 'passwd');

      const isAllowed = await fsService.isPathAllowed(traversalPath, [testDir]);

      expect(isAllowed).toBe(false);
    });

    it('should_preventSymlinkEscape_when_symlinkPointsOutside', async () => {
      const symlinkPath = path.join(testDir, 'escape-link');
      await fs.symlink('/etc/passwd', symlinkPath);

      const isAllowed = await fsService.isPathAllowed(symlinkPath, [testDir]);

      expect(isAllowed).toBe(false);
    });
  });

  describe('ensureDirectory', () => {
    it('should_createDirectory_when_directoryDoesNotExist', async () => {
      const newDir = path.join(testDir, 'new-dir');

      await fsService.ensureDirectory(newDir);

      const stats = await fs.stat(newDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should_notThrow_when_directoryAlreadyExists', async () => {
      const existingDir = testDir;

      await expect(fsService.ensureDirectory(existingDir)).resolves.not.toThrow();
    });

    it('should_createNestedDirectories_when_parentDoesNotExist', async () => {
      const nestedDir = path.join(testDir, 'a', 'b', 'c');

      await fsService.ensureDirectory(nestedDir);

      const stats = await fs.stat(nestedDir);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe('checkPermissions', () => {
    it('should_returnTrue_when_fileIsReadable', async () => {
      const testFile = path.join(testDir, 'readable.txt');
      await fs.writeFile(testFile, 'test', 'utf-8');

      const canRead = await fsService.checkPermissions(testFile, 'read');

      expect(canRead).toBe(true);
    });

    it('should_returnTrue_when_fileIsWritable', async () => {
      const testFile = path.join(testDir, 'writable.txt');
      await fs.writeFile(testFile, 'test', 'utf-8');

      const canWrite = await fsService.checkPermissions(testFile, 'write');

      expect(canWrite).toBe(true);
    });

    it('should_returnFalse_when_fileDoesNotExist', async () => {
      const nonExistent = path.join(testDir, 'missing.txt');

      const canRead = await fsService.checkPermissions(nonExistent, 'read');

      expect(canRead).toBe(false);
    });
  });

  describe('security', () => {
    it('should_blockPathTraversal_when_maliciousPathProvided', async () => {
      const maliciousPath = '../../../etc/passwd';

      const isAllowed = await fsService.isPathAllowed(maliciousPath, [testDir]);

      expect(isAllowed).toBe(false);
    });

    it('should_blockSymlinkEscape_when_symlinkToSystemFile', async () => {
      const symlinkPath = path.join(testDir, 'evil-link');
      await fs.symlink('/etc/shadow', symlinkPath);

      const isAllowed = await fsService.isPathAllowed(symlinkPath, [testDir]);

      expect(isAllowed).toBe(false);
    });
  });
});
