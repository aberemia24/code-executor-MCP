/**
 * Deno Availability Checker
 *
 * Checks if Deno is installed and available for TypeScript execution.
 * Used to gracefully fallback to Python-only mode if Deno is not found.
 */

import { spawn } from 'child_process';
import { getDenoPath } from './config.js';

let denoAvailable: boolean | null = null;
let denoVersion: string | null = null;

/**
 * Try to execute deno --version with a given path
 */
async function tryDenoPath(denoPath: string): Promise<{ success: boolean; version?: string }> {
  return new Promise((resolve) => {
    const proc = spawn(denoPath, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 && stdout) {
        // Parse version from output (e.g., "deno 2.0.0")
        const match = stdout.match(/deno\s+(\d+\.\d+\.\d+)/i);
        const version = match ? match[1] : 'unknown';
        resolve({ success: true, version });
      } else {
        resolve({ success: false });
      }
    });

    proc.on('error', () => {
      resolve({ success: false });
    });

    // Timeout after 2 seconds
    setTimeout(() => {
      proc.kill();
      resolve({ success: false });
    }, 2000);
  });
}

/**
 * Check if Deno is installed and available
 *
 * Tries multiple common locations before giving up.
 *
 * @returns Promise<boolean> - True if Deno is available, false otherwise
 */
export async function checkDenoAvailable(): Promise<boolean> {
  // Return cached result if already checked
  if (denoAvailable !== null) {
    return denoAvailable;
  }

  try {
    const configuredPath = getDenoPath();

    // Try paths in order of preference
    const pathsToTry = [
      configuredPath,  // Configured path (from env var or config)
      // Common installation locations
      process.env.HOME ? `${process.env.HOME}/.deno/bin/deno` : null,
      '/usr/local/bin/deno',
      '/usr/bin/deno',
      '/opt/homebrew/bin/deno',
      'deno',  // Finally try PATH
    ].filter((p): p is string => p !== null && p !== '');

    // Remove duplicates
    const uniquePaths = [...new Set(pathsToTry)];

    // Try each path until one works
    for (const path of uniquePaths) {
      const result = await tryDenoPath(path);
      if (result.success) {
        denoAvailable = true;
        denoVersion = result.version ?? null;
        return true;
      }
    }

    // None of the paths worked
    denoAvailable = false;
    return false;
  } catch {
    denoAvailable = false;
    return false;
  }
}

/**
 * Get Deno version string
 *
 * @returns string | null - Deno version or null if not available
 */
export function getDenoVersion(): string | null {
  return denoVersion;
}

/**
 * Get a helpful error message when Deno is not available
 */
export function getDenoInstallMessage(): string {
  return `
⚠️  Deno not found - TypeScript execution disabled

To enable TypeScript execution (executeTypescript tool):

1. Install Deno:
   curl -fsSL https://deno.land/install.sh | sh

2. Or use Docker deployment (Deno included):
   docker-compose up -d

Python execution (executePython tool) is still available.

For more info: https://deno.land/manual/getting_started/installation
`.trim();
}
