import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import AsyncLock from 'async-lock';

/**
 * PID-based lock file service for preventing concurrent wizard runs.
 *
 * Uses process ID (PID) to detect if lock is held by running process.
 * Automatically removes stale locks (process no longer exists or timeout exceeded).
 *
 * Security: Only checks process existence, does not validate ownership.
 * Timeout: Prevents infinite locks (default 1 hour).
 */
export class LockFileService {
  private lockPath: string;
  private timeout: number;
  private cleanupLock: AsyncLock;

  constructor(
    lockFile: string = path.join(os.homedir(), '.code-executor', 'wizard.lock'),
    timeoutMs: number = 1000 * 60 * 60  // 1 hour default
  ) {
    this.lockPath = lockFile;
    this.timeout = timeoutMs;
    this.cleanupLock = new AsyncLock();
  }

  /**
   * Acquire lock (blocks if held by running process, throws after 5s)
   *
   * Automatically removes stale locks:
   * - Process no longer exists (zombie lock)
   * - Lock older than timeout (hung process)
   *
   * @throws Error if lock held by running process for >5s
   */
  async acquire(): Promise<void> {
    const startTime = Date.now();

    while (true) {
      try {
        // Try to create lock file (wx flag = exclusive, fails if exists)
        await fs.mkdir(path.dirname(this.lockPath), { recursive: true });
        const handle = await fs.open(this.lockPath, 'wx');
        await handle.writeFile(`${process.pid}\n${Date.now()}`, 'utf-8');
        await handle.close();
        return;  // ✅ Lock acquired
      } catch (error: unknown) {
        // Lock exists (EEXIST) or other error - check if we can acquire it
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code !== 'EEXIST') {
          // Unexpected error (e.g., permissions) - rethrow
          throw error;
        }
        try {
          const content = await fs.readFile(this.lockPath, 'utf-8');
          const parts = content.trim().split('\n');

          // Validate lock file format (must be exactly 2 lines)
          if (parts.length !== 2 || !parts[0] || !parts[1]) {
            console.warn('⚠️  Lock file format invalid, removing');
            await this.release();
            continue;  // Retry
          }

          const pidStr = parts[0];
          const timestampStr = parts[1];
          const pidNum = parseInt(pidStr, 10);
          const timeMs = parseInt(timestampStr, 10);

          // Validate parsed numbers
          if (isNaN(pidNum) || isNaN(timeMs)) {
            console.warn('⚠️  Lock file contains invalid numbers, removing');
            await this.release();
            continue;  // Retry
          }

          // Use AsyncLock to prevent race conditions during cleanup
          await this.cleanupLock.acquire('cleanup', async () => {
            // Check if process still exists first
            if (!this.processExists(pidNum)) {
              // Process dead - remove zombie lock
              console.warn(`✓ Lock process ${pidNum} no longer running, removing lock`);
              await this.release();
              return;  // Will retry in outer loop
            }

            // Process still running - check if lock is stale (timeout exceeded)
            if (Date.now() - timeMs > this.timeout) {
              console.warn(`⚠️  Removing stale lock (>${this.timeout / 1000}s old)`);
              await this.release();
              return;  // Will retry in outer loop
            }
          });

          // Check if lock was removed by cleanup (file no longer exists)
          try {
            await fs.access(this.lockPath);
            // Lock still exists - process is running and lock is recent
          } catch {
            // Lock was removed - retry acquisition
            continue;
          }

          // Process still running and lock is recent - wait or throw
          const elapsed = Date.now() - startTime;
          if (elapsed > 5000) {
            throw new Error(
              `Lock held by process ${pidNum} (waited ${Math.round(elapsed / 1000)}s)`
            );
          }

          await this.sleep(100);
        } catch (readError: unknown) {
          const nodeReadError = readError as NodeJS.ErrnoException;
          if (nodeReadError.code === 'ENOENT') {
            // Lock removed between checks - retry
            continue;
          }
          // Lock file corrupted or can't be read - remove it
          console.warn('⚠️  Lock file corrupted, removing');
          await this.release();
          continue;  // Retry
        }
      }
    }
  }

  /**
   * Release lock (safe to call multiple times)
   */
  async release(): Promise<void> {
    try {
      await fs.unlink(this.lockPath);
    } catch {
      // Already released or doesn't exist - not an error
    }
  }

  /**
   * Check if process exists (signal 0 = existence check only)
   */
  private processExists(pid: number): boolean {
    try {
      process.kill(pid, 0);  // Signal 0 = check existence only
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sleep helper for retry loop
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Acquire lock for duration of callback (auto-release on completion/error)
   *
   * @param callback - Async function to execute with lock held
   * @returns Result of callback
   * @throws Error from callback or lock acquisition failure
   */
  async withLock<T>(callback: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await callback();
    } finally {
      await this.release();
    }
  }
}
