import { spawn } from 'child_process';

/**
 * SelfInstaller - Detects and installs code-executor-mcp globally
 *
 * Implements FR-0 (Self-Installation Bootstrap) from spec.md.
 * Wizard detects if package is globally installed and auto-installs if needed.
 *
 * @security
 * - Uses npm official commands (no shell eval)
 * - Inherits stdio for install progress visibility
 * - Provides remediation messages for permission errors
 */
export class SelfInstaller {
  private readonly packageName = 'code-executor-mcp';

  /**
   * Detects if code-executor-mcp is globally installed
   *
   * Uses `npm list -g` which is the official npm API for checking installations.
   * Cross-platform compatible (Linux, macOS, Windows).
   *
   * @returns true if package is globally installed, false otherwise
   */
  async detectGlobalInstall(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const npmProcess = spawn('npm', [
          'list',
          '-g',
          this.packageName,
          '--depth=0',
          '--json'
        ]);

        npmProcess.on('close', (code) => {
          // Exit code 0 = installed, non-zero = not installed
          resolve(code === 0);
        });

        npmProcess.on('error', (err) => {
          // npm not found or other spawn error
          console.warn(`npm detection failed: ${err.message}`);
          resolve(false);
        });
      } catch (error) {
        // Catch any unexpected errors
        console.warn(`Unexpected error during detection: ${error}`);
        resolve(false);
      }
    });
  }

  /**
   * Installs code-executor-mcp globally
   *
   * Runs `npm install -g code-executor-mcp` with inherited stdio for user visibility.
   * Handles permission errors (EACCES) with remediation message.
   *
   * @returns Promise resolving to { success: true } on success
   * @throws Error with remediation message on permission denial or installation failure
   */
  async installGlobally(): Promise<{ success: boolean }> {
    return new Promise((resolve, reject) => {
      // Only pipe stderr for error detection, inherit stdin/stdout for visibility
      const npmProcess = spawn('npm', ['install', '-g', this.packageName], {
        stdio: ['inherit', 'inherit', 'pipe']
      });

      let stderrOutput = '';

      // Capture stderr for EACCES detection
      npmProcess.stderr!.on('data', (data) => {
        const chunk = data.toString();
        stderrOutput += chunk;
        // Also write to stderr so user sees errors in real-time
        process.stderr.write(chunk);
      });

      npmProcess.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else if (code === 243 || stderrOutput.includes('EACCES')) {
          // Permission denied error
          reject(new Error(
            `Permission denied: Try running: sudo npm install -g ${this.packageName}
Or configure npm to use a user-writable directory: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally`
          ));
        } else {
          reject(new Error(
            `Installation failed with exit code ${code}. Check network connection and npm configuration.`
          ));
        }
      });

      npmProcess.on('error', (err) => {
        reject(new Error(`npm not found or failed to spawn: ${err.message}`));
      });
    });
  }

  /**
   * Runs bootstrap flow: detect → install if needed
   *
   * This is the main entry point called by the setup wizard.
   * Implements idempotent behavior (skips install if already present).
   *
   * @throws Error with remediation message if installation fails
   */
  async runBootstrap(): Promise<void> {
    console.log('🔍 Checking if code-executor-mcp is globally installed...');
    
    const isInstalled = await this.detectGlobalInstall();
    
    if (isInstalled) {
      console.log('✅ code-executor-mcp is already globally installed. Skipping installation.');
      return;
    }
    
    console.log('❌ code-executor-mcp is not globally installed.');
    console.log('📦 Installing globally...');
    
    try {
      await this.installGlobally();
      console.log('✅ Installation successful!');
    } catch (error) {
      console.error(`❌ Installation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }
}
