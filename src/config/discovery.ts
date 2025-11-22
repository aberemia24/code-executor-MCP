/**
 * Configuration discovery service
 *
 * Discovers and merges configuration from multiple sources:
 * 1. Environment variables (highest priority)
 * 2. Project-level .code-executor.json
 * 3. User-level ~/.code-executor.json
 * 4. Defaults
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { ConfigSchema } from './config-types.js';
import type { Config, PartialConfig } from './config-types.js';

/**
 * Configuration file search paths (in priority order)
 */
const CONFIG_SEARCH_PATHS = [
  // Project level (highest priority)
  '.code-executor.json',
  // User home directory
  path.join(homedir(), '.code-executor.json'),
  // XDG config (Linux)
  path.join(homedir(), '.config', 'code-executor', 'config.json'),
];

/**
 * MCP configuration search paths (in priority order)
 */
const MCP_CONFIG_SEARCH_PATHS = [
  // Project level
  '.mcp.json',
  // Claude Code global config (contains mcpServers field)
  path.join(homedir(), '.claude.json'),
  // Claude Code default locations
  path.join(homedir(), '.config', 'claude-code', 'mcp.json'),
  // macOS
  path.join(homedir(), 'Library', 'Application Support', 'Claude', 'mcp.json'),
];

/**
 * Configuration discovery service
 */
export class ConfigDiscoveryService {
  private cachedConfig: Config | null = null;

  /**
   * Find and load configuration file
   */
  async findConfig(): Promise<Config> {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    // Check for explicit override
    const explicitPath = process.env.CODE_EXECUTOR_CONFIG_PATH;
    if (explicitPath) {
      const config = await this.loadConfigFile(explicitPath);
      if (config) {
        this.cachedConfig = this.validateConfig(config);
        return this.cachedConfig;
      }
    }

    // Search config files in priority order
    const configs: PartialConfig[] = [];

    for (const searchPath of CONFIG_SEARCH_PATHS) {
      const config = await this.loadConfigFile(searchPath);
      if (config) {
        configs.push(config);
      }
    }

    // Merge configs (earlier = higher priority)
    const mergedConfig = this.mergeConfigs(configs);

    // Apply environment variable overrides
    const finalConfig = this.applyEnvOverrides(mergedConfig);

    // Validate and cache
    this.cachedConfig = this.validateConfig(finalConfig);
    return this.cachedConfig;
  }

  /**
   * Find ALL MCP configuration files (for merging)
   * Returns paths in reverse priority order (lowest priority first)
   * so they can be merged with later configs overriding earlier ones
   */
  async findAllMCPConfigs(): Promise<string[]> {
    const foundPaths: string[] = [];

    // Check explicit override (highest priority - will be added last)
    const explicitPath = process.env.MCP_CONFIG_PATH;
    const hasExplicitPath = explicitPath && await this.fileExists(explicitPath);

    // Check config file's mcpConfigPath (second highest priority)
    const config = await this.findConfig();
    const configMcpPath = config.mcpConfigPath;

    // Search default locations in REVERSE order (global first, project last)
    // This allows project configs to override global configs during merge
    for (let i = MCP_CONFIG_SEARCH_PATHS.length - 1; i >= 0; i--) {
      const searchPath = MCP_CONFIG_SEARCH_PATHS[i];
      if (!searchPath) continue;

      const resolvedPath = path.resolve(searchPath);

      // Skip if this is the same as configMcpPath or explicitPath (avoid duplicates)
      if (configMcpPath && path.resolve(configMcpPath) === resolvedPath) {
        continue;
      }
      if (hasExplicitPath && path.resolve(explicitPath) === resolvedPath) {
        continue;
      }

      if (await this.fileExists(searchPath)) {
        foundPaths.push(resolvedPath);
      }
    }

    // Add configMcpPath second-to-last (if different from explicit path)
    if (configMcpPath && await this.fileExists(configMcpPath)) {
      const resolvedConfigPath = path.resolve(configMcpPath);
      if (!hasExplicitPath || path.resolve(explicitPath) !== resolvedConfigPath) {
        foundPaths.push(resolvedConfigPath);
      }
    }

    // Add explicit path LAST (highest priority)
    if (hasExplicitPath) {
      foundPaths.push(path.resolve(explicitPath));
    }

    return foundPaths;
  }

