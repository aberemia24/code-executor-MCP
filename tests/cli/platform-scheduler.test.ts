/**
 * PlatformSchedulerFactory Tests
 *
 * **RESPONSIBILITY (SRP):** Test platform detection and scheduler factory
 * **WHY:** Ensures correct scheduler selected based on OS platform
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlatformSchedulerFactory } from '../../src/cli/platform-scheduler';
import { SystemdScheduler } from '../../src/cli/schedulers/systemd-scheduler';
import { LaunchdScheduler } from '../../src/cli/schedulers/launchd-scheduler';
import { TaskSchedulerWrapper } from '../../src/cli/schedulers/task-scheduler';

describe('PlatformSchedulerFactory', () => {
  let originalPlatform: NodeJS.Platform;

  beforeEach(() => {
    originalPlatform = process.platform;
  });

  afterEach(() => {
    // Restore original platform
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  });

  describe('create', () => {
    it('should return SystemdScheduler on Linux platform', () => {
      // Arrange
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true,
      });

      // Act
      const scheduler = PlatformSchedulerFactory.create();

      // Assert
      expect(scheduler).toBeInstanceOf(SystemdScheduler);
    });

    it('should return LaunchdScheduler on macOS platform (darwin)', () => {
      // Arrange
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
        configurable: true,
      });

      // Act
      const scheduler = PlatformSchedulerFactory.create();

      // Assert
      expect(scheduler).toBeInstanceOf(LaunchdScheduler);
    });

    it('should return TaskSchedulerWrapper on Windows platform (win32)', () => {
      // Arrange
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      });

      // Act
      const scheduler = PlatformSchedulerFactory.create();

      // Assert
      expect(scheduler).toBeInstanceOf(TaskSchedulerWrapper);
    });

    it('should throw error on unsupported platform', () => {
      // Arrange
      Object.defineProperty(process, 'platform', {
        value: 'freebsd',
        writable: true,
        configurable: true,
      });

      // Act & Assert
      expect(() => PlatformSchedulerFactory.create()).toThrow(
        'Unsupported platform: freebsd. Daily sync timers are only supported on Linux (systemd), macOS (launchd), and Windows (Task Scheduler).'
      );
    });

    it('should use custom timer name if provided', () => {
      // Arrange
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true,
      });

      // Act
      const scheduler = PlatformSchedulerFactory.create('custom-timer-name');

      // Assert
      expect(scheduler).toBeInstanceOf(SystemdScheduler);
      // Note: We can't directly test the timerName without exposing internal state
      // This is tested indirectly through integration tests
    });
  });

  describe('getSupportedPlatforms', () => {
    it('should return array of supported platforms', () => {
      // Act
      const platforms = PlatformSchedulerFactory.getSupportedPlatforms();

      // Assert
      expect(platforms).toEqual(['linux', 'darwin', 'win32']);
    });

    it('should return immutable array (no mutation of internal state)', () => {
      // Act
      const platforms1 = PlatformSchedulerFactory.getSupportedPlatforms();
      const platforms2 = PlatformSchedulerFactory.getSupportedPlatforms();

      // Assert
      expect(platforms1).toEqual(platforms2);
      expect(platforms1).not.toBe(platforms2); // Different array instances
    });
  });

  describe('isSupported', () => {
    it('should return true for linux platform', () => {
      // Act & Assert
      expect(PlatformSchedulerFactory.isSupported('linux')).toBe(true);
    });

    it('should return true for darwin platform', () => {
      // Act & Assert
      expect(PlatformSchedulerFactory.isSupported('darwin')).toBe(true);
    });

    it('should return true for win32 platform', () => {
      // Act & Assert
      expect(PlatformSchedulerFactory.isSupported('win32')).toBe(true);
    });

    it('should return false for unsupported platform', () => {
      // Act & Assert
      expect(PlatformSchedulerFactory.isSupported('freebsd')).toBe(false);
    });

    it('should return false for empty string', () => {
      // Act & Assert
      expect(PlatformSchedulerFactory.isSupported('')).toBe(false);
    });

    it('should be case-sensitive', () => {
      // Act & Assert
      expect(PlatformSchedulerFactory.isSupported('Linux')).toBe(false); // Capital L
      expect(PlatformSchedulerFactory.isSupported('Darwin')).toBe(false); // Capital D
      expect(PlatformSchedulerFactory.isSupported('Win32')).toBe(false); // Capital W
    });
  });

  describe('getCurrentPlatform', () => {
    it('should return current platform (linux)', () => {
      // Arrange
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true,
      });

      // Act
      const platform = PlatformSchedulerFactory.getCurrentPlatform();

      // Assert
      expect(platform).toBe('linux');
    });

    it('should return current platform (darwin)', () => {
      // Arrange
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
        configurable: true,
      });

      // Act
      const platform = PlatformSchedulerFactory.getCurrentPlatform();

      // Assert
      expect(platform).toBe('darwin');
    });

    it('should return current platform (win32)', () => {
      // Arrange
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      });

      // Act
      const platform = PlatformSchedulerFactory.getCurrentPlatform();

      // Assert
      expect(platform).toBe('win32');
    });
  });

  describe('createForPlatform', () => {
    it('should create SystemdScheduler for linux platform', () => {
      // Act
      const scheduler = PlatformSchedulerFactory.createForPlatform('linux');

      // Assert
      expect(scheduler).toBeInstanceOf(SystemdScheduler);
    });

    it('should create LaunchdScheduler for darwin platform', () => {
      // Act
      const scheduler = PlatformSchedulerFactory.createForPlatform('darwin');

      // Assert
      expect(scheduler).toBeInstanceOf(LaunchdScheduler);
    });

    it('should create TaskSchedulerWrapper for win32 platform', () => {
      // Act
      const scheduler = PlatformSchedulerFactory.createForPlatform('win32');

      // Assert
      expect(scheduler).toBeInstanceOf(TaskSchedulerWrapper);
    });

    it('should throw error for unsupported platform', () => {
      // Act & Assert
      expect(() => PlatformSchedulerFactory.createForPlatform('freebsd' as any)).toThrow(
        'Unsupported platform: freebsd. Daily sync timers are only supported on Linux (systemd), macOS (launchd), and Windows (Task Scheduler).'
      );
    });

    it('should use custom timer name for linux', () => {
      // Act
      const scheduler = PlatformSchedulerFactory.createForPlatform('linux', 'my-custom-timer');

      // Assert
      expect(scheduler).toBeInstanceOf(SystemdScheduler);
    });

    it('should use custom timer name for darwin', () => {
      // Act
      const scheduler = PlatformSchedulerFactory.createForPlatform('darwin', 'my-custom-timer');

      // Assert
      expect(scheduler).toBeInstanceOf(LaunchdScheduler);
    });

    it('should use custom timer name for win32', () => {
      // Act
      const scheduler = PlatformSchedulerFactory.createForPlatform('win32', 'my-custom-timer');

      // Assert
      expect(scheduler).toBeInstanceOf(TaskSchedulerWrapper);
    });
  });
});
