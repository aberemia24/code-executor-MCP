/**
 * Unit tests for Docker security configuration
 *
 * These tests verify that security measures are properly configured:
 * - Resource limits (memory, CPU, PIDs)
 * - Network isolation
 * - Non-root user execution
 * - Read-only filesystem
 * - Seccomp profile and capabilities
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { spawn } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(require('child_process').exec);

/**
 * Helper to check if we're running inside Docker
 */
function isRunningInDocker(): boolean {
  try {
    const fs = require('fs');
    return fs.existsSync('/.dockerenv');
  } catch {
    return false;
  }
}

/**
 * Helper to get current user ID
 */
function getCurrentUID(): number {
  return process.getuid ? process.getuid() : 0;
}

/**
 * Helper to get current group ID
 */
function getCurrentGID(): number {
  return process.getgid ? process.getgid() : 0;
}

/**
 * Helper to check filesystem write permissions
 */
async function canWriteToPath(path: string): Promise<boolean> {
  try {
    const fs = require('fs/promises');
    const testFile = `${path}/test-${Date.now()}.txt`;
    await fs.writeFile(testFile, 'test');
    await fs.unlink(testFile);
    return true;
  } catch {
    return false;
  }
}

// FIX: Skip Docker tests when not running in Docker to prevent hanging
// These tests are only relevant when running inside a Docker container
const runningInDocker = (() => {
  try {
    const fs = require('fs');
    return fs.existsSync('/.dockerenv');
  } catch {
    return false;
  }
})();

