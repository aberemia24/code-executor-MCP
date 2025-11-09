/**
 * Shared constants for Code Executor MCP Server
 */

import { z } from 'zod';

/** Default execution timeout in milliseconds (30 seconds) */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Maximum execution timeout in milliseconds (5 minutes) */
export const MAX_TIMEOUT_MS = 300_000;

/** Maximum response length in characters */
export const CHARACTER_LIMIT = 25_000;

/**
 * Environment variable validation schema
 *
 * Validates all environment variables with strict regex patterns
 * to prevent injection attacks
 */
const EnvSchema = z.object({
  DENO_PATH: z.string()
    .regex(/^(deno|\/[\w\/.-]+\/deno)$/, 'DENO_PATH must be "deno" or absolute path to deno binary')
    .default('deno'),

  MCP_CONFIG_PATH: z.string()
    .regex(/^[\w\/.-]+\.json$/, 'MCP_CONFIG_PATH must be a .json file path')
    .default('./.mcp.json'),

  ALLOWED_PROJECTS: z.string()
    .regex(/^([\w\/.-]+:?)+$/, 'ALLOWED_PROJECTS must be colon-separated absolute paths')
    .optional(),

  ENABLE_AUDIT_LOG: z.enum(['true', 'false'])
    .default('false'),

  AUDIT_LOG_PATH: z.string()
    .regex(/^[\w\/.-]+\.log$/, 'AUDIT_LOG_PATH must be a .log file path')
    .default('./audit.log'),
});

/**
 * Validated environment variables
 */
const env = EnvSchema.parse({
  DENO_PATH: process.env.DENO_PATH,
  MCP_CONFIG_PATH: process.env.MCP_CONFIG_PATH,
  ALLOWED_PROJECTS: process.env.ALLOWED_PROJECTS,
  ENABLE_AUDIT_LOG: process.env.ENABLE_AUDIT_LOG,
  AUDIT_LOG_PATH: process.env.AUDIT_LOG_PATH,
});

/** Deno executable path (validated) */
export const DENO_PATH = env.DENO_PATH;

/** MCP configuration file path (validated) */
export const MCP_CONFIG_PATH = env.MCP_CONFIG_PATH;

/** Allowed project roots for file system access (validated) */
export const ALLOWED_PROJECTS = env.ALLOWED_PROJECTS?.split(':') ?? [process.cwd()];

/** Enable audit logging (validated) */
export const ENABLE_AUDIT_LOG = env.ENABLE_AUDIT_LOG === 'true';

/** Audit log file path (validated) */
export const AUDIT_LOG_PATH = env.AUDIT_LOG_PATH;
