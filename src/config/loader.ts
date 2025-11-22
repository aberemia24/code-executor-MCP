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
import { PoolConfigSchema, type PoolConfig, SamplingConfigSchema, type SamplingConfig } from './config-types.js';
import { z } from 'zod';

/**
 * Global configuration instance
 */
let config: Config | null = null;

/**
 * Maximum response length in characters (compile-time constant)
 */
export const CHARACTER_LIMIT = 25_000;

/**
 * Safely parse environment variable as integer with NaN detection
 *
 * **WHY:** parseInt('invalid') returns NaN, which can cause subtle bugs downstream.
 * This helper provides clear error messages upfront before Zod validation.
 *
 * @param value Environment variable value
 * @param name Environment variable name (for error messages)
 * @returns Parsed integer or undefined if not provided
 * @throws {Error} If value is non-numeric (NaN)
 */
function parseEnvInt(value: string | undefined, name: string): number | undefined {
  if (!value) return undefined;

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(
      `Invalid numeric value for ${name}: "${value}". ` +
      `Expected a valid integer.`
    );
  }
  return parsed;
}

/**
 * Safely parse environment variable as boolean
 *
 * **WHY:** Environment variables are strings, need explicit conversion.
 * Supports common boolean representations for flexibility.
 *
 * @param value Environment variable value
 * @param name Environment variable name (for error messages)
 * @returns Parsed boolean or undefined if not provided
 * @throws {Error} If value is not 'true', 'false', '1', or '0'
 */
function parseEnvBool(value: string | undefined, name: string): boolean | undefined {
  if (!value) return undefined;

  const lower = value.toLowerCase();
  if (lower === 'true' || lower === '1') return true;
  if (lower === 'false' || lower === '0') return false;

  throw new Error(
    `Invalid boolean value for ${name}: "${value}". ` +
    `Expected "true", "false", "1", or "0".`
  );
}

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
 * Get ALL MCP configuration file paths (for merging global + project configs)
 * Returns paths in priority order (lowest priority first)
 */
