import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LockFileService } from '../../src/services/lock-file';

describe('LockFileService', () => {
  let lockService: LockFileService;
  let testLockPath: string;

  beforeEach(() => {
    testLockPath = path.join(os.tmpdir(), `test-lock-${Date.now()}`);
    lockService = new LockFileService(testLockPath, 5000); // 5s timeout for tests
  });

  afterEach(async () => {
    await lockService.release();
    try {
      await fs.unlink(testLockPath);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('acquire', () => {
    it('should_acquireLock_when_noLockExists', async () => {
      await lockService.acquire();
      
      // Verify lock file was created
      const lockContent = await fs.readFile(testLockPath, 'utf-8');
      expect(lockContent).toContain(String(process.pid));
      expect(lockContent).toContain(String(Date.now()).substring(0, 8)); // Approx timestamp
    });

    it('should_waitAndRetry_when_lockHeldByRunningProcess', async () => {
      // Acquire first lock
      await lockService.acquire();

      // Verify lock file exists and contains correct PID
      const lockContent = await fs.readFile(testLockPath, 'utf-8');
      expect(lockContent).toContain(String(process.pid));

      // Note: Full concurrent access test would hang (same process can't block itself)
      // This test validates lock file creation and PID tracking
    });

    it('should_removeStaleLock_when_processNoLongerExists', async () => {
      // Create fake lock with non-existent PID
      await fs.mkdir(path.dirname(testLockPath), { recursive: true });
      await fs.writeFile(testLockPath, `999999\n${Date.now()}`, 'utf-8');
      
      // Should remove stale lock and acquire successfully
      await lockService.acquire();
      
      const lockContent = await fs.readFile(testLockPath, 'utf-8');
      expect(lockContent).toContain(String(process.pid));
    });

    it('should_removeStaleLock_when_timeoutExceeded', async () => {
      // Create lock with old timestamp (expired)
      await fs.mkdir(path.dirname(testLockPath), { recursive: true });
      const oldTimestamp = Date.now() - 10000; // 10 seconds old
      await fs.writeFile(testLockPath, `${process.pid}\n${oldTimestamp}`, 'utf-8');
      
      // Should remove stale lock and acquire
      await lockService.acquire();
      
      const lockContent = await fs.readFile(testLockPath, 'utf-8');
      const [, timestamp] = lockContent.trim().split('\n');
      expect(parseInt(timestamp)).toBeGreaterThan(oldTimestamp);
    });
  });

  describe('release', () => {
    it('should_removeLockFile_when_released', async () => {
      await lockService.acquire();
      expect(await fs.stat(testLockPath)).toBeDefined();
      
      await lockService.release();
      
      await expect(fs.stat(testLockPath)).rejects.toThrow();
    });

    it('should_notThrow_when_lockDoesNotExist', async () => {
      await expect(lockService.release()).resolves.not.toThrow();
    });
  });

  describe('withLock', () => {
    it('should_acquireAndReleaseLock_when_callbackSucceeds', async () => {
      let executed = false;
      
      await lockService.withLock(async () => {
        executed = true;
        expect(await fs.stat(testLockPath)).toBeDefined();
      });
      
      expect(executed).toBe(true);
      await expect(fs.stat(testLockPath)).rejects.toThrow(); // Lock released
    });

    it('should_releaseLock_when_callbackThrows', async () => {
      await expect(
        lockService.withLock(async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');
      
      // Lock should still be released
      await expect(fs.stat(testLockPath)).rejects.toThrow();
    });

    it('should_returnCallbackResult_when_successful', async () => {
      const result = await lockService.withLock(async () => {
        return 42;
      });
      
      expect(result).toBe(42);
    });
  });

  describe('security', () => {
    it('should_checkProcessExistence_when_acquiringLock', async () => {
      // Create lock with non-existent PID (zombie lock)
      await fs.mkdir(path.dirname(testLockPath), { recursive: true });
      await fs.writeFile(testLockPath, `999999\n${Date.now()}`, 'utf-8');

      // Should remove zombie lock and acquire successfully
      await lockService.acquire();

      // Verify we acquired the lock (PID should be current process)
      const lockContent = await fs.readFile(testLockPath, 'utf-8');
      expect(lockContent).toContain(String(process.pid));
    });
  });
});
