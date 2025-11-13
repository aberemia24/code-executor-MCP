/**
 * Configuration manager for Code Executor MCP Server
 *
 * Provides access to runtime configuration loaded from:
 * 1. .code-executor.json files (project/user)
 * 2. Environment variables
 * 3. Defaults
 */

import { configDiscovery } from './config-discovery.js';
import type { Config } from './config-types.js';

/**
 * Global configuration instance
 */
let config: Config | null = null;

/**
 * Maximum response length in characters (compile-time constant)
 */
export const CHARACTER_LIMIT = 25_000;

/**
 * Initialize configuration
 *
 * Must be called before accessing any config values.
 * Typically called once at server startup.
 */
export async function initConfig(): Promise<void> {
  config = await configDiscovery.findConfig();
}

/**
 * Get current configuration
 *
 * @throws Error if config not initialized
 */
export function getConfig(): Config {
  if (!config) {
    throw new Error('Configuration not initialized. Call initConfig() first.');
  }
  return config;
}

/**
 * Get default timeout in milliseconds
 */
export function getDefaultTimeoutMs(): number {
  return getConfig().security?.defaultTimeoutMs ?? 30000;
}

/**
 * Get maximum timeout in milliseconds
 */
export function getMaxTimeoutMs(): number {
  return getConfig().security?.maxTimeoutMs ?? 300000;
}

/**
 * Get maximum code size in bytes
 */
export function getMaxCodeSize(): number {
  return getConfig().security?.maxCodeSize ?? 100000;
}

/**
 * Get allowed read paths
 */
export function getAllowedReadPaths(): string[] {
  const paths = getConfig().security?.allowRead ?? [];
  // Default to current working directory if empty
  return paths.length > 0 ? paths : [process.cwd()];
}

/**
 * Get allowed write paths
 */
export function getAllowedWritePaths(): string[] | false {
  const allowWrite = getConfig().security?.allowWrite;

  if (allowWrite === false) {
    return false;
  }

  if (allowWrite === true) {
    return getAllowedReadPaths(); // Same as read paths
  }

  if (Array.isArray(allowWrite)) {
    return allowWrite;
  }

  return false; // Default: no write access
}

/**
 * Get allowed network hosts
 */
export function getAllowedNetworkHosts(): string[] | true {
  const allowNetwork = getConfig().security?.allowNetwork;

  if (allowNetwork === true) {
    return true; // All hosts allowed
  }

  if (Array.isArray(allowNetwork)) {
    return allowNetwork;
  }

  return ['localhost', '127.0.0.1']; // Default: localhost only
}

/**
 * Check if audit logging is enabled
 */
export function isAuditLogEnabled(): boolean {
  return getConfig().security?.enableAuditLog ?? false;
}

/**
 * Get audit log file path
 */
export function getAuditLogPath(): string {
  return getConfig().security?.auditLogPath ?? './audit.log';
}

/**
 * Get Deno executable path
 */
export function getDenoPath(): string {
  return getConfig().executors?.typescript?.denoPath ?? 'deno';
}

/**
 * Get MCP configuration file path
 */
export async function getMCPConfigPath(): Promise<string> {
  return await configDiscovery.findMCPConfig();
}

/**
 * Check if TypeScript execution is enabled
 */
export function isTypeScriptEnabled(): boolean {
  return getConfig().executors?.typescript?.enabled ?? true;
}

/**
 * Check if Python execution is enabled
 */
export function isPythonEnabled(): boolean {
  return getConfig().executors?.python?.enabled ?? false;
}

/**
 * Get Python executable path
 */
export function getPythonPath(): string {
  return getConfig().executors?.python?.pythonPath ?? 'python3';
}

/**
 * Get rate limiting configuration
 */
export function getRateLimitConfig() {
  return getConfig().security?.rateLimit;
}

/**
 * Check if rate limiting is enabled
 */
export function isRateLimitEnabled(): boolean {
  return getRateLimitConfig()?.enabled ?? false;
}

/**
 * Check if dangerous pattern validation should be skipped
 *
 * Can be overridden by:
 * 1. Environment variable: CODE_EXECUTOR_SKIP_DANGEROUS_PATTERNS=true
 * 2. Configuration file: security.skipDangerousPatternCheck = true
 *
 * Default: false (validation enabled for security)
 */
export function shouldSkipDangerousPatternCheck(): boolean {
  // Environment variable takes precedence
  const envOverride = process.env.CODE_EXECUTOR_SKIP_DANGEROUS_PATTERNS;
  if (envOverride !== undefined) {
    return envOverride === 'true' || envOverride === '1';
  }

  // Fall back to config file
  return getConfig().security?.skipDangerousPatternCheck ?? false;
}

// For backward compatibility, export commonly used values
// (will be removed in v2.0)
export const DEFAULT_TIMEOUT_MS = 30000;
export const MAX_TIMEOUT_MS = 300000;