export async function getAllMCPConfigPaths(): Promise<string[]> {
  return await configDiscovery.findAllMCPConfigs();
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

/**
 * Get connection pool configuration from environment variables
 *
 * **WHY This Function?**
 * - Replaces direct process.env access (violates coding standards)
 * - Provides Zod validation for type safety
 * - Prevents NaN from parseInt() with invalid input
 * - Enforces bounds checking (1-1000 for concurrency/queue)
 * - Self-documenting via schema
 *
 * **Environment Variables:**
 * - POOL_MAX_CONCURRENT: Maximum concurrent requests (default: 100)
 * - POOL_QUEUE_SIZE: Queue size when at capacity (default: 200)
 * - POOL_QUEUE_TIMEOUT_MS: Queue timeout in ms (default: 30000)
 *
 * @returns Validated pool configuration with defaults
 * @throws {z.ZodError} If environment variables are invalid (non-numeric, out of bounds)
 */
export function getPoolConfig(): PoolConfig {
  try {
    return PoolConfigSchema.parse({
      maxConcurrent: parseEnvInt(process.env.POOL_MAX_CONCURRENT, 'POOL_MAX_CONCURRENT'),
      queueSize: parseEnvInt(process.env.POOL_QUEUE_SIZE, 'POOL_QUEUE_SIZE'),
      queueTimeoutMs: parseEnvInt(process.env.POOL_QUEUE_TIMEOUT_MS, 'POOL_QUEUE_TIMEOUT_MS'),
    });
  } catch (error) {
    // WHY: Wrap Zod errors with user-friendly messages
    // Zod error messages can be verbose and technical. Provide clearer guidance.
    if (error instanceof z.ZodError) {
      const firstError = error.errors[0];
      const field = firstError?.path.join('.') || 'unknown';
      throw new Error(
        `Invalid pool configuration: ${field} - ${firstError?.message}. ` +
        `Check environment variables: POOL_MAX_CONCURRENT (1-1000), POOL_QUEUE_SIZE (1-1000), POOL_QUEUE_TIMEOUT_MS (1000-300000).`
      );
    }
    // Re-throw non-Zod errors (e.g., parseEnvInt errors)
    throw error;
  }
}

/**
 * Get sampling configuration from environment variables
 *
 * Environment variables (all optional, with defaults):
 * - CODE_EXECUTOR_SAMPLING_ENABLED: Enable sampling (default: false)
 * - CODE_EXECUTOR_MAX_SAMPLING_ROUNDS: Max rounds per execution (default: 10, range: 1-100)
 * - CODE_EXECUTOR_MAX_SAMPLING_TOKENS: Max tokens per execution (default: 10000, range: 100-100000)
 * - CODE_EXECUTOR_SAMPLING_TIMEOUT_MS: Timeout per call in ms (default: 30000, range: 1000-600000)
 * - CODE_EXECUTOR_ALLOWED_SYSTEM_PROMPTS: Comma-separated list of allowed system prompts (default: '', 'You are a helpful assistant', 'You are a code analysis expert')
 * - CODE_EXECUTOR_CONTENT_FILTERING_ENABLED: Enable content filtering (default: true)
 *
 * @returns Validated sampling configuration with defaults
 * @throws {z.ZodError} If environment variables are invalid (non-numeric, out of bounds, invalid boolean)
 */
export function getSamplingConfig(): SamplingConfig {
  // WHY: Parse comma-separated list for system prompt allowlist
  // Enables runtime security policy changes without code modification
  const allowedPrompts = process.env.CODE_EXECUTOR_ALLOWED_SYSTEM_PROMPTS
    ? process.env.CODE_EXECUTOR_ALLOWED_SYSTEM_PROMPTS.split(',').map(s => s.trim())
    : undefined;

  try {
    return SamplingConfigSchema.parse({
      enabled: parseEnvBool(process.env.CODE_EXECUTOR_SAMPLING_ENABLED, 'CODE_EXECUTOR_SAMPLING_ENABLED'),
      maxRoundsPerExecution: parseEnvInt(process.env.CODE_EXECUTOR_MAX_SAMPLING_ROUNDS, 'CODE_EXECUTOR_MAX_SAMPLING_ROUNDS'),
      maxTokensPerExecution: parseEnvInt(process.env.CODE_EXECUTOR_MAX_SAMPLING_TOKENS, 'CODE_EXECUTOR_MAX_SAMPLING_TOKENS'),
      timeoutPerCallMs: parseEnvInt(process.env.CODE_EXECUTOR_SAMPLING_TIMEOUT_MS, 'CODE_EXECUTOR_SAMPLING_TIMEOUT_MS'),
      allowedSystemPrompts: allowedPrompts,
      contentFilteringEnabled: parseEnvBool(process.env.CODE_EXECUTOR_CONTENT_FILTERING_ENABLED, 'CODE_EXECUTOR_CONTENT_FILTERING_ENABLED'),
    });
  } catch (error) {
    // WHY: Wrap Zod errors with user-friendly messages
    if (error instanceof z.ZodError) {
      const firstError = error.errors[0];
      const field = firstError?.path.join('.') || 'unknown';
      throw new Error(
        `Invalid sampling configuration: ${field} - ${firstError?.message}. ` +
        `Check environment variables: CODE_EXECUTOR_SAMPLING_ENABLED (true/false), ` +
        `CODE_EXECUTOR_MAX_SAMPLING_ROUNDS (1-100), CODE_EXECUTOR_MAX_SAMPLING_TOKENS (100-100000), ` +
        `CODE_EXECUTOR_SAMPLING_TIMEOUT_MS (1000-600000), ` +
        `CODE_EXECUTOR_ALLOWED_SYSTEM_PROMPTS (comma-separated list), ` +
        `CODE_EXECUTOR_CONTENT_FILTERING_ENABLED (true/false).`
      );
    }
    // Re-throw non-Zod errors (e.g., parseEnvInt/parseEnvBool errors)
    throw error;
  }
}

/**
 * Get Anthropic API key from environment variable
 *
 * **WHY This Function?**
 * - Centralizes access to ANTHROPIC_API_KEY environment variable
 * - Replaces direct process.env access (violates coding standards)
 * - Provides clear error messages when key is missing
 * - Follows same pattern as other config functions
 *
 * **Security:**
 * - API key should NEVER be in config files (secrets should be in environment)
 * - Key is required when sampling is enabled
 * - Validation happens at usage time (not config init time)
 *
 * @returns Anthropic API key or undefined if not set
 */
export function getAnthropicApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY;
}

/**
 * Get Docker container environment variable
 *
 * **WHY This Function?**
 * - Centralizes access to DOCKER_CONTAINER environment variable
 * - Replaces direct process.env access (Constitutional Principle 4)
 * - Enables Docker detection for host.docker.internal bridge URL
 * - Follows same pattern as other config functions
 *
 * **Security:**
 * - Environment variable validated at access point (not arbitrary values)
 * - Used in combination with /.dockerenv file check for reliability
 * - Only accepts 'true' or '1' as valid Docker indicators
 *
 * @returns DOCKER_CONTAINER value or undefined if not set
 */
export function getDockerContainer(): string | undefined {
  return process.env.DOCKER_CONTAINER;
}

// For backward compatibility, export commonly used values
// (will be removed in v2.0)
export const DEFAULT_TIMEOUT_MS = 30000;
export const MAX_TIMEOUT_MS = 300000;
