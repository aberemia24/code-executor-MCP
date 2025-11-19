import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { SelfInstaller } from '../../src/cli/self-installer';
import { spawn } from 'child_process';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn()
}));

describe('SelfInstaller - detectGlobalInstall', () => {
  let selfInstaller: SelfInstaller;

  beforeEach(() => {
    selfInstaller = new SelfInstaller();
    vi.clearAllMocks();
  });

  test('should_returnTrue_when_packageGloballyInstalled', async () => {
    // Mock npm list -g returning success (exit code 0)
    const mockProcess = {
      stdout: { on: vi.fn((event, handler) => {
        if (event === 'data') {
          handler(JSON.stringify({
            dependencies: {
              'code-executor-mcp': { version: '0.8.1' }
            }
          }));
        }
      })},
      stderr: { on: vi.fn() },
      on: vi.fn((event, handler) => {
        if (event === 'close') handler(0); // Exit code 0 = installed
      })
    };
    
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    const result = await selfInstaller.detectGlobalInstall();
    
    expect(result).toBe(true);
    expect(spawn).toHaveBeenCalledWith('npm', ['list', '-g', 'code-executor-mcp', '--depth=0', '--json']);
  });

  test('should_returnFalse_when_packageNotInstalled', async () => {
    // Mock npm list -g returning failure (exit code non-zero)
    const mockProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn((event, handler) => {
        if (event === 'data') handler('empty');
      })},
      on: vi.fn((event, handler) => {
        if (event === 'close') handler(1); // Exit code 1 = not found
      })
    };
    
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    const result = await selfInstaller.detectGlobalInstall();
    
    expect(result).toBe(false);
  });

  test('should_returnFalse_when_npmCommandFails', async () => {
    // Mock npm command error (e.g., npm not in PATH)
    const mockProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event, handler) => {
        if (event === 'error') handler(new Error('ENOENT: npm not found'));
      })
    };
    
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    const result = await selfInstaller.detectGlobalInstall();
    
    expect(result).toBe(false);
  });

  test('should_returnFalse_when_unexpectedSyncErrorOccurs', async () => {
    // Mock spawn throwing synchronous error
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error('Unexpected synchronous spawn error');
    });

    const result = await selfInstaller.detectGlobalInstall();

    expect(result).toBe(false);
  });
});

describe('SelfInstaller - installGlobally', () => {
  let selfInstaller: SelfInstaller;

  beforeEach(() => {
    selfInstaller = new SelfInstaller();
    vi.clearAllMocks();
  });

  test('should_installSuccessfully_when_permissionsValid', async () => {
    // Mock npm install -g succeeding
    const mockProcess = {
      stdout: { on: vi.fn((event, handler) => {
        if (event === 'data') handler('+ code-executor-mcp@0.8.1\ninstalled successfully');
      })},
      stderr: { on: vi.fn() },
      on: vi.fn((event, handler) => {
        if (event === 'close') handler(0); // Exit code 0 = success
      })
    };
    
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    const result = await selfInstaller.installGlobally();

    expect(result.success).toBe(true);
    expect(spawn).toHaveBeenCalledWith('npm', ['install', '-g', 'code-executor-mcp'], {
      stdio: ['inherit', 'inherit', 'pipe'] // Only pipe stderr for error detection
    });
  });

  test('should_throwPermissionError_when_eaccesReturned', async () => {
    // Mock npm install -g failing with permission error
    const mockProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn((event, handler) => {
        if (event === 'data') handler('EACCES: permission denied');
      })},
      on: vi.fn((event, handler) => {
        if (event === 'close') handler(243); // Exit code 243 = EACCES
      })
    };
    
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    await expect(selfInstaller.installGlobally()).rejects.toThrow('Permission denied');
  });

  test('should_throwError_when_installFails', async () => {
    // Mock npm install -g failing
    const mockProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn((event, handler) => {
        if (event === 'data') handler('Network error: ETIMEDOUT');
      })},
      on: vi.fn((event, handler) => {
        if (event === 'close') handler(1); // Exit code 1 = failure
      })
    };
    
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    await expect(selfInstaller.installGlobally()).rejects.toThrow('Installation failed');
  });

  test('should_throwError_when_npmSpawnErrorOccurs', async () => {
    // Mock spawn error event
    const mockProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event, handler) => {
        if (event === 'error') handler(new Error('ENOENT: npm not found'));
      })
    };

    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    await expect(selfInstaller.installGlobally()).rejects.toThrow('npm not found');
  });
});

describe('SelfInstaller - runBootstrap', () => {
  let selfInstaller: SelfInstaller;

  beforeEach(() => {
    selfInstaller = new SelfInstaller();
    vi.clearAllMocks();
  });

  test('should_skipInstall_when_alreadyInstalled', async () => {
    // Mock detectGlobalInstall returning true
    vi.spyOn(selfInstaller, 'detectGlobalInstall').mockResolvedValue(true);
    const installSpy = vi.spyOn(selfInstaller, 'installGlobally');

    await selfInstaller.runBootstrap();
    
    expect(installSpy).not.toHaveBeenCalled();
  });

  test('should_install_when_notInstalled', async () => {
    // Mock detectGlobalInstall returning false
    vi.spyOn(selfInstaller, 'detectGlobalInstall').mockResolvedValue(false);
    vi.spyOn(selfInstaller, 'installGlobally').mockResolvedValue({ success: true });

    await selfInstaller.runBootstrap();
    
    expect(selfInstaller.installGlobally).toHaveBeenCalled();
  });

  test('should_showRemediationMessage_when_permissionDenied', async () => {
    // Mock detectGlobalInstall returning false
    vi.spyOn(selfInstaller, 'detectGlobalInstall').mockResolvedValue(false);
    vi.spyOn(selfInstaller, 'installGlobally').mockRejectedValue(
      new Error('Permission denied: Try running: sudo npm install -g code-executor-mcp')
    );

    await expect(selfInstaller.runBootstrap()).rejects.toThrow('Permission denied');
  });

  test('should_handleNonErrorThrow_when_unexpectedValueThrown', async () => {
    // Mock detectGlobalInstall returning false
    vi.spyOn(selfInstaller, 'detectGlobalInstall').mockResolvedValue(false);
    // Throw a non-Error object (string)
    vi.spyOn(selfInstaller, 'installGlobally').mockRejectedValue('String error instead of Error object');

    await expect(selfInstaller.runBootstrap()).rejects.toBe('String error instead of Error object');
  });
});
