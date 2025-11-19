/**
 * PlatformSchedulerFactory - Factory for creating platform-specific schedulers
 *
 * **RESPONSIBILITY (SRP):** Detect platform and instantiate appropriate ISyncScheduler implementation
 * **WHY:** Abstracts platform detection and scheduler selection logic into single factory
 * **PLATFORMS:** Linux (systemd), macOS (launchd), Windows (Task Scheduler)
 *
 * **DESIGN PATTERN:** Factory Method (GoF)
 * **PRINCIPLE:** Dependency Inversion (depend on ISyncScheduler abstraction, not concrete types)
 *
 * **USAGE:**
 * ```typescript
 * const scheduler = PlatformSchedulerFactory.create();
 * await scheduler.install('/path/to/daily-sync.sh', '05:00');
 * ```
 */

import type { ISyncScheduler } from './types';
import { SystemdScheduler } from './schedulers/systemd-scheduler';
import { LaunchdScheduler } from './schedulers/launchd-scheduler';
import { TaskSchedulerWrapper } from './schedulers/task-scheduler';

/**
 * Supported platform types for daily sync timers
 *
 * **MAPPING:**
 * - linux → SystemdScheduler
 * - darwin → LaunchdScheduler
 * - win32 → TaskSchedulerWrapper
 */
type SupportedPlatform = 'linux' | 'darwin' | 'win32';

/**
 * PlatformSchedulerFactory - Factory for platform-specific schedulers
 *
 * **STATIC CLASS:** All methods are static (no instantiation needed)
 */
export class PlatformSchedulerFactory {
  /**
   * Default timer name for code-executor-mcp daily sync
   *
   * **USAGE:** Used by all scheduler implementations unless overridden
   */
  private static readonly DEFAULT_TIMER_NAME = 'code-executor-mcp-sync';

  /**
   * List of supported platforms
   *
   * **IMMUTABILITY:** Private to prevent external modification
   */
  private static readonly SUPPORTED_PLATFORMS: SupportedPlatform[] = [
    'linux',
    'darwin',
    'win32',
  ];

  /**
   * Create scheduler for current platform
   *
   * **BEHAVIOR:**
   * - Detects current OS platform (process.platform)
   * - Instantiates appropriate ISyncScheduler implementation
   * - Throws error if platform unsupported
   *
   * **PLATFORMS:**
   * - linux → SystemdScheduler (systemd user timers)
   * - darwin → LaunchdScheduler (launchd user agents)
   * - win32 → TaskSchedulerWrapper (Windows Task Scheduler)
   *
   * @param timerName Optional custom timer name (default: 'code-executor-mcp-sync')
   * @returns ISyncScheduler Platform-specific scheduler instance
   * @throws Error if current platform is unsupported
   *
   * @example
   * const scheduler = PlatformSchedulerFactory.create();
   * await scheduler.install('/home/user/.code-executor/daily-sync.sh', '05:00');
   */
  static create(timerName?: string): ISyncScheduler {
    const platform = process.platform;

    // Validate platform first, then create (fail-fast principle)
    if (!this.isSupported(platform)) {
      throw new Error(
        `Unsupported platform: ${platform}. Daily sync timers are only supported on Linux (systemd), macOS (launchd), and Windows (Task Scheduler).`
      );
    }

    return this.createForPlatform(platform as SupportedPlatform, timerName);
  }

  /**
   * Create scheduler for specific platform
   *
   * **USAGE:** Useful for testing or explicit platform targeting
   *
   * @param platform Target platform (linux, darwin, win32)
   * @param timerName Optional custom timer name (default: 'code-executor-mcp-sync')
   * @returns ISyncScheduler Platform-specific scheduler instance
   * @throws Error if platform is unsupported
   *
   * @example
   * const scheduler = PlatformSchedulerFactory.createForPlatform('linux', 'my-timer');
   */
  static createForPlatform(
    platform: SupportedPlatform,
    timerName?: string
  ): ISyncScheduler {
    const name = timerName ?? this.DEFAULT_TIMER_NAME;

    switch (platform) {
      case 'linux':
        return new SystemdScheduler(name);
      case 'darwin':
        return new LaunchdScheduler(name);
      case 'win32':
        return new TaskSchedulerWrapper(name);
      default:
        throw new Error(
          `Unsupported platform: ${platform}. Daily sync timers are only supported on Linux (systemd), macOS (launchd), and Windows (Task Scheduler).`
        );
    }
  }

  /**
   * Get list of supported platforms
   *
   * **IMMUTABILITY:** Returns new array (prevents external modification)
   *
   * @returns string[] Array of supported platform identifiers
   *
   * @example
   * const platforms = PlatformSchedulerFactory.getSupportedPlatforms();
   * console.log(platforms); // ['linux', 'darwin', 'win32']
   */
  static getSupportedPlatforms(): string[] {
    return [...this.SUPPORTED_PLATFORMS]; // Return copy for immutability
  }

  /**
   * Check if platform is supported
   *
   * **USAGE:** Pre-flight check before creating scheduler
   *
   * @param platform Platform identifier to check
   * @returns boolean true if platform is supported, false otherwise
   *
   * @example
   * if (PlatformSchedulerFactory.isSupported('linux')) {
   *   const scheduler = PlatformSchedulerFactory.createForPlatform('linux');
   * }
   */
  static isSupported(platform: string): boolean {
    return this.SUPPORTED_PLATFORMS.includes(platform as SupportedPlatform);
  }

  /**
   * Get current platform identifier
   *
   * **USAGE:** Utility method for platform detection
   *
   * @returns string Current platform (process.platform)
   *
   * @example
   * const platform = PlatformSchedulerFactory.getCurrentPlatform();
   * console.log(`Running on: ${platform}`); // "Running on: linux"
   */
  static getCurrentPlatform(): NodeJS.Platform {
    return process.platform;
  }
}