  /**
   * Find MCP configuration file (returns first match for backward compatibility)
   * For merging configs, use findAllMCPConfigs() instead
   */
  async findMCPConfig(): Promise<string> {
    // Check explicit override
    const explicitPath = process.env.MCP_CONFIG_PATH;
    if (explicitPath && await this.fileExists(explicitPath)) {
      return path.resolve(explicitPath);
    }

    // Check config file's mcpConfigPath
    const config = await this.findConfig();
    if (config.mcpConfigPath && await this.fileExists(config.mcpConfigPath)) {
      return path.resolve(config.mcpConfigPath);
    }

    // Search default locations
    for (const searchPath of MCP_CONFIG_SEARCH_PATHS) {
      if (await this.fileExists(searchPath)) {
        return path.resolve(searchPath);
      }
    }

    // Return default (may not exist)
    return path.resolve('./.mcp.json');
  }

  /**
   * Load configuration file
   */
  private async loadConfigFile(filePath: string): Promise<PartialConfig | null> {
    try {
      const absolutePath = path.resolve(filePath);
      const content = await fs.readFile(absolutePath, 'utf-8');
      const json = JSON.parse(content);

      // Resolve env:VAR_NAME references
      return this.resolveEnvReferences(json) as PartialConfig;
    } catch {
      // File doesn't exist or is invalid - not an error, just skip
      return null;
    }
  }

  /**
   * Resolve env:VAR_NAME references in configuration
   */
  private resolveEnvReferences(obj: unknown): unknown {
    if (typeof obj === 'string') {
      // Check for env:VAR_NAME pattern
      const match = obj.match(/^env:([A-Z_][A-Z0-9_]*)$/);
      if (match && match[1]) {
        const varName = match[1];
        const value = process.env[varName];
        if (value === undefined) {
          throw new Error(`Environment variable ${varName} not found (referenced as env:${varName})`);
        }
        return value;
      }
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.resolveEnvReferences(item));
    }

    if (obj && typeof obj === 'object') {
      const resolved: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        resolved[key] = this.resolveEnvReferences(value);
      }
      return resolved;
    }

    return obj;
  }

  /**
   * Merge multiple configurations (first = highest priority)
   */
  private mergeConfigs(configs: PartialConfig[]): PartialConfig {
    if (configs.length === 0) {
      return {};
    }

    // Start with lowest priority (last config)
    let merged = configs[configs.length - 1] || {};

    // Merge in reverse order (higher priority configs override)
    for (let i = configs.length - 2; i >= 0; i--) {
      merged = this.deepMerge(merged, configs[i]) as PartialConfig;
    }

    return merged;
  }

  /**
   * Deep merge two objects (source overrides target)
   */
  private deepMerge(target: unknown, source: unknown): unknown {
    if (!source) return target;
    if (!target) return source;

    // Type guard: both must be objects for merging
    if (typeof target !== 'object' || typeof source !== 'object') {
      return source; // Source overrides
    }

    if (Array.isArray(target) || Array.isArray(source)) {
      return source; // Arrays are replaced, not merged
    }

    const result = { ...target } as Record<string, unknown>;

    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.deepMerge(result[key], value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Apply environment variable overrides
   */
  private applyEnvOverrides(config: PartialConfig): PartialConfig {
    const result = { ...config };

    // ALLOWED_PROJECTS env var (colon-separated paths)
    if (process.env.ALLOWED_PROJECTS) {
      const paths = process.env.ALLOWED_PROJECTS.split(':').filter(Boolean);
      if (!result.security) result.security = {};
      result.security.allowRead = paths;
    }

    // ENABLE_AUDIT_LOG env var
    if (process.env.ENABLE_AUDIT_LOG) {
      if (!result.security) result.security = {};
      result.security.enableAuditLog = process.env.ENABLE_AUDIT_LOG === 'true';
    }

    // AUDIT_LOG_PATH env var
    if (process.env.AUDIT_LOG_PATH) {
      if (!result.security) result.security = {};
      result.security.auditLogPath = process.env.AUDIT_LOG_PATH;
    }

    // DENO_PATH env var
    if (process.env.DENO_PATH) {
      if (!result.executors) result.executors = {};
      if (!result.executors.typescript) result.executors.typescript = {};
      result.executors.typescript.denoPath = process.env.DENO_PATH;
    }

    // MCP_CONFIG_PATH env var
    if (process.env.MCP_CONFIG_PATH) {
      result.mcpConfigPath = process.env.MCP_CONFIG_PATH;
    }

    return result;
  }

  /**
   * Validate configuration with defaults
   */
  private validateConfig(config: PartialConfig): Config {
    return ConfigSchema.parse(config);
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(path.resolve(filePath));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear cached configuration (for testing)
   */
  clearCache(): void {
    this.cachedConfig = null;
  }
}

/**
 * Singleton instance
 */
export const configDiscovery = new ConfigDiscoveryService();
