/**
 * SystemdScheduler - Linux systemd timer management for daily MCP wrapper sync
 *
 * **RESPONSIBILITY (SRP):** Manage systemd user-level timer units for scheduled tasks
 * **WHY:** Systemd is the standard init system on modern Linux distributions
 * **PLATFORM:** Linux only (Ubuntu, Fedora, Arch, Debian, RHEL, CentOS)
 *
 * **ARCHITECTURE:**
 * - Creates ~/.config/systemd/user/<timer-name>.timer (calendar scheduling)
 * - Creates ~/.config/systemd/user/<timer-name>.service (task execution)
 * - Uses systemctl --user commands (no sudo required)
 *
 * **SECURITY:**
 * - Path validation prevents directory traversal
 * - Time validation enforces 4-6 AM range
 * - User-level timers (no system-level elevation)
 */

import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import type { ISyncScheduler } from '../types';

export class SystemdScheduler implements ISyncScheduler {
  private readonly systemdUserDir: string;
  private readonly timerPath: string;
  private readonly servicePath: string;

  /**
   * Constructor
   *
   * **SECURITY:** Validates timerName to prevent path traversal
   *
   * @param timerName Timer unit name (e.g., 'code-executor-mcp-sync')
   * @throws Error if timerName contains invalid characters or path traversal
   */
  constructor(private readonly timerName: string) {
    // Validate timerName (alphanumeric, hyphens, underscores only)
    const validNameRegex = /^[a-zA-Z0-9_-]+$/;
    if (!validNameRegex.test(timerName)) {
      throw new Error(
        'timerName must contain only alphanumeric characters, hyphens, and underscores'
      );
    }

    this.systemdUserDir = path.join(os.homedir(), '.config', 'systemd', 'user');
    this.timerPath = path.join(this.systemdUserDir, `${timerName}.timer`);
    this.servicePath = path.join(this.systemdUserDir, `${timerName}.service`);

    // Verify no path traversal occurred
    if (!this.timerPath.startsWith(this.systemdUserDir)) {
      throw new Error('Path traversal detected in timerName');
    }
  }

  /**
   * Install daily sync timer
   *
   * **BEHAVIOR:**
   * 1. Validates scriptPath is absolute (security)
   * 2. Validates syncTime is 4-6 AM in HH:MM format
   * 3. Creates ~/.config/systemd/user/ directory if needed
   * 4. Writes .timer file with OnCalendar directive
   * 5. Writes .service file with ExecStart directive
   * 6. Runs systemctl --user daemon-reload
   * 7. Runs systemctl --user enable <timer>
   * 8. Runs systemctl --user start <timer>
   *
   * @param scriptPath Absolute path to daily sync script
   * @param syncTime Sync time in HH:MM format (4-6 AM range)
   * @throws Error if validation fails or systemctl commands fail
   */
  async install(scriptPath: string, syncTime: string): Promise<void> {
    // Validation: scriptPath must be absolute
    if (!path.isAbsolute(scriptPath)) {
      throw new Error('scriptPath must be absolute');
    }

    // Validation: scriptPath must not contain quotes or newlines (defense-in-depth)
    if (scriptPath.includes("'") || scriptPath.includes('"') || scriptPath.includes('\n')) {
      throw new Error('scriptPath contains invalid characters (quotes or newlines)');
    }

    // Validation: syncTime format (HH:MM)
    const timeRegex = /^(\d{2}):(\d{2})$/;
    const match = syncTime.match(timeRegex);
    if (!match) {
      throw new Error('syncTime must be in HH:MM format');
    }

    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);

    // Validation: syncTime must be 4-6 AM range
    if (hours < 4 || hours > 6 || (hours === 6 && minutes > 0)) {
      throw new Error('syncTime must be between 04:00 and 06:00');
    }

    // Create ~/.config/systemd/user/ directory if it doesn't exist
    await fs.mkdir(this.systemdUserDir, { recursive: true });

    // Generate .timer file content
    const timerContent = this.generateTimerContent(syncTime);
    await fs.writeFile(this.timerPath, timerContent, 'utf-8');

    // Generate .service file content
    const serviceContent = this.generateServiceContent(scriptPath);
    await fs.writeFile(this.servicePath, serviceContent, 'utf-8');

    // Reload systemd configuration
    await this.runSystemctl(['daemon-reload']);

    // Enable timer (start on boot)
    await this.runSystemctl(['enable', `${this.timerName}.timer`]);

