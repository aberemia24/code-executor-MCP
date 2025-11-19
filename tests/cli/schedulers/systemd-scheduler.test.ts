/**
 * SystemdScheduler Tests - Red-Green-Refactor TDD
 *
 * **TEST SCOPE:** User-level systemd timer installation, uninstallation, existence checks
 * **COVERAGE TARGET:** 90%+ per constitution
 * **WHY:** Systemd is the standard init system on Linux (Ubuntu, Fedora, Arch, Debian)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { SystemdScheduler } from '../../../src/cli/schedulers/systemd-scheduler';

describe('SystemdScheduler', () => {
  let scheduler: SystemdScheduler;
  let timerPath: string;
  let servicePath: string;
  const TIMER_NAME = 'code-executor-mcp-sync';

  beforeEach(() => {
    scheduler = new SystemdScheduler(TIMER_NAME);
    const systemdUserDir = path.join(os.homedir(), '.config', 'systemd', 'user');
    timerPath = path.join(systemdUserDir, `${TIMER_NAME}.timer`);
    servicePath = path.join(systemdUserDir, `${TIMER_NAME}.service`);
  });

  afterEach(async () => {
    // Cleanup: Uninstall timer if tests left it installed
    try {
      await scheduler.uninstall();
    } catch {
      // Ignore errors - timer may not exist
    }
  });

  describe('install()', () => {
    it('should create .timer and .service files in ~/.config/systemd/user/', async () => {
      const scriptPath = '/home/user/.code-executor/daily-sync.sh';
      const syncTime = '05:00';

      await scheduler.install(scriptPath, syncTime);

      // Verify .timer file exists
      await expect(fs.access(timerPath)).resolves.not.toThrow();

      // Verify .service file exists
      await expect(fs.access(servicePath)).resolves.not.toThrow();
    });

    it('should write correct OnCalendar directive for specified sync time', async () => {
      const scriptPath = '/home/user/.code-executor/daily-sync.sh';
      const syncTime = '05:00';

      await scheduler.install(scriptPath, syncTime);

      const timerContent = await fs.readFile(timerPath, 'utf-8');
      expect(timerContent).toContain('OnCalendar=*-*-* 05:00:00');
    });

    it('should complete installation successfully on valid inputs', async () => {
      const scriptPath = '/home/user/.code-executor/daily-sync.sh';
      const syncTime = '05:00';

      // Installation should complete without throwing
      await expect(scheduler.install(scriptPath, syncTime)).resolves.not.toThrow();

      // Verify timer is installed and active
      const exists = await scheduler.exists();
      expect(exists).toBe(true);
    });

    it('should throw error if scriptPath is not absolute', async () => {
      const scriptPath = 'relative/path/daily-sync.sh'; // Not absolute
      const syncTime = '05:00';

      await expect(scheduler.install(scriptPath, syncTime)).rejects.toThrow(
        'scriptPath must be absolute'
      );
    });

    it('should throw error if syncTime is outside 4-6 AM range', async () => {
      const scriptPath = '/home/user/.code-executor/daily-sync.sh';
      const syncTime = '12:00'; // Outside 4-6 AM range

      await expect(scheduler.install(scriptPath, syncTime)).rejects.toThrow(
        'syncTime must be between 04:00 and 06:00'
      );
    });

    it('should throw error if syncTime format is invalid', async () => {
      const scriptPath = '/home/user/.code-executor/daily-sync.sh';
      const syncTime = '5:00am'; // Invalid format (not HH:MM)

      await expect(scheduler.install(scriptPath, syncTime)).rejects.toThrow(
        'syncTime must be in HH:MM format'
      );
    });

    it('should accept syncTime in valid 4-6 AM range (edge cases)', async () => {
      const scriptPath = '/home/user/.code-executor/daily-sync.sh';

      // Test 04:00 (lower bound)
      await expect(scheduler.install(scriptPath, '04:00')).resolves.not.toThrow();

      // Cleanup
      await scheduler.uninstall();

      // Test 05:59 (upper bound)
      await expect(scheduler.install(scriptPath, '05:59')).resolves.not.toThrow();

      // Cleanup
      await scheduler.uninstall();

      // Test 06:00 (upper bound inclusive)
      await expect(scheduler.install(scriptPath, '06:00')).resolves.not.toThrow();
    });

    it('should set RandomizedDelaySec=2min in timer file', async () => {
      const scriptPath = '/home/user/.code-executor/daily-sync.sh';
      const syncTime = '05:00';

      await scheduler.install(scriptPath, syncTime);

      const timerContent = await fs.readFile(timerPath, 'utf-8');
      expect(timerContent).toContain('RandomizedDelaySec=2min');
    });

    it('should set Type=oneshot in service file', async () => {
      const scriptPath = '/home/user/.code-executor/daily-sync.sh';
      const syncTime = '05:00';

      await scheduler.install(scriptPath, syncTime);

      const serviceContent = await fs.readFile(servicePath, 'utf-8');
      expect(serviceContent).toContain('Type=oneshot');
    });

    it('should use provided scriptPath in ExecStart directive without shell wrapper', async () => {
      const scriptPath = '/home/user/.code-executor/daily-sync.sh';
      const syncTime = '05:00';

      await scheduler.install(scriptPath, syncTime);

      const serviceContent = await fs.readFile(servicePath, 'utf-8');
      // Security: No bash wrapper to prevent command injection
      expect(serviceContent).toContain(`ExecStart=${scriptPath}`);
      expect(serviceContent).not.toContain('bash -c');
    });
  });

  describe('uninstall()', () => {
    it('should complete uninstall successfully', async () => {
      // Install timer first
      await scheduler.install('/home/user/.code-executor/daily-sync.sh', '05:00');

      // Uninstall should complete without throwing
      await expect(scheduler.uninstall()).resolves.not.toThrow();
    });

    it('should remove .timer file from ~/.config/systemd/user/', async () => {
      // Install timer first
      await scheduler.install('/home/user/.code-executor/daily-sync.sh', '05:00');

      // Verify file exists before uninstall
      await expect(fs.access(timerPath)).resolves.not.toThrow();

      // Uninstall
      await scheduler.uninstall();

      // Verify file removed
      await expect(fs.access(timerPath)).rejects.toThrow();
    });

    it('should remove .service file from ~/.config/systemd/user/', async () => {
      // Install timer first
      await scheduler.install('/home/user/.code-executor/daily-sync.sh', '05:00');

      // Verify file exists before uninstall
      await expect(fs.access(servicePath)).resolves.not.toThrow();

      // Uninstall
      await scheduler.uninstall();

      // Verify file removed
      await expect(fs.access(servicePath)).rejects.toThrow();
    });

    it('should not throw error if timer does not exist', async () => {
      // Ensure timer does not exist
      try {
        await fs.unlink(timerPath);
        await fs.unlink(servicePath);
      } catch {
        // Ignore - files may not exist
      }

      // Uninstall should not throw
      await expect(scheduler.uninstall()).resolves.not.toThrow();
    });
  });

  describe('exists()', () => {
    it('should return true if .timer file exists and timer is active', async () => {
      // Install timer
      await scheduler.install('/home/user/.code-executor/daily-sync.sh', '05:00');

      const exists = await scheduler.exists();

      expect(exists).toBe(true);
    });

    it('should return false if .timer file does not exist', async () => {
      // Ensure timer not installed
      try {
        await scheduler.uninstall();
      } catch {
        // Ignore
      }

      const exists = await scheduler.exists();

      expect(exists).toBe(false);
    });

    it('should return false after uninstalling timer', async () => {
      // Install timer
      await scheduler.install('/home/user/.code-executor/daily-sync.sh', '05:00');

      // Verify it exists
      expect(await scheduler.exists()).toBe(true);

      // Uninstall
      await scheduler.uninstall();

      // Verify it no longer exists
      const exists = await scheduler.exists();
      expect(exists).toBe(false);
    });
  });

  describe('validation', () => {
    it('should validate sync time is in 24-hour format', async () => {
      const scriptPath = '/home/user/.code-executor/daily-sync.sh';

      // Invalid: 12-hour format
      await expect(scheduler.install(scriptPath, '5:00')).rejects.toThrow(
        'syncTime must be in HH:MM format'
      );

      // Valid: 24-hour format
      await expect(scheduler.install(scriptPath, '05:00')).resolves.not.toThrow();
    });

    it('should validate sync time hours are two digits', async () => {
      const scriptPath = '/home/user/.code-executor/daily-sync.sh';

      // Invalid: single digit hour
      await expect(scheduler.install(scriptPath, '5:00')).rejects.toThrow(
        'syncTime must be in HH:MM format'
      );
    });

    it('should validate sync time minutes are two digits', async () => {
      const scriptPath = '/home/user/.code-executor/daily-sync.sh';

      // Invalid: single digit minute
      await expect(scheduler.install(scriptPath, '05:0')).rejects.toThrow(
        'syncTime must be in HH:MM format'
      );
    });
  });

  describe('security validation', () => {
    it('should reject timerName with path traversal attempts', () => {
      expect(() => new SystemdScheduler('../../../etc/cron.d/backdoor')).toThrow(
        'timerName must contain only alphanumeric characters, hyphens, and underscores'
      );
    });

    it('should reject timerName with special characters', () => {
      expect(() => new SystemdScheduler('timer;malicious')).toThrow(
        'timerName must contain only alphanumeric characters'
      );
    });

    it('should reject timerName with slashes', () => {
      expect(() => new SystemdScheduler('../../.ssh/authorized_keys')).toThrow(
        'timerName must contain only alphanumeric characters'
      );
    });

    it('should reject scriptPath with single quotes (command injection prevention)', async () => {
      const maliciousPath = "/tmp/test.sh'; echo INJECTED; echo '";
      const syncTime = '05:00';

      await expect(scheduler.install(maliciousPath, syncTime)).rejects.toThrow(
        'scriptPath contains invalid characters (quotes or newlines)'
      );
    });

    it('should reject scriptPath with double quotes', async () => {
      const maliciousPath = '/tmp/test.sh"; echo INJECTED; echo "';
      const syncTime = '05:00';

      await expect(scheduler.install(maliciousPath, syncTime)).rejects.toThrow(
        'scriptPath contains invalid characters (quotes or newlines)'
      );
    });

    it('should reject scriptPath with newlines', async () => {
      const maliciousPath = '/tmp/test.sh\nmalicious-command';
      const syncTime = '05:00';

      await expect(scheduler.install(maliciousPath, syncTime)).rejects.toThrow(
        'scriptPath contains invalid characters (quotes or newlines)'
      );
    });
  });
});
