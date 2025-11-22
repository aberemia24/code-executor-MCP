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
 * Connection pool configuration schema
 *
 * **WHY Zod Validation?**
 * - Prevents NaN from parseInt() with invalid input
 * - Enforces bounds checking (no 0, negative, or excessive values)
 * - Self-documenting configuration with clear constraints
 * - Type-safe environment variable parsing
 *
 * **WHY These Limits?**
 * - maxConcurrent: 1-1000 balances throughput vs resource consumption
 * - queueSize: 1-1000 prevents memory exhaustion from unbounded queues
 * - queueTimeoutMs: 1s-5min ensures reasonable wait times
 */
export const PoolConfigSchema = z.object({
  /** Maximum concurrent requests (default: 100) */
  maxConcurrent: z.number().int().min(1).max(1000).default(100),
  /** Queue size when pool at capacity (default: 200) */
  queueSize: z.number().int().min(1).max(1000).default(200),
  /** Queue timeout in milliseconds (default: 30000ms = 30s) */
  queueTimeoutMs: z.number().int().min(1000).max(300000).default(30000),
});

export type PoolConfig = z.infer<typeof PoolConfigSchema>;

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
  allowedTools: z.array(z.string()).default([]),
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
 * Sampling configuration schema (FR-7)
 *
 * **WHY Zod Validation?**
 * - Prevents infinite loops via max rounds validation (1-100)
 * - Enforces token budgets to prevent resource exhaustion (100-100000)
 * - Self-documenting security constraints
 * - Type-safe environment variable parsing
 *
 * **WHY These Limits?**
 * - maxRoundsPerExecution: 1-100 prevents infinite loops while allowing complex workflows
 * - maxTokensPerExecution: 100-100000 balances capability vs cost/resource protection
 * - timeoutPerCallMs: 1s-10min ensures reasonable response times
 * - allowedSystemPrompts: Security measure to prevent prompt injection
 * - contentFilteringEnabled: Prevents accidental secret/PII leakage (default: true)
 *
 * @see specs/001-mcp-sampling/spec.md (FR-7)
 */
export const SamplingConfigSchema = z.object({
  /** Enable sampling support (default: false for security) */
  enabled: z.boolean().default(false),
  /** AI Provider to use (default: anthropic) */
  provider: z.enum(['anthropic', 'openai', 'gemini', 'grok', 'perplexity']).default('anthropic'),
  /** API Keys for providers (optional - sampling disabled if missing) */
  apiKeys: z.object({
    anthropic: z.string().optional(),
    openai: z.string().optional(),
    gemini: z.string().optional(),
    grok: z.string().optional(),
    perplexity: z.string().optional(),
  }).optional(),
  /** Custom base URL for OpenAI-compatible providers */
  baseUrl: z.string().url().optional(),
  /** Maximum sampling rounds per execution (default: 10, range: 1-100) */
  maxRoundsPerExecution: z.number().int().min(1).max(100).default(10),
  /** Maximum tokens per execution (default: 10000, range: 100-100000) */
  maxTokensPerExecution: z.number().int().min(100).max(100000).default(10000),
  /** Timeout per sampling call in milliseconds (default: 30000ms = 30s, range: 1s-10min) */
  timeoutPerCallMs: z.number().int().min(1000).max(600000).default(30000),
  /** Allowed system prompts (default: empty, helpful assistant, code analysis expert) */
  allowedSystemPrompts: z
    .array(z.string())
    .default(['', 'You are a helpful assistant', 'You are a code analysis expert']),
  /** Enable content filtering for secrets/PII (default: true for security) */
  contentFilteringEnabled: z.boolean().default(true),
  /** Allowlist of permitted LLM models for security (January 2025 - updated with latest cost-effective models) */
  allowedModels: z.array(z.string()).default([
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-5-20250929',
    'gpt-4o-mini',
    'gemini-2.5-flash-lite',
    'grok-4-1-fast-non-reasoning',
    'sonar'
  ]),
});

export type SamplingConfig = z.infer<typeof SamplingConfigSchema>;

/**
 * Complete configuration schema
 */
export const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  security: SecurityConfigSchema.optional(),
  executors: ExecutorsConfigSchema.optional(),
  sampling: SamplingConfigSchema.optional(),
  mcpConfigPath: z.string().default('./.mcp.json'),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Partial configuration (for merging)
 */
export type PartialConfig = z.input<typeof ConfigSchema>;
