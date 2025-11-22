/**
 * Integration tests for daily sync scheduler
 *
 * **PURPOSE:** Prevent regressions in scheduler installation and daily sync flow
 * **COVERAGE:** PlatformSchedulerFactory, SystemdScheduler, LaunchdScheduler, TaskSchedulerWrapper
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlatformSchedulerFactory } from '../../src/cli/platform-scheduler.js';
import type { ISyncScheduler } from '../../src/cli/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('Scheduler Integration Tests', () => {
  let tempDir: string;
  let originalPlatform: NodeJS.Platform;

  beforeEach(async () => {
    // Create temp directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scheduler-test-'));

    // Save original platform
    originalPlatform = process.platform;
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    // Restore original platform
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  });

  describe('PlatformSchedulerFactory', () => {
    it('should detect supported platforms', () => {
      const platforms = PlatformSchedulerFactory.getSupportedPlatforms();
      expect(platforms).toEqual(['linux', 'darwin', 'win32']);
    });

    it('should return current platform', () => {
      const platform = PlatformSchedulerFactory.getCurrentPlatform();
      expect(platform).toBe(process.platform);
    });

    it('should check if platform is supported', () => {
      expect(PlatformSchedulerFactory.isSupported('linux')).toBe(true);
      expect(PlatformSchedulerFactory.isSupported('darwin')).toBe(true);
      expect(PlatformSchedulerFactory.isSupported('win32')).toBe(true);
      expect(PlatformSchedulerFactory.isSupported('unsupported')).toBe(false);
    });

    it('should throw error for unsupported platform', () => {
      // Mock unsupported platform
      Object.defineProperty(process, 'platform', {
        value: 'unsupported',
        writable: true,
        configurable: true,
      });

      expect(() => PlatformSchedulerFactory.create()).toThrow(
        'Unsupported platform: unsupported'
      );
    });

    it('should create SystemdScheduler on Linux', () => {
      const scheduler = PlatformSchedulerFactory.createForPlatform('linux');
      expect(scheduler).toBeDefined();
      expect(scheduler.constructor.name).toBe('SystemdScheduler');
    });

    it('should create LaunchdScheduler on macOS', () => {
      const scheduler = PlatformSchedulerFactory.createForPlatform('darwin');
      expect(scheduler).toBeDefined();
      expect(scheduler.constructor.name).toBe('LaunchdScheduler');
    });

    it('should create TaskSchedulerWrapper on Windows', () => {
      const scheduler = PlatformSchedulerFactory.createForPlatform('win32');
      expect(scheduler).toBeDefined();
      expect(scheduler.constructor.name).toBe('TaskSchedulerWrapper');
    });
  });

  describe('Scheduler Installation Validation', () => {
    it('should validate scriptPath must be absolute', async () => {
      const scheduler = PlatformSchedulerFactory.createForPlatform('linux', 'test-timer');

      await expect(
        scheduler.install('relative/path.sh', '05:00')
      ).rejects.toThrow('scriptPath must be absolute');
    });

    it('should validate syncTime format', async () => {
      const scheduler = PlatformSchedulerFactory.createForPlatform('linux', 'test-timer');
      const scriptPath = '/usr/bin/test-script.sh';

      await expect(
        scheduler.install(scriptPath, 'invalid-time')
      ).rejects.toThrow('syncTime must be in HH:MM format');
    });

    it('should validate syncTime is in 4-6 AM range', async () => {
      const scheduler = PlatformSchedulerFactory.createForPlatform('linux', 'test-timer');
      const scriptPath = '/usr/bin/test-script.sh';

      // Valid times
      await expect(scheduler.install(scriptPath, '04:00')).resolves.not.toThrow();
      await expect(scheduler.install(scriptPath, '05:30')).resolves.not.toThrow();
      await expect(scheduler.install(scriptPath, '06:00')).resolves.not.toThrow();

      // Invalid times
      await expect(
        scheduler.install(scriptPath, '03:59')
      ).rejects.toThrow('syncTime must be between 04:00 and 06:00');

      await expect(
        scheduler.install(scriptPath, '06:01')
      ).rejects.toThrow('syncTime must be between 04:00 and 06:00');

      await expect(
        scheduler.install(scriptPath, '12:00')
      ).rejects.toThrow('syncTime must be between 04:00 and 06:00');
    });

    it('should reject scriptPath with dangerous characters', async () => {
      const scheduler = PlatformSchedulerFactory.createForPlatform('linux', 'test-timer');

      await expect(
        scheduler.install('/path/with"quote.sh', '05:00')
      ).rejects.toThrow('scriptPath contains invalid characters');

      await expect(
        scheduler.install("/path/with'quote.sh", '05:00')
      ).rejects.toThrow('scriptPath contains invalid characters');

      await expect(
        scheduler.install('/path/with\nnewline.sh', '05:00')
      ).rejects.toThrow('scriptPath contains invalid characters');
    });
  });

  describe('Timer Name Validation', () => {
    it('should accept valid timer names', () => {
      expect(() => PlatformSchedulerFactory.createForPlatform('linux', 'valid-name')).not.toThrow();
      expect(() => PlatformSchedulerFactory.createForPlatform('linux', 'valid_name')).not.toThrow();
      expect(() => PlatformSchedulerFactory.createForPlatform('linux', 'ValidName123')).not.toThrow();
    });

    it('should reject timer names with path traversal', () => {
      expect(() => PlatformSchedulerFactory.createForPlatform('linux', '../evil')).toThrow(
        'timerName must contain only alphanumeric characters'
      );

      expect(() => PlatformSchedulerFactory.createForPlatform('linux', 'path/to/timer')).toThrow(
        'timerName must contain only alphanumeric characters'
      );
    });

    it('should reject timer names with special characters', () => {
      expect(() => PlatformSchedulerFactory.createForPlatform('linux', 'name@domain')).toThrow(
        'timerName must contain only alphanumeric characters'
      );

      expect(() => PlatformSchedulerFactory.createForPlatform('linux', 'name$var')).toThrow(
        'timerName must contain only alphanumeric characters'
      );
    });
  });
});
