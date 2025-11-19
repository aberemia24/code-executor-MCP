/**
 * TaskSchedulerWrapper - Windows Task Scheduler management for daily MCP wrapper sync
 *
 * **RESPONSIBILITY (SRP):** Manage Windows scheduled tasks for daily execution
 * **WHY:** Task Scheduler is the standard scheduling system on Windows
 * **PLATFORM:** Windows only (Windows 10/11, Server 2016+)
 *
 * **ARCHITECTURE:**
 * - Uses PowerShell Register-ScheduledTask cmdlet
 * - Daily trigger with New-ScheduledTaskTrigger -Daily -At
 * - Script execution with New-ScheduledTaskAction -Execute PowerShell.exe
 *
 * **SECURITY:**
 * - Path validation prevents directory traversal
 * - taskName validation (alphanumeric, hyphens, underscores only)
 * - PowerShell execution with -NoProfile -File (no code injection)
 *
 * **WARNING:** Task creation REQUIRES admin elevation (UAC prompt)
 */

import { spawn } from 'child_process';
import * as path from 'path';
import type { ISyncScheduler } from '../types.js';

export class TaskSchedulerWrapper implements ISyncScheduler {
  /**
   * Constructor
   *
   * **SECURITY:** Validates taskName to prevent path traversal
   *
   * @param taskName Task identifier (e.g., 'CodeExecutorMCPSync')
   * @throws Error if taskName contains invalid characters or path traversal
   */
  constructor(private readonly taskName: string) {
    // Validate taskName (alphanumeric, hyphens, underscores only)
    const validNameRegex = /^[a-zA-Z0-9_-]+$/;
    if (!validNameRegex.test(taskName)) {
      throw new Error(
        'taskName must contain only alphanumeric characters, hyphens, and underscores'
      );
    }
  }

  /**
   * Install daily sync task
   *
   * **BEHAVIOR:**
   * 1. Validates scriptPath is absolute (security)
   * 2. Validates syncTime is 4-6 AM in HH:MM format
   * 3. Generates PowerShell script to create scheduled task
   * 4. Executes PowerShell with Register-ScheduledTask
   *
   * **WARNING:** Requires admin elevation (UAC prompt)
   *
   * @param scriptPath Absolute path to daily sync script
   * @param syncTime Sync time in HH:MM format (4-6 AM range)
   * @throws Error if validation fails or PowerShell commands fail
   */
  async install(scriptPath: string, syncTime: string): Promise<void> {
    // Validation: scriptPath must not contain quotes or newlines (defense-in-depth, CHECK FIRST)
    if (scriptPath.includes("'") || scriptPath.includes('"') || scriptPath.includes('\n')) {
      throw new Error('scriptPath contains invalid characters (quotes or newlines)');
    }

    // Validation: scriptPath must be absolute (Windows path)
    if (!path.isAbsolute(scriptPath)) {
      throw new Error('scriptPath must be absolute');
    }

    // Validation: syncTime format (HH:MM)
    const timeRegex = /^(\d{2}):(\d{2})$/;
    const match = syncTime.match(timeRegex);
    if (!match) {
      throw new Error('syncTime must be in HH:MM format');
    }

    const hours = parseInt(match[1]!, 10);
    const minutes = parseInt(match[2]!, 10);

    // Validation: syncTime must be 4-6 AM range (inclusive)
    if (hours < 4 || hours > 6 || (hours === 6 && minutes > 0)) {
      throw new Error('syncTime must be between 04:00 and 06:00 (inclusive)');
    }

    // Convert to PowerShell time format (5:00am)
    const psTime = `${hours}:${minutes.toString().padStart(2, '0')}am`;

    // Generate PowerShell script to create scheduled task
    const psScript = this.generatePowerShellInstallScript(scriptPath, psTime);

    // Execute PowerShell script
    await this.runPowerShell(psScript);
  }

