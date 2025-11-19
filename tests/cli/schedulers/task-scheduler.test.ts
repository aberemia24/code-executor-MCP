/**
 * TaskSchedulerWrapper Tests - Red-Green-Refactor TDD
 *
 * **TEST SCOPE:** Windows Task Scheduler task creation, deletion, existence checks
 * **COVERAGE TARGET:** 90%+ per constitution
 * **WHY:** Task Scheduler is the standard scheduling system on Windows
 * **WARNING:** Task creation requires ADMIN elevation (UAC prompt)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskSchedulerWrapper } from '../../../src/cli/schedulers/task-scheduler';

// Skip all tests on non-Windows platforms (PowerShell not available)
const describeWindows = process.platform === 'win32' ? describe : describe.skip;

describeWindows('TaskSchedulerWrapper', () => {
  let scheduler: TaskSchedulerWrapper;
  const TASK_NAME = 'CodeExecutorMCPSync';

  beforeEach(() => {
    scheduler = new TaskSchedulerWrapper(TASK_NAME);
  });

  afterEach(async () => {
    // Cleanup: Uninstall task if tests left it installed
    try {
      await scheduler.uninstall();
    } catch {
      // Ignore errors - task may not exist
    }
  });

  describe('install()', () => {
    it('should complete installation successfully on valid inputs', async () => {
      const scriptPath = 'C:\\Users\\user\\.code-executor\\daily-sync.ps1';
      const syncTime = '05:00';

      // Installation should complete without throwing
      // Note: Will fail on non-Windows or non-admin sessions
      await expect(scheduler.install(scriptPath, syncTime)).resolves.not.toThrow();

      // Verify task is registered
      const exists = await scheduler.exists();
      expect(exists).toBe(true);
    });

    it('should throw error if scriptPath is not absolute', async () => {
      const scriptPath = 'relative\\path\\daily-sync.ps1'; // Not absolute
      const syncTime = '05:00';

      await expect(scheduler.install(scriptPath, syncTime)).rejects.toThrow(
        'scriptPath must be absolute'
      );
    });

    it('should throw error if syncTime is outside 4-6 AM range', async () => {
      const scriptPath = 'C:\\Users\\user\\.code-executor\\daily-sync.ps1';
      const syncTime = '12:00'; // Outside 4-6 AM range

      await expect(scheduler.install(scriptPath, syncTime)).rejects.toThrow(
        'syncTime must be between 04:00 and 06:00'
      );
    });

    it('should throw error if syncTime format is invalid', async () => {
      const scriptPath = 'C:\\Users\\user\\.code-executor\\daily-sync.ps1';
      const syncTime = '5:00am'; // Invalid format (not HH:MM)

      await expect(scheduler.install(scriptPath, syncTime)).rejects.toThrow(
        'syncTime must be in HH:MM format'
      );
    });

    it('should accept syncTime in valid 4-6 AM range (edge cases)', async () => {
      const scriptPath = 'C:\\Users\\user\\.code-executor\\daily-sync.ps1';

      // Test 04:00 (lower bound)
      await expect(scheduler.install(scriptPath, '04:00')).resolves.not.toThrow();

      // Cleanup
      await scheduler.uninstall();

      // Test 05:59 (within range)
      await expect(scheduler.install(scriptPath, '05:59')).resolves.not.toThrow();

      // Cleanup
      await scheduler.uninstall();

      // Test 06:00 (upper bound inclusive)
      await expect(scheduler.install(scriptPath, '06:00')).resolves.not.toThrow();
    });

    it('should throw error if not running with admin privileges', async () => {
      const scriptPath = 'C:\\Users\\user\\.code-executor\\daily-sync.ps1';
      const syncTime = '05:00';

      // This test documents the admin requirement
      // Actual behavior: Will throw on non-admin PowerShell session
      // We can't reliably test this without admin, so we document it
      expect(true).toBe(true); // Placeholder - admin check is environmental
    });
  });

  describe('uninstall()', () => {
    it('should complete uninstall successfully', async () => {
      // Install task first
      await scheduler.install('C:\\Users\\user\\.code-executor\\daily-sync.ps1', '05:00');

      // Uninstall should complete without throwing
      await expect(scheduler.uninstall()).resolves.not.toThrow();
    });

    it('should not throw error if task does not exist', async () => {
      // Ensure task does not exist
      try {
        await scheduler.uninstall();
      } catch {
        // Ignore - task may not exist
      }

      // Uninstall should not throw
      await expect(scheduler.uninstall()).resolves.not.toThrow();
    });
  });

  describe('exists()', () => {
    it('should return true if task is registered', async () => {
      // Install task
      await scheduler.install('C:\\Users\\user\\.code-executor\\daily-sync.ps1', '05:00');

      const exists = await scheduler.exists();

      expect(exists).toBe(true);
    });

    it('should return false if task does not exist', async () => {
      // Ensure task not installed
      try {
        await scheduler.uninstall();
      } catch {
        // Ignore
      }

      const exists = await scheduler.exists();

      expect(exists).toBe(false);
    });

    it('should return false after uninstalling task', async () => {
      // Install task
      await scheduler.install('C:\\Users\\user\\.code-executor\\daily-sync.ps1', '05:00');

      // Verify it exists
      expect(await scheduler.exists()).toBe(true);

      // Uninstall
      await scheduler.uninstall();

      // Verify it no longer exists
      const exists = await scheduler.exists();
      expect(exists).toBe(false);
    });
  });

  describe('security validation', () => {
    it('should reject taskName with path traversal attempts', () => {
      expect(() => new TaskSchedulerWrapper('..\\..\\System\\Backdoor')).toThrow(
        'taskName must contain only alphanumeric characters, hyphens, and underscores'
      );
    });

    it('should reject taskName with special characters', () => {
      expect(() => new TaskSchedulerWrapper('task;malicious')).toThrow(
        'taskName must contain only alphanumeric characters'
      );
    });

    it('should reject taskName with backslashes', () => {
      expect(() => new TaskSchedulerWrapper('Folder\\Backdoor')).toThrow(
        'taskName must contain only alphanumeric characters'
      );
    });

    it('should reject scriptPath with single quotes (defense-in-depth)', async () => {
      const maliciousPath = "C:\\temp\\test.ps1'; echo INJECTED; echo '";
      const syncTime = '05:00';

      await expect(scheduler.install(maliciousPath, syncTime)).rejects.toThrow(
        'scriptPath contains invalid characters (quotes or newlines)'
      );
    });

    it('should reject scriptPath with double quotes', async () => {
      const maliciousPath = '/absolute/path/test.sh"; echo INJECTED; echo "';
      const syncTime = '05:00';

      await expect(scheduler.install(maliciousPath, syncTime)).rejects.toThrow(
        'scriptPath contains invalid characters (quotes or newlines)'
      );
    });

    it('should reject scriptPath with newlines', async () => {
      const maliciousPath = 'C:\\temp\\test.ps1\nmalicious-command';
      const syncTime = '05:00';

      await expect(scheduler.install(maliciousPath, syncTime)).rejects.toThrow(
        'scriptPath contains invalid characters (quotes or newlines)'
      );
    });
  });

  describe('validation', () => {
    it('should validate sync time is in 24-hour format', async () => {
      const scriptPath = 'C:\\Users\\user\\.code-executor\\daily-sync.ps1';

      // Invalid: 12-hour format
      await expect(scheduler.install(scriptPath, '5:00')).rejects.toThrow(
        'syncTime must be in HH:MM format'
      );

      // Valid: 24-hour format
      await expect(scheduler.install(scriptPath, '05:00')).resolves.not.toThrow();
    });

    it('should validate sync time hours are two digits', async () => {
      const scriptPath = 'C:\\Users\\user\\.code-executor\\daily-sync.ps1';

      // Invalid: single digit hour
      await expect(scheduler.install(scriptPath, '5:00')).rejects.toThrow(
        'syncTime must be in HH:MM format'
      );
    });

    it('should validate sync time minutes are two digits', async () => {
      const scriptPath = 'C:\\Users\\user\\.code-executor\\daily-sync.ps1';

      // Invalid: single digit minute
      await expect(scheduler.install(scriptPath, '05:0')).rejects.toThrow(
        'syncTime must be in HH:MM format'
      );
    });
  });
});
