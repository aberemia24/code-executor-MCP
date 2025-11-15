/**
 * Tests for ConfigDiscoveryService
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigDiscoveryService } from '../src/config-discovery.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';

// Mock fs/promises
vi.mock('fs/promises');

describe('ConfigDiscoveryService', () => {
  let service: ConfigDiscoveryService;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    service = new ConfigDiscoveryService();
    service.clearCache();
    originalEnv = { ...process.env };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('findConfig', () => {
    it('should_use_defaults_when_no_config_files_exist', async () => {
      // Mock all config files as non-existent
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT: no such file'));

      const config = await service.findConfig();

      expect(config.version).toBe(1);
      expect(config.mcpConfigPath).toBe('./.mcp.json');
      // Security is optional - may be undefined when no config files exist
      expect(config.security).toBeUndefined();
    });

    it('should_load_project_level_config', async () => {
      const projectConfig = JSON.stringify({
        version: 1,
        security: {
          allowRead: ['/project/path'],
          enableAuditLog: true,
        },
      });

      vi.mocked(fs.readFile).mockResolvedValueOnce(projectConfig);

      const config = await service.findConfig();

      expect(config.security?.allowRead).toEqual(['/project/path']);
      expect(config.security?.enableAuditLog).toBe(true);
    });

    it('should_handle_invalid_json_gracefully', async () => {
      // First file has invalid JSON
      vi.mocked(fs.readFile)
        .mockRejectedValueOnce(new Error('Unexpected token'))
        .mockRejectedValueOnce(new Error('ENOENT'));

      const config = await service.findConfig();

      // Should fall back to defaults
      expect(config.version).toBe(1);
    });

    it('should_use_explicit_config_path_from_env', async () => {
      process.env.CODE_EXECUTOR_CONFIG_PATH = '/custom/config.json';

      const customConfig = JSON.stringify({
        version: 1,
        security: { allowRead: ['/custom/path'] },
      });

      vi.mocked(fs.readFile).mockResolvedValueOnce(customConfig);

      const config = await service.findConfig();

      expect(config.security?.allowRead).toEqual(['/custom/path']);
      expect(fs.readFile).toHaveBeenCalledWith(
        path.resolve('/custom/config.json'),
        'utf-8'
      );
    });

    it('should_cache_config_after_first_load', async () => {
      const projectConfig = JSON.stringify({
        version: 1,
        security: { allowRead: ['/project'] },
      });

      // Service searches all 3 config paths to merge configs
      // First call: 3 searches (project, home, XDG)
      // Second call: uses cache, no additional searches
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(projectConfig) // Project config
        .mockRejectedValueOnce(new Error('ENOENT')) // Home config
        .mockRejectedValueOnce(new Error('ENOENT')); // XDG config

      const config1 = await service.findConfig();
      const config2 = await service.findConfig();

      expect(config1).toBe(config2); // Same object reference
      // First call searches 3 paths, second call uses cache
      expect(fs.readFile).toHaveBeenCalledTimes(3);
    });

    it('should_apply_environment_variable_overrides', async () => {
      process.env.ALLOWED_PROJECTS = '/env/path1:/env/path2';
      process.env.ENABLE_AUDIT_LOG = 'true';
      process.env.AUDIT_LOG_PATH = '/env/audit.log';

      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const config = await service.findConfig();

      expect(config.security?.allowRead).toEqual(['/env/path1', '/env/path2']);
      expect(config.security?.enableAuditLog).toBe(true);
      expect(config.security?.auditLogPath).toBe('/env/audit.log');
    });

    it('should_resolve_env_references_in_config', async () => {
      process.env.PROJECT_ROOT = '/home/user/project';
      process.env.LOG_PATH = '/var/log/executor.log';

      const configWithEnvRefs = JSON.stringify({
        version: 1,
        security: {
          allowRead: ['env:PROJECT_ROOT'],
          auditLogPath: 'env:LOG_PATH',
        },
      });

      vi.mocked(fs.readFile).mockResolvedValueOnce(configWithEnvRefs);

      const config = await service.findConfig();

      expect(config.security?.allowRead).toEqual(['/home/user/project']);
      expect(config.security?.auditLogPath).toBe('/var/log/executor.log');
    });

    it('should_skip_config_file_with_missing_env_variable_reference', async () => {
      const configWithMissingEnv = JSON.stringify({
        version: 1,
        security: {
          allowRead: ['env:NONEXISTENT_VAR'],
        },
      });

      // First file has missing env var, so it's skipped
      // All other files don't exist, so defaults are used
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(configWithMissingEnv)
        .mockRejectedValue(new Error('ENOENT'));

      // Should not throw, just skip the invalid config and use defaults
      const config = await service.findConfig();
      expect(config.version).toBe(1);
      expect(config.security).toBeUndefined(); // No valid security config
    });

    it('should_merge_multiple_config_files_with_priority', async () => {
      const userConfig = JSON.stringify({
        version: 1,
        security: {
          allowRead: ['/user/path'],
          enableAuditLog: false,
        },
      });

      const projectConfig = JSON.stringify({
        version: 1,
        security: {
          allowRead: ['/project/path'], // Should override user config
        },
      });

      // First call (project level) succeeds, second (user level) succeeds, third (XDG) fails
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(projectConfig)
        .mockResolvedValueOnce(userConfig)
        .mockRejectedValueOnce(new Error('ENOENT'));

      const config = await service.findConfig();

      // Project config has higher priority
      expect(config.security?.allowRead).toEqual(['/project/path']);
      // User config value preserved (not overridden)
      expect(config.security?.enableAuditLog).toBe(false);
    });
  });

  describe('findMCPConfig', () => {
    it('should_use_explicit_mcp_config_path_from_env', async () => {
      process.env.MCP_CONFIG_PATH = '/custom/mcp.json';

      vi.mocked(fs.access).mockResolvedValue(undefined);

      const mcpPath = await service.findMCPConfig();

      expect(mcpPath).toBe(path.resolve('/custom/mcp.json'));
    });

    it('should_search_default_locations_for_mcp_config', async () => {
      // No env var set
      delete process.env.MCP_CONFIG_PATH;

      // Mock config with no mcpConfigPath
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      // First location (.mcp.json) exists
      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined) // .mcp.json exists
        .mockRejectedValue(new Error('ENOENT')); // others don't

      const mcpPath = await service.findMCPConfig();

      expect(mcpPath).toBe(path.resolve('./.mcp.json'));
    });

    it('should_use_config_mcpConfigPath_if_available', async () => {
      const configWithMcpPath = JSON.stringify({
        version: 1,
        mcpConfigPath: '/custom/from/config/mcp.json',
      });

      vi.mocked(fs.readFile).mockResolvedValueOnce(configWithMcpPath);
      vi.mocked(fs.access).mockResolvedValue(undefined);

      const mcpPath = await service.findMCPConfig();

      expect(mcpPath).toBe(path.resolve('/custom/from/config/mcp.json'));
    });

    it('should_return_default_mcp_json_if_none_found', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      const mcpPath = await service.findMCPConfig();

      expect(mcpPath).toBe(path.resolve('./.mcp.json'));
    });

    it('should_check_claude_json_global_location', async () => {
      // No config files for findConfig() to load
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const claudeJsonPath = path.join(homedir(), '.claude.json');

      // Mock fs.access for fileExists checks:
      // 1. config.mcpConfigPath (.mcp.json from defaults) - doesn't exist
      // 2. First search path (.mcp.json) - doesn't exist
      // 3. Second search path (~/.claude.json) - exists
      vi.mocked(fs.access)
        .mockRejectedValueOnce(new Error('ENOENT')) // config.mcpConfigPath check
        .mockRejectedValueOnce(new Error('ENOENT')) // .mcp.json search
        .mockResolvedValueOnce(undefined); // ~/.claude.json exists

      const mcpPath = await service.findMCPConfig();

      expect(mcpPath).toBe(path.resolve(claudeJsonPath));
    });

    it('should_check_claude_code_default_location', async () => {
      // No config files for findConfig() to load
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const claudeCodePath = path.join(
        homedir(),
        '.config',
        'claude-code',
        'mcp.json'
      );

      // Mock fs.access for fileExists checks:
      // 1. config.mcpConfigPath (.mcp.json from defaults) - doesn't exist
      // 2. First search path (.mcp.json) - doesn't exist
      // 3. Second search path (~/.claude.json) - doesn't exist
      // 4. Third search path (claude-code) - exists
      vi.mocked(fs.access)
        .mockRejectedValueOnce(new Error('ENOENT')) // config.mcpConfigPath check
        .mockRejectedValueOnce(new Error('ENOENT')) // .mcp.json search
        .mockRejectedValueOnce(new Error('ENOENT')) // ~/.claude.json search
        .mockResolvedValueOnce(undefined); // claude-code location exists

      const mcpPath = await service.findMCPConfig();

      expect(mcpPath).toBe(path.resolve(claudeCodePath));
    });
  });

  describe('clearCache', () => {
    it('should_clear_cached_config', async () => {
      const config1Json = JSON.stringify({
        version: 1,
        security: { allowRead: ['/path1'] },
      });

      vi.mocked(fs.readFile).mockResolvedValueOnce(config1Json);

      await service.findConfig();
      service.clearCache();

      const config2Json = JSON.stringify({
        version: 1,
        security: { allowRead: ['/path2'] },
      });

      vi.mocked(fs.readFile).mockResolvedValueOnce(config2Json);

      const config = await service.findConfig();

      expect(config.security?.allowRead).toEqual(['/path2']);
    });
  });

  describe('resolveEnvReferences', () => {
    it('should_handle_nested_env_references', async () => {
      process.env.DB_HOST = 'localhost';
      process.env.DB_PORT = '5432';

      const configWithNestedEnv = JSON.stringify({
        version: 1,
        executors: {
          typescript: {
            denoPath: 'env:DENO_PATH',
          },
        },
        security: {
          allowNetwork: ['env:DB_HOST'],
        },
      });

      process.env.DENO_PATH = '/usr/local/bin/deno';

      vi.mocked(fs.readFile).mockResolvedValueOnce(configWithNestedEnv);

      const config = await service.findConfig();

      expect(config.executors?.typescript?.denoPath).toBe('/usr/local/bin/deno');
      expect(config.security?.allowNetwork).toEqual(['localhost']);
    });

    it('should_handle_env_references_in_arrays', async () => {
      process.env.PATH1 = '/first/path';
      process.env.PATH2 = '/second/path';

      const configWithArrayEnv = JSON.stringify({
        version: 1,
        security: {
          allowRead: ['env:PATH1', 'env:PATH2', '/static/path'],
        },
      });

      vi.mocked(fs.readFile).mockResolvedValueOnce(configWithArrayEnv);

      const config = await service.findConfig();

      expect(config.security?.allowRead).toEqual([
        '/first/path',
        '/second/path',
        '/static/path',
      ]);
    });
  });
});