  /**
   * Uninstall daily sync task
   *
   * **BEHAVIOR:**
   * 1. Runs PowerShell Unregister-ScheduledTask
   * 2. Suppresses confirmation prompt with -Confirm:$false
   *
   * **RESILIENCE:** Does not throw if task doesn't exist
   */
  async uninstall(): Promise<void> {
    // Generate PowerShell script to unregister task
    const psScript = `
      # Unregister task (suppress confirmation)
      $ErrorActionPreference = 'Stop'
      try {
        Unregister-ScheduledTask -TaskName "${this.taskName}" -Confirm:$false
        Write-Output "Task unregistered successfully"
      } catch {
        # Task may not exist - not an error
        Write-Output "Task does not exist or already unregistered"
      }
    `;

    // Execute PowerShell script (don't throw on errors)
    try {
      await this.runPowerShell(psScript);
    } catch {
      // Task may not exist - ignore errors
    }
  }

  /**
   * Check if daily sync task is installed
   *
   * **BEHAVIOR:**
   * 1. Runs PowerShell Get-ScheduledTask
   * 2. Returns true if task exists and is not null
   *
   * @returns true if task exists
   */
  async exists(): Promise<boolean> {
    const psScript = `
      # Check if task exists
      $ErrorActionPreference = 'Stop'
      try {
        $task = Get-ScheduledTask -TaskName "${this.taskName}" -ErrorAction Stop
        if ($task) {
          Write-Output "EXISTS"
        } else {
          Write-Output "NOT_FOUND"
        }
      } catch {
        Write-Output "NOT_FOUND"
      }
    `;

    try {
      const output = await this.runPowerShell(psScript);
      return output.includes('EXISTS');
    } catch {
      return false;
    }
  }

  /**
   * Generate PowerShell script to install scheduled task
   *
   * **SECURITY:**
   * - Uses -NoProfile -File to execute script (no code injection)
   * - Escapes scriptPath for PowerShell (double quotes → double-double quotes)
   * - No shell interpretation of script path
   *
   * @param scriptPath Absolute path to daily sync script
   * @param psTime PowerShell time format (e.g., '5:00am')
   * @returns PowerShell script string
   */
  private generatePowerShellInstallScript(scriptPath: string, psTime: string): string {
    // Escape scriptPath for PowerShell (double quotes → double-double quotes)
    const escapedPath = scriptPath.replace(/"/g, '""');

    return `
      # Create scheduled task for daily sync
      $ErrorActionPreference = 'Stop'

      # Define trigger (daily at specified time)
      $trigger = New-ScheduledTaskTrigger -Daily -At ${psTime}

      # Define action (run PowerShell script)
      $action = New-ScheduledTaskAction \\
        -Execute "PowerShell.exe" \\
        -Argument "-NoProfile -File \\"${escapedPath}\\""

      # Define principal (current user, limited privileges)
      $principal = New-ScheduledTaskPrincipal \\
        -UserId $env:USERNAME \\
        -RunLevel Limited

      # Register task (force overwrite if exists)
      Register-ScheduledTask \\
        -TaskName "${this.taskName}" \\
        -Trigger $trigger \\
        -Action $action \\
        -Principal $principal \\
        -Force | Out-Null

      Write-Output "Task registered successfully"
    `;
  }

  /**
   * Run PowerShell command
   *
   * **WRAPPER:** Executes powershell.exe with error handling
   * **ERROR HANDLING:** Throws if exit code !== 0
   *
   * @param script PowerShell script content
   * @returns Promise<string> stdout output
   * @throws Error if command fails
   */
  private runPowerShell(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        script,
      ], {
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
          const errorMsg = `PowerShell command failed (exit ${code}): ${stderr.trim() || stdout.trim()}`;
          reject(new Error(errorMsg));
        } else {
          resolve(stdout);
        }
      });

      proc.on('error', (error) => {
        // Spawn failed - powershell.exe not found
        reject(new Error(`Failed to execute PowerShell: ${error.message}. Is PowerShell installed?`));
      });
    });
  }
}
