/**
 * LaunchdScheduler - macOS launchd agent management for daily MCP wrapper sync
 *
 * **RESPONSIBILITY (SRP):** Manage launchd user-level agents for scheduled tasks
 * **WHY:** launchd is the standard init system on macOS
 * **PLATFORM:** macOS only (10.10+)
 *
 * **ARCHITECTURE:**
 * - Creates ~/Library/LaunchAgents/<agent-name>.plist (XML property list)
 * - Uses StartCalendarInterval for daily execution (Hour + Minute keys)
 * - Uses launchctl bootstrap/bootout commands (modern syntax)
 *
 * **SECURITY:**
 * - Path validation prevents directory traversal
 * - agentName validation enforces reverse DNS notation
 * - No shell interpretation in Program key (prevents injection)
 */

import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import type { ISyncScheduler } from '../types';

export class LaunchdScheduler implements ISyncScheduler {
  private readonly launchAgentsDir: string;
  private readonly plistPath: string;

  /**
   * Constructor
   *
   * **SECURITY:** Validates agentName to prevent path traversal
   *
   * @param agentName Agent identifier in reverse DNS notation (e.g., 'com.example.app.sync')
   * @throws Error if agentName contains invalid characters or path traversal
   */
  constructor(private readonly agentName: string) {
    // Validate agentName (alphanumeric, hyphens, underscores, dots for reverse DNS)
    const validNameRegex = /^[a-zA-Z0-9_.-]+$/;
    if (!validNameRegex.test(agentName)) {
      throw new Error(
        'agentName must contain only alphanumeric characters, hyphens, underscores, and dots'
      );
    }

    this.launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    this.plistPath = path.join(this.launchAgentsDir, `${agentName}.plist`);

    // Verify no path traversal occurred
    if (!this.plistPath.startsWith(this.launchAgentsDir)) {
      throw new Error('Path traversal detected in agentName');
    }
  }

  /**
   * Install daily sync agent
   *
   * **BEHAVIOR:**
   * 1. Validates scriptPath is absolute (security)
   * 2. Validates syncTime is 4-6 AM in HH:MM format
   * 3. Creates ~/Library/LaunchAgents/ directory if needed
   * 4. Writes .plist file with StartCalendarInterval
   * 5. Runs launchctl bootstrap to load agent
   *
   * @param scriptPath Absolute path to daily sync script
   * @param syncTime Sync time in HH:MM format (4-6 AM range)
   * @throws Error if validation fails or launchctl commands fail
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

    // Validation: syncTime must be 4-6 AM range (inclusive)
    if (hours < 4 || hours > 6 || (hours === 6 && minutes > 0)) {
      throw new Error('syncTime must be between 04:00 and 06:00 (inclusive)');
    }

    // Create ~/Library/LaunchAgents/ directory if it doesn't exist
    await fs.mkdir(this.launchAgentsDir, { recursive: true });

    // Generate .plist file content
    const plistContent = this.generatePlistContent(scriptPath, hours, minutes);
    await fs.writeFile(this.plistPath, plistContent, 'utf-8');

    // Load agent using launchctl bootstrap (modern syntax)
    await this.runLaunchctl(['bootstrap', `gui/${os.userInfo().uid}`, this.plistPath]);
  }

  /**
   * Uninstall daily sync agent
   *
   * **BEHAVIOR:**
   * 1. Runs launchctl bootout to unload agent
   * 2. Removes .plist file
   *
   * **RESILIENCE:** Does not throw if agent doesn't exist
   */
  async uninstall(): Promise<void> {
    // Unload agent using launchctl bootout (ignore errors if not loaded)
    try {
      await this.runLaunchctl(['bootout', `gui/${os.userInfo().uid}/${this.agentName}`]);
    } catch {
      // Agent may not be loaded - continue
    }

    // Remove .plist file
    try {
      await fs.unlink(this.plistPath);
    } catch {
      // File may not exist - continue
    }
  }

  /**
   * Check if daily sync agent is installed
   *
   * **BEHAVIOR:**
   * 1. Checks if .plist file exists
   * 2. Runs launchctl print to verify agent is loaded
   * 3. Returns true if file exists AND agent is loaded
   *
   * @returns true if agent exists and is loaded
   */
  async exists(): Promise<boolean> {
    // Check if .plist file exists
    try {
      await fs.access(this.plistPath);
    } catch {
      return false; // File doesn't exist
    }

    // Check if agent is loaded
    try {
      await this.runLaunchctl(['print', `gui/${os.userInfo().uid}/${this.agentName}`]);
      return true; // Agent is loaded
    } catch {
      return false; // Agent not loaded
    }
  }

  /**
   * Generate .plist file content
   *
   * **FORMAT:** XML property list (Apple plist DTD)
   * **REFERENCE:** launchd.plist(5) man page
   *
   * **SECURITY:** No shell wrapper - launchd executes Program directly
   *
   * @param scriptPath Absolute path to daily sync script
   * @param hours Hour in 24-hour format (0-23)
   * @param minutes Minute (0-59)
   * @returns plist XML content
   */
  private generatePlistContent(scriptPath: string, hours: number, minutes: number): string {
    const logDir = path.join(os.homedir(), 'Library', 'Logs');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${this.agentName}</string>

    <key>Program</key>
    <string>${scriptPath}</string>

    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>${hours}</integer>
        <key>Minute</key>
        <integer>${minutes}</integer>
    </dict>

    <key>StandardOutPath</key>
    <string>${logDir}/code-executor-mcp-sync.log</string>

    <key>StandardErrorPath</key>
    <string>${logDir}/code-executor-mcp-sync-error.log</string>
</dict>
</plist>
`;
  }

  /**
   * Run launchctl command
   *
   * **WRAPPER:** Executes launchctl with error handling
   * **ERROR HANDLING:** Throws if exit code !== 0
   *
   * @param args launchctl arguments (e.g., ['bootstrap', 'gui/501', '/path'])
   * @returns Promise<number> Exit code
   * @throws Error if command fails
   */
  private runLaunchctl(args: string[]): Promise<number> {
    return new Promise((resolve, reject) => {
      const proc = spawn('launchctl', args, {
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
        if (code !== 0) {
          const errorMsg = `launchctl ${args.join(' ')} failed (exit ${code}): ${stderr.trim() || stdout.trim()}`;
          reject(new Error(errorMsg));
        } else {
          resolve(code ?? 0);
        }
      });

      proc.on('error', (error) => {
        // Spawn failed - launchctl not found or permission denied
        reject(new Error(`Failed to execute launchctl: ${error.message}. Is launchd available?`));
      });
    });
  }
}