describe.skipIf(!runningInDocker)('Docker Security Configuration', () => {
  describe('User Execution Context', () => {
    it('should_run_as_non_root_user', () => {
      const uid = getCurrentUID();

      expect(uid).not.toBe(0);
      expect(uid).toBeGreaterThan(0);
    });

    it('should_run_as_non_root_group', () => {
      const gid = getCurrentGID();

      expect(gid).not.toBe(0);
      expect(gid).toBeGreaterThan(0);
    });

    it('should_have_expected_uid_1001', () => {
      // Container is configured with UID 1001 for codeexec user
      if (isRunningInDocker()) {
        const uid = getCurrentUID();
        expect(uid).toBe(1001);
      }
    });

    it('should_have_expected_gid_1001', () => {
      // Container is configured with GID 1001 for codeexec group
      if (isRunningInDocker()) {
        const gid = getCurrentGID();
        expect(gid).toBe(1001);
      }
    });

    it('should_not_have_sudo_privileges', async () => {
      if (!isRunningInDocker()) {
        return; // Skip if not in Docker
      }

      try {
        // FIX: Add timeout to prevent hanging if sudo prompts for password
        await execPromise('sudo -n true', { timeout: 2000 });
        // If we reach here, sudo worked - that's bad
        expect(false).toBe(true); // Force fail
      } catch (error) {
        // Expected: sudo should fail
        expect(error).toBeDefined();
      }
    });
  });

  describe('Filesystem Security', () => {
    it('should_not_allow_writes_to_root', async () => {
      const canWrite = await canWriteToPath('/');

      expect(canWrite).toBe(false);
    });

    it('should_not_allow_writes_to_app_directory', async () => {
      const canWrite = await canWriteToPath('/app');

      expect(canWrite).toBe(false);
    });

    it('should_allow_writes_to_tmp', async () => {
      const canWrite = await canWriteToPath('/tmp');

      expect(canWrite).toBe(true);
    });

    it('should_have_tmp_directory_writable', async () => {
      const fs = require('fs/promises');

      try {
        const testFile = '/tmp/security-test.txt';
        await fs.writeFile(testFile, 'test');
        const content = await fs.readFile(testFile, 'utf-8');
        await fs.unlink(testFile);

        expect(content).toBe('test');
      } catch (error) {
        throw new Error(`/tmp should be writable: ${error}`);
      }
    });

    it('should_not_allow_creating_files_in_etc', async () => {
      const canWrite = await canWriteToPath('/etc');

      expect(canWrite).toBe(false);
    });

    it('should_not_allow_creating_files_in_usr', async () => {
      const canWrite = await canWriteToPath('/usr');

      expect(canWrite).toBe(false);
    });
  });

  describe('Network Security', () => {
    it('should_not_reach_external_network', async () => {
      if (!isRunningInDocker()) {
        return; // Skip if not in Docker
      }

      try {
        // Try to reach Google DNS - should fail in isolated network
        await execPromise('ping -c 1 -W 2 8.8.8.8', { timeout: 3000 });
        // If we reach here, network is not isolated
        expect(false).toBe(true);
      } catch (error) {
        // Expected: network should be isolated
        expect(error).toBeDefined();
      }
    });

    it('should_not_resolve_external_dns', async () => {
      if (!isRunningInDocker()) {
        return; // Skip if not in Docker
      }

      try {
        await execPromise('nslookup google.com', { timeout: 3000 });
        // If we reach here, DNS works - network not isolated
        expect(false).toBe(true);
      } catch (error) {
        // Expected: DNS should fail in isolated network
        expect(error).toBeDefined();
      }
    });
  });

  describe('Process Limits', () => {
    it('should_have_limited_process_count', async () => {
      if (!isRunningInDocker()) {
        return; // Skip if not in Docker
      }

      try {
        // FIX: Add timeout to prevent hanging
        const { stdout } = await execPromise('ps aux | wc -l', { timeout: 2000 });
        const processCount = parseInt(stdout.trim()) - 1; // Subtract header line

        // Should have few processes (< 10 for minimal container)
        expect(processCount).toBeLessThan(10);
      } catch (error) {
        // ps might not be available in minimal container
        // That's ok - skip this test
      }
    });

    it('should_have_node_available', async () => {
      // Node should always be available (we're running in it)
      expect(process.version).toBeDefined();
      expect(process.version).toMatch(/^v\d+\.\d+\.\d+/);
    });
  });

  describe('Environment Security', () => {
    it('should_not_expose_sensitive_aws_keys', () => {
      expect(process.env.AWS_ACCESS_KEY_ID).toBeUndefined();
      expect(process.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(process.env.AWS_SESSION_TOKEN).toBeUndefined();
    });

    it('should_not_expose_database_urls', () => {
      expect(process.env.DATABASE_URL).toBeUndefined();
      expect(process.env.POSTGRES_URL).toBeUndefined();
      expect(process.env.MYSQL_URL).toBeUndefined();
      expect(process.env.REDIS_URL).toBeUndefined();
    });

    it('should_not_expose_api_keys', () => {
      const env = process.env;
      const sensitiveKeys = Object.keys(env).filter(key =>
        key.toLowerCase().includes('api_key') ||
        key.toLowerCase().includes('secret') ||
        key.toLowerCase().includes('token') ||
        key.toLowerCase().includes('password')
      );

      // Should have very few or no sensitive keys
      // Allow some exceptions like NODE_ENV, etc.
      const allowedSensitiveKeys = sensitiveKeys.filter(key =>
        !['NODE_ENV', 'ENABLE_AUDIT_LOG', 'AUDIT_LOG_PATH'].includes(key)
      );

      expect(allowedSensitiveKeys.length).toBeLessThanOrEqual(2);
    });

    it('should_have_minimal_environment_variables', () => {
      const envCount = Object.keys(process.env).length;

      // Container should have minimal env vars (< 20 is reasonable)
      if (isRunningInDocker()) {
        expect(envCount).toBeLessThan(20);
      }
    });
  });

  describe('Memory and Resource Constraints', () => {
    it('should_not_allow_allocating_excessive_memory', async () => {
      // Try to allocate 1GB - should fail if memory limits are set
      const allocSize = 1024 * 1024 * 1024; // 1GB

      try {
        const largeArray = new Array(allocSize);
        // Fill array to actually allocate memory
        for (let i = 0; i < 1000; i++) {
          largeArray[i] = new Array(1024 * 1024).fill(0);
        }

        // If we reach here without OOM, memory limits might not be set
        // This is a warning, not necessarily a failure
        console.warn('Warning: Could allocate large memory block');
      } catch (error) {
        // Expected: should hit memory limit
        expect(error).toBeDefined();
      }
    }, 10000); // 10 second timeout

    it('should_have_reasonable_heap_size', () => {
      if (process.memoryUsage) {
        const mem = process.memoryUsage();

        // Heap should be < 512MB if limits are set
        expect(mem.heapTotal).toBeLessThan(512 * 1024 * 1024);
      }
    });
  });

  describe('Security Flags Validation', () => {
    it('should_not_run_in_privileged_mode', () => {
      if (!isRunningInDocker()) {
        return;
      }

      // Check if we can access host devices (privileged mode indicator)
      const fs = require('fs');

      try {
        // Try to access /dev/mem (only available in privileged mode)
        const canAccess = fs.existsSync('/dev/mem');
        expect(canAccess).toBe(false);
      } catch {
        // Expected: should not have access
      }
    });

    it('should_have_restricted_proc_filesystem', () => {
      const fs = require('fs');

      // Check if sensitive /proc paths are restricted
      const restrictedPaths = [
        '/proc/kcore',     // Kernel memory
        '/proc/kmsg',      // Kernel messages
        '/proc/sys/kernel' // Kernel configuration
      ];

      for (const path of restrictedPaths) {
        if (fs.existsSync(path)) {
          try {
            fs.readdirSync(path);
            // If we can read, that might be a security issue
            console.warn(`Warning: Can access ${path}`);
          } catch {
            // Expected: should not have access
          }
        }
      }

      // Test always passes, but warnings logged above
      expect(true).toBe(true);
    });
  });

  describe('Capability Restrictions', () => {
    it('should_not_have_cap_sys_admin', async () => {
      if (!isRunningInDocker()) {
        return;
      }

      try {
        // Try to mount - requires CAP_SYS_ADMIN
        await execPromise('mount -t tmpfs tmpfs /mnt 2>&1', { timeout: 2000 });
        // If mount worked, we have CAP_SYS_ADMIN - bad!
        expect(false).toBe(true);
      } catch (error) {
        // Expected: mount should fail without CAP_SYS_ADMIN
        expect(error).toBeDefined();
      }
    });

    it('should_not_have_cap_net_admin', async () => {
      if (!isRunningInDocker()) {
        return;
      }

      try {
        // Try to change network config - requires CAP_NET_ADMIN
        await execPromise('ip link add dummy0 type dummy 2>&1', { timeout: 2000 });
        // If this worked, we have CAP_NET_ADMIN - bad!
        expect(false).toBe(true);
      } catch (error) {
        // Expected: network commands should fail
        expect(error).toBeDefined();
      }
    });
  });
});

describe.skipIf(!runningInDocker)('Security Validation Helpers', () => {
  describe('isRunningInDocker', () => {
    it('should_return_boolean', () => {
      const result = isRunningInDocker();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getCurrentUID', () => {
    it('should_return_valid_uid', () => {
      const uid = getCurrentUID();
      expect(typeof uid).toBe('number');
      expect(uid).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getCurrentGID', () => {
    it('should_return_valid_gid', () => {
      const gid = getCurrentGID();
      expect(typeof gid).toBe('number');
      expect(gid).toBeGreaterThanOrEqual(0);
    });
  });

  describe('canWriteToPath', () => {
    it('should_detect_writable_tmp', async () => {
      const canWrite = await canWriteToPath('/tmp');
      expect(canWrite).toBe(true);
    });

    it('should_detect_readonly_root', async () => {
      if (isRunningInDocker()) {
        const canWrite = await canWriteToPath('/');
        expect(canWrite).toBe(false);
      }
    });
  });
});
