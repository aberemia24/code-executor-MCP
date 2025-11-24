/**
 * MCPDiscoveryService Tests
 *
 * **TDD PHASE:** RED (Failing Tests) → GREEN (Implementation)
 * **COVERAGE TARGET:** 90%+
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPDiscoveryService } from '../../src/cli/mcp-discovery.js';
import type { AIToolMetadata } from '../../src/cli/tool-registry.js';
import type { MCPServerConfig } from '../../src/cli/types.js';

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

// Mock child_process
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

// Mock prompts to avoid hanging tests
vi.mock('prompts', () => ({
  default: vi.fn(),
}));

import * as fs from 'node:fs/promises';
import { exec } from 'node:child_process';
import prompts from 'prompts';

describe('MCPDiscoveryService', () => {
  let service: MCPDiscoveryService;

  beforeEach(() => {
    service = new MCPDiscoveryService();
    vi.mocked(prompts).mockResolvedValue({ path: '' });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('scanToolConfig', () => {
    const mockTool: AIToolMetadata = {
      id: 'claude-code',
      name: 'Claude Code',
      description: 'Test tool',
      configPaths: { linux: '/home/user/.claude/.mcp.json' },
      website: 'https://code.claude.com',
    };

    it('should_extractMCPServers_when_validConfigFile', async () => {
      const mockConfig = {
        mcpServers: {
          filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
            env: {}
          },
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: { GITHUB_TOKEN: 'ghp_xxx' }
          }
        }
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const result = await service.scanToolConfig(mockTool);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: 'filesystem',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        env: {},
        sourceTool: 'claude-code',
      });
      expect(result[1]).toEqual({
        name: 'github',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: 'ghp_xxx' },
        sourceTool: 'claude-code',
      });
    });

    it('should_returnEmptyArray_when_configFileNotFound', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT: no such file'));

      const result = await service.scanToolConfig(mockTool);

      expect(result).toEqual([]);
    });

    it('should_returnEmptyArray_when_invalidJSON', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('{ invalid json }');

      const result = await service.scanToolConfig(mockTool);

      expect(result).toEqual([]);
    });

    it('should_returnEmptyArray_when_mcpServersKeyMissing', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ someOtherKey: 'value' }));

      const result = await service.scanToolConfig(mockTool);

      expect(result).toEqual([]);
    });

    it('should_skipInvalidServers_when_commandMissing', async () => {
      const mockConfig = {
        mcpServers: {
          valid: {
            command: 'node',
            args: ['server.js']
          },
          invalid: {
            // Missing command
            args: ['something']
          } as any
        }
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const result = await service.scanToolConfig(mockTool);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('valid');
    });

    it('should_useEmptyArray_when_argsNotProvided', async () => {
      const mockConfig = {
        mcpServers: {
          minimal: {
            command: 'node'
            // args not provided
          }
        }
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const result = await service.scanToolConfig(mockTool);

      expect(result).toHaveLength(1);
      expect(result[0].args).toEqual([]);
    });

    it('should_useEmptyObject_when_envNotProvided', async () => {
      const mockConfig = {
        mcpServers: {
          minimal: {
            command: 'node',
            args: ['server.js']
            // env not provided
          }
        }
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const result = await service.scanToolConfig(mockTool);

      expect(result).toHaveLength(1);
      expect(result[0].env).toBeUndefined();
    });

    it('should_includeSourceTool_when_extractingServers', async () => {
      const mockConfig = {
        mcpServers: {
          test: {
            command: 'node',
            args: []
          }
        }
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const result = await service.scanToolConfig(mockTool);

      expect(result[0].sourceTool).toBe('claude-code');
    });
  });

  describe('discoverMCPServers', () => {
    const mockTools: AIToolMetadata[] = [
      {
        id: 'claude-code',
        name: 'Claude Code',
        description: 'Test tool 1',
        configPaths: { linux: '/home/user/.claude/.mcp.json' },
        website: 'https://code.claude.com',
      },
      {
        id: 'cursor',
        name: 'Cursor',
        description: 'Test tool 2',
        configPaths: { linux: '/home/user/.cursor/.mcp.json' },
        website: 'https://cursor.sh',
      },
      {
        id: 'windsurf',
        name: 'Windsurf',
        description: 'Test tool 3',
        configPaths: { linux: '/home/user/.windsurf/.mcp.json' },
        website: 'https://windsurf.ai',
      }
    ];

    it('should_scanAllTools_when_multipleToolsProvided', async () => {
      const mockConfig1 = {
        mcpServers: {
          filesystem: { command: 'npx', args: ['fs-server'] }
        }
      };
      const mockConfig2 = {
        mcpServers: {
          github: { command: 'npx', args: ['gh-server'] }
        }
      };
      const mockConfig3 = {
        mcpServers: {
          linear: { command: 'node', args: ['linear.js'] }
        }
      };

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockConfig1))
        .mockResolvedValueOnce(JSON.stringify(mockConfig2))
        .mockResolvedValueOnce(JSON.stringify(mockConfig3));

      const result = await service.discoverMCPServers(mockTools);

      expect(result).toHaveLength(3);
      expect(result.map(s => s.name)).toContain('filesystem');
      expect(result.map(s => s.name)).toContain('github');
      expect(result.map(s => s.name)).toContain('linear');
    });

    it('should_mergeResults_when_multipleToolsHaveServers', async () => {
      const mockConfig = {
        mcpServers: {
          server1: { command: 'node', args: [] }
        }
      };

      // All tools return the same server
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const result = await service.discoverMCPServers(mockTools);

      expect(result).toHaveLength(3); // One from each tool
      expect(result[0].sourceTool).toBe('claude-code');
      expect(result[1].sourceTool).toBe('cursor');
      expect(result[2].sourceTool).toBe('windsurf');
    });

    it('should_handlePartialFailures_when_someToolConfigsMissing', async () => {
      const mockConfig = {
        mcpServers: {
          working: { command: 'node', args: [] }
        }
      };

      // First tool succeeds, second fails, third succeeds
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockConfig))
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockResolvedValueOnce(JSON.stringify(mockConfig));

      const result = await service.discoverMCPServers(mockTools);

      expect(result).toHaveLength(2); // Only successful scans
    });

    it('should_returnEmptyArray_when_noToolsProvided', async () => {
      const result = await service.discoverMCPServers([]);

      expect(result).toEqual([]);
      expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('should_returnEmptyArray_when_allToolsHaveNoServers', async () => {
      const emptyConfig = { mcpServers: {} };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(emptyConfig));

      const result = await service.discoverMCPServers(mockTools);

      expect(result).toEqual([]);
    });

    it('should_usePromiseAll_when_scanningMultipleTools', async () => {
      const mockConfig = {
        mcpServers: {
          test: { command: 'node', args: [] }
        }
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const startTime = Date.now();
      await service.discoverMCPServers(mockTools);
      const duration = Date.now() - startTime;

      // Parallel execution should be fast (< 100ms for mocked calls)
      expect(duration).toBeLessThan(100);
      expect(fs.readFile).toHaveBeenCalledTimes(3);
    });
  });

  describe('getConfigPath', () => {
    it('should_returnLinuxPath_when_platformIsLinux', () => {
      const tool: AIToolMetadata = {
        id: 'test',
        name: 'Test',
        description: 'Test',
        configPaths: {
          linux: '/home/user/.test/.mcp.json',
          darwin: '/Users/user/.test/.mcp.json',
          win32: 'C:\\Users\\user\\.test\\.mcp.json'
        },
        website: 'https://test.com'
      };

      const result = service.getConfigPath(tool, 'linux');

      expect(result).toBe('/home/user/.test/.mcp.json');
    });

    it('should_returnDarwinPath_when_platformIsMacOS', () => {
      const tool: AIToolMetadata = {
        id: 'test',
        name: 'Test',
        description: 'Test',
        configPaths: {
          linux: '/home/user/.test/.mcp.json',
          darwin: '/Users/user/.test/.mcp.json',
          win32: 'C:\\Users\\user\\.test\\.mcp.json'
        },
        website: 'https://test.com'
      };

      const result = service.getConfigPath(tool, 'darwin');

      expect(result).toBe('/Users/user/.test/.mcp.json');
    });

    it('should_returnWin32Path_when_platformIsWindows', () => {
      const tool: AIToolMetadata = {
        id: 'test',
        name: 'Test',
        description: 'Test',
        configPaths: {
          linux: '/home/user/.test/.mcp.json',
          darwin: '/Users/user/.test/.mcp.json',
          win32: 'C:\\Users\\user\\.test\\.mcp.json'
        },
        website: 'https://test.com'
      };

      const result = service.getConfigPath(tool, 'win32');

      expect(result).toBe('C:\\Users\\user\\.test\\.mcp.json');
    });

    it('should_throwError_when_platformPathNotDefined', () => {
      const tool: AIToolMetadata = {
        id: 'test',
        name: 'Test',
        description: 'Test',
        configPaths: {
          linux: '/home/user/.test/.mcp.json'
          // darwin and win32 missing
        },
        website: 'https://test.com'
      };

      expect(() => service.getConfigPath(tool, 'darwin')).toThrow('No config path defined');
    });
  });

  describe('pingServer', () => {
    const mockServer: MCPServerConfig = {
      name: 'filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      env: {},
      sourceTool: 'claude-code',
    };

    beforeEach(() => {
      // Reset exec mock before each test
      vi.mocked(exec).mockClear();
    });

    it('should_returnAvailable_when_commandExists', async () => {
      // Mock successful command check (which npx -> /usr/bin/npx)
      vi.mocked(exec).mockImplementation((cmd: string, callback: any) => {
        callback(null, '/usr/bin/npx\n', '');
        return {} as any;
      });

      const result = await service.pingServer(mockServer);

      expect(result.status).toBe('available');
      expect(result.server).toEqual(mockServer);
      expect(result.message).toContain('found at');
    });

    it('should_returnUnavailable_when_commandNotFound', async () => {
      // Mock command not found (which nonexistent -> exit code 1)
      vi.mocked(exec).mockImplementation((cmd: string, callback: any) => {
        callback(new Error('Command not found'), '', 'not found');
        return {} as any;
      });

      const result = await service.pingServer(mockServer);

      expect(result.status).toBe('unavailable');
      expect(result.message).toContain('not found');
    });

    it('should_checkCorrectCommand_when_validating', async () => {
      vi.mocked(exec).mockImplementation((cmd: string, callback: any) => {
        // Verify correct command was called
        expect(cmd).toMatch(/which npx|where npx/);
        callback(null, '/usr/bin/npx\n', '');
        return {} as any;
      });

      await service.pingServer(mockServer);
    });

    it('should_includeServerInResult_when_pinging', async () => {
      vi.mocked(exec).mockImplementation((cmd: string, callback: any) => {
        callback(null, '/usr/bin/npx\n', '');
        return {} as any;
      });

      const result = await service.pingServer(mockServer);

      expect(result.server).toEqual(mockServer);
      expect(result.server.name).toBe('filesystem');
      expect(result.server.command).toBe('npx');
    });
  });

  describe('pingAllServers', () => {
    const mockServers: MCPServerConfig[] = [
      {
        name: 'filesystem',
        command: 'npx',
        args: [],
        env: {},
        sourceTool: 'claude-code',
      },
      {
        name: 'github',
        command: 'node',
        args: [],
        env: {},
        sourceTool: 'cursor',
      },
      {
        name: 'linear',
        command: 'python',
        args: [],
        env: {},
        sourceTool: 'windsurf',
      }
    ];

    it('should_pingAllServers_when_multipleProvided', async () => {
      vi.mocked(exec).mockImplementation((cmd: string, callback: any) => {
        callback(null, '/usr/bin/something\n', '');
        return {} as any;
      });

      const results = await service.pingAllServers(mockServers);

      expect(results).toHaveLength(3);
    });

    it('should_returnAllStatuses_when_pingingMultiple', async () => {
      // First server: available, Second: unavailable, Third: available
      let callCount = 0;
      vi.mocked(exec).mockImplementation((cmd: string, callback: any) => {
        callCount++;
        if (callCount === 2) {
          callback(new Error('Not found'), '', 'not found');
        } else {
          callback(null, '/usr/bin/cmd\n', '');
        }
        return {} as any;
      });

      const results = await service.pingAllServers(mockServers);

      expect(results[0].status).toBe('available');
      expect(results[1].status).toBe('unavailable');
      expect(results[2].status).toBe('available');
    });

    it('should_usePromiseAll_when_pingingMultipleServers', async () => {
      vi.mocked(exec).mockImplementation((cmd: string, callback: any) => {
        callback(null, '/usr/bin/cmd\n', '');
        return {} as any;
      });

      const startTime = Date.now();
      await service.pingAllServers(mockServers);
      const duration = Date.now() - startTime;

      // Parallel execution should be fast (< 100ms for mocked calls)
      expect(duration).toBeLessThan(100);
    });

    it('should_returnEmptyArray_when_noServersProvided', async () => {
      const results = await service.pingAllServers([]);

      expect(results).toEqual([]);
    });

    it('should_preserveServerOrder_when_pinging', async () => {
      vi.mocked(exec).mockImplementation((cmd: string, callback: any) => {
        callback(null, '/usr/bin/cmd\n', '');
        return {} as any;
      });

      const results = await service.pingAllServers(mockServers);

      expect(results[0].server.name).toBe('filesystem');
      expect(results[1].server.name).toBe('github');
      expect(results[2].server.name).toBe('linear');
    });
  });
});