    // Start timer immediately
    await this.runSystemctl(['start', `${this.timerName}.timer`]);
  }

  /**
   * Uninstall daily sync timer
   *
   * **BEHAVIOR:**
   * 1. Runs systemctl --user stop <timer>
   * 2. Runs systemctl --user disable <timer>
   * 3. Removes .timer file
   * 4. Removes .service file
   *
   * **RESILIENCE:** Does not throw if timer doesn't exist
   */
  async uninstall(): Promise<void> {
    // Stop timer (ignore errors if not running)
    try {
      await this.runSystemctl(['stop', `${this.timerName}.timer`]);
    } catch {
      // Timer may not be running - continue
    }

    // Disable timer (ignore errors if not enabled)
    try {
      await this.runSystemctl(['disable', `${this.timerName}.timer`]);
    } catch {
      // Timer may not be enabled - continue
    }

    // Remove .timer file
    try {
      await fs.unlink(this.timerPath);
    } catch {
      // File may not exist - continue
    }

    // Remove .service file
    try {
      await fs.unlink(this.servicePath);
    } catch {
      // File may not exist - continue
    }
  }

  /**
   * Check if daily sync timer is installed
   *
   * **BEHAVIOR:**
   * 1. Checks if .timer file exists
   * 2. Runs systemctl --user is-active <timer>
   * 3. Returns true if file exists AND timer is active
   *
   * @returns true if timer exists and is active
   */
  async exists(): Promise<boolean> {
    // Check if .timer file exists
    try {
      await fs.access(this.timerPath);
    } catch {
      return false; // File doesn't exist
    }

    // Check if timer is active
    try {
      const exitCode = await this.runSystemctl(['is-active', `${this.timerName}.timer`]);
      return exitCode === 0; // Exit code 0 = active
    } catch {
      return false; // Timer not active
    }
  }

  /**
   * Generate .timer file content
   *
   * **FORMAT:** systemd timer unit file
   * **REFERENCE:** systemd.timer(5) man page
   *
   * @param syncTime Sync time in HH:MM format
   * @returns Timer unit file content
   */
  private generateTimerContent(syncTime: string): string {
    return `[Unit]
Description=Daily MCP wrapper sync for code-executor-mcp
Documentation=https://github.com/aberemia24/code-executor-MCP

[Timer]
# Daily execution at specified time (e.g., 05:00)
OnCalendar=*-*-* ${syncTime}:00

# Add random delay (0-2 minutes) to prevent synchronized execution
RandomizedDelaySec=2min

# Timer accuracy (1 second precision)
AccuracySec=1s

# Don't catch up missed executions after system downtime
Persistent=false

[Install]
WantedBy=timers.target
`;
  }

  /**
   * Generate .service file content
   *
   * **FORMAT:** systemd service unit file
   * **REFERENCE:** systemd.service(5) man page
   *
   * **SECURITY:** No bash wrapper to prevent command injection
   * systemd executes scripts directly without shell interpretation
   *
   * @param scriptPath Absolute path to daily sync script
   * @returns Service unit file content
   */
  private generateServiceContent(scriptPath: string): string {
    return `[Unit]
Description=Code-executor-mcp daily wrapper sync service
After=network-online.target
Wants=network-online.target

[Service]
# Type=oneshot: Runs once and exits (perfect for scheduled tasks)
Type=oneshot

# Execute daily sync script directly (no shell wrapper - prevents injection)
ExecStart=${scriptPath}

# Log to systemd journal
StandardOutput=journal
StandardError=journal
`;
  }

  /**
   * Run systemctl --user command
   *
   * **WRAPPER:** Executes systemctl with --user flag
   * **ERROR HANDLING:** Throws if exit code !== 0
   *
   * @param args systemctl arguments (e.g., ['daemon-reload'])
   * @returns Promise<number> Exit code
   * @throws Error if command fails
   */
  private runSystemctl(args: string[]): Promise<number> {
    return new Promise((resolve, reject) => {
      const proc = spawn('systemctl', ['--user', ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0 && code !== 3) {
          // Exit code 3 = inactive (expected for is-active check)
          reject(new Error(`systemctl ${args.join(' ')} failed: ${stderr}`));
        } else {
          resolve(code ?? 0);
        }
      });

      proc.on('error', (error) => {
        reject(new Error(`Failed to run systemctl: ${error.message}`));
      });
    });
  }
}
