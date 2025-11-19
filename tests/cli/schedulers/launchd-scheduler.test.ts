/**
 * LaunchdScheduler Tests - Red-Green-Refactor TDD
 *
 * **TEST SCOPE:** User-level launchd agent installation, uninstallation, existence checks
 * **COVERAGE TARGET:** 90%+ per constitution
 * **WHY:** launchd is the standard init system on macOS
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LaunchdScheduler } from '../../../src/cli/schedulers/launchd-scheduler';

// Skip all tests on non-macOS platforms (launchctl not available)
const describeMacOS = process.platform === 'darwin' ? describe : describe.skip;

describeMacOS('LaunchdScheduler', () => {
  let scheduler: LaunchdScheduler;
  let plistPath: string;
  const AGENT_NAME = 'com.code-executor-mcp.sync';

  beforeEach(() => {
    scheduler = new LaunchdScheduler(AGENT_NAME);
    const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    plistPath = path.join(launchAgentsDir, `${AGENT_NAME}.plist`);
  });

  afterEach(async () => {
    // Cleanup: Uninstall agent if tests left it installed
    try {
      await scheduler.uninstall();
    } catch {
      // Ignore errors - agent may not exist
    }
  });

  describe('install()', () => {
    it('should create .plist file in ~/Library/LaunchAgents/', async () => {
      const scriptPath = '/Users/user/.code-executor/daily-sync.sh';
      const syncTime = '05:00';

      await scheduler.install(scriptPath, syncTime);

      // Verify .plist file exists
      await expect(fs.access(plistPath)).resolves.not.toThrow();
    });

    it('should write StartCalendarInterval with Hour and Minute keys', async () => {
      const scriptPath = '/Users/user/.code-executor/daily-sync.sh';
      const syncTime = '05:00';

      await scheduler.install(scriptPath, syncTime);

      const plistContent = await fs.readFile(plistPath, 'utf-8');
      expect(plistContent).toContain('<key>StartCalendarInterval</key>');
      expect(plistContent).toContain('<key>Hour</key>');
      expect(plistContent).toContain('<integer>5</integer>');
      expect(plistContent).toContain('<key>Minute</key>');
      expect(plistContent).toContain('<integer>0</integer>');
    });

    it('should set Label key to agent name', async () => {
      const scriptPath = '/Users/user/.code-executor/daily-sync.sh';
      const syncTime = '05:00';

      await scheduler.install(scriptPath, syncTime);

      const plistContent = await fs.readFile(plistPath, 'utf-8');
      expect(plistContent).toContain('<key>Label</key>');
      expect(plistContent).toContain(`<string>${AGENT_NAME}</string>`);
    });

    it('should set Program key to provided scriptPath', async () => {
      const scriptPath = '/Users/user/.code-executor/daily-sync.sh';
      const syncTime = '05:00';

      await scheduler.install(scriptPath, syncTime);

      const plistContent = await fs.readFile(plistPath, 'utf-8');
      expect(plistContent).toContain('<key>Program</key>');
      expect(plistContent).toContain(`<string>${scriptPath}</string>`);
    });

    it('should set StandardOutPath and StandardErrorPath for logging', async () => {
      const scriptPath = '/Users/user/.code-executor/daily-sync.sh';
      const syncTime = '05:00';

      await scheduler.install(scriptPath, syncTime);

      const plistContent = await fs.readFile(plistPath, 'utf-8');
      expect(plistContent).toContain('<key>StandardOutPath</key>');
      expect(plistContent).toContain('<key>StandardErrorPath</key>');
    });

    it('should complete installation successfully on valid inputs', async () => {
      const scriptPath = '/Users/user/.code-executor/daily-sync.sh';
      const syncTime = '05:00';

      // Installation should complete without throwing
      await expect(scheduler.install(scriptPath, syncTime)).resolves.not.toThrow();

      // Verify agent is loaded
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
      const scriptPath = '/Users/user/.code-executor/daily-sync.sh';
      const syncTime = '12:00'; // Outside 4-6 AM range

      await expect(scheduler.install(scriptPath, syncTime)).rejects.toThrow(
        'syncTime must be between 04:00 and 06:00'
      );
    });

    it('should throw error if syncTime format is invalid', async () => {
      const scriptPath = '/Users/user/.code-executor/daily-sync.sh';
      const syncTime = '5:00am'; // Invalid format (not HH:MM)

      await expect(scheduler.install(scriptPath, syncTime)).rejects.toThrow(
        'syncTime must be in HH:MM format'
      );
    });

    it('should accept syncTime in valid 4-6 AM range (edge cases)', async () => {
      const scriptPath = '/Users/user/.code-executor/daily-sync.sh';

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
  });

  describe('uninstall()', () => {
    it('should complete uninstall successfully', async () => {
      // Install agent first
      await scheduler.install('/Users/user/.code-executor/daily-sync.sh', '05:00');

      // Uninstall should complete without throwing
      await expect(scheduler.uninstall()).resolves.not.toThrow();
    });

    it('should remove .plist file from ~/Library/LaunchAgents/', async () => {
      // Install agent first
      await scheduler.install('/Users/user/.code-executor/daily-sync.sh', '05:00');

      // Verify file exists before uninstall
      await expect(fs.access(plistPath)).resolves.not.toThrow();

      // Uninstall
      await scheduler.uninstall();

      // Verify file removed
      await expect(fs.access(plistPath)).rejects.toThrow();
    });

    it('should not throw error if agent does not exist', async () => {
      // Ensure agent does not exist
      try {
        await fs.unlink(plistPath);
      } catch {
        // Ignore - file may not exist
      }

      // Uninstall should not throw
      await expect(scheduler.uninstall()).resolves.not.toThrow();
    });
  });

  describe('exists()', () => {
    it('should return true if .plist file exists and agent is loaded', async () => {
      // Install agent
      await scheduler.install('/Users/user/.code-executor/daily-sync.sh', '05:00');

      const exists = await scheduler.exists();

      expect(exists).toBe(true);
    });

    it('should return false if .plist file does not exist', async () => {
      // Ensure agent not installed
      try {
        await scheduler.uninstall();
      } catch {
        // Ignore
      }

      const exists = await scheduler.exists();

      expect(exists).toBe(false);
    });

    it('should return false after uninstalling agent', async () => {
      // Install agent
      await scheduler.install('/Users/user/.code-executor/daily-sync.sh', '05:00');

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
    it('should reject agentName with path traversal attempts', () => {
      expect(() => new LaunchdScheduler('../../../Library/LaunchDaemons/backdoor')).toThrow(
        'agentName must contain only alphanumeric characters, hyphens, underscores, and dots'
      );
    });

    it('should reject agentName with special characters', () => {
      expect(() => new LaunchdScheduler('agent;malicious')).toThrow(
        'agentName must contain only alphanumeric characters'
      );
    });

    it('should reject scriptPath with single quotes (defense-in-depth)', async () => {
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

    it('should accept valid agentName with dots (reverse DNS notation)', () => {
      expect(() => new LaunchdScheduler('com.example.app.sync')).not.toThrow();
    });
  });
});
