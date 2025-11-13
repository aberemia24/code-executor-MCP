/**
 * Type definitions for code-executor-mcp configuration
 */

import { z } from 'zod';

/**
 * Rate limiting configuration schema
 */
export const RateLimitConfigSchema = z.object({
  enabled: z.boolean().default(false),
  windowMs: z.number().min(1000).default(60000),
  maxRequests: z.number().min(1).default(30),
});

export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;

/**
 * Security configuration schema
 */
export const SecurityConfigSchema = z.object({
  defaultTimeoutMs: z.number().min(1000).max(300000).default(30000),
  maxTimeoutMs: z.number().min(1000).max(600000).default(300000),
  maxCodeSize: z.number().min(1000).max(1000000).default(100000),
  allowRead: z.array(z.string()).default([]),
  allowWrite: z.union([z.boolean(), z.array(z.string())]).default(false),
  allowNetwork: z.union([z.boolean(), z.array(z.string())]).default(['localhost', '127.0.0.1']),
  enableAuditLog: z.boolean().default(false),
  auditLogPath: z.string().default('./audit.log'),
  rateLimit: RateLimitConfigSchema.optional(),
  skipDangerousPatternCheck: z.boolean().default(false),
});

export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;

/**
 * TypeScript executor configuration schema
 */
export const TypeScriptExecutorConfigSchema = z.object({
  enabled: z.boolean().default(true),
  denoPath: z.string().default('deno'),
});

export type TypeScriptExecutorConfig = z.infer<typeof TypeScriptExecutorConfigSchema>;

/**
 * Python executor configuration schema
 */
export const PythonExecutorConfigSchema = z.object({
  enabled: z.boolean().default(false),
  pythonPath: z.string().default('python3'),
  version: z.string().regex(/^3\.(9|10|11|12)$/).optional(),
});

export type PythonExecutorConfig = z.infer<typeof PythonExecutorConfigSchema>;

/**
 * Executors configuration schema
 */
export const ExecutorsConfigSchema = z.object({
  typescript: TypeScriptExecutorConfigSchema.optional(),
  python: PythonExecutorConfigSchema.optional(),
});

export type ExecutorsConfig = z.infer<typeof ExecutorsConfigSchema>;

/**
 * Complete configuration schema
 */
export const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  security: SecurityConfigSchema.optional(),
  executors: ExecutorsConfigSchema.optional(),
  mcpConfigPath: z.string().default('./.mcp.json'),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Partial configuration (for merging)
 */
export type PartialConfig = z.input<typeof ConfigSchema>;
