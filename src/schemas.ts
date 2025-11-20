/**
 * Zod validation schemas for Code Executor MCP Server
 */

import { z } from 'zod';
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS } from './config.js';

/**
 * Sandbox permissions schema
 */
export const SandboxPermissionsSchema = z.object({
  read: z.array(z.string()).optional().describe('Allowed read paths'),
  write: z.array(z.string()).optional().describe('Allowed write paths'),
  net: z.array(z.string()).optional().describe('Allowed network hosts'),
}).strict();

/**
 * Execute TypeScript input schema
 */
export const ExecuteTypescriptInputSchema = z.object({
  code: z.string()
    .min(1, 'Code cannot be empty')
    .describe('TypeScript/JavaScript code to execute in sandbox'),

  allowedTools: z.array(z.string())
    .default([])
    .describe('MCP tools allowed to be called (security whitelist). Format: mcp__<server>__<tool>. Default: [] (no tools allowed)'),

  timeoutMs: z.number()
    .int()
    .min(1000, 'Timeout must be at least 1 second')
    .max(MAX_TIMEOUT_MS, `Timeout cannot exceed ${MAX_TIMEOUT_MS}ms (5 minutes)`)
    .default(DEFAULT_TIMEOUT_MS)
    .describe(`Execution timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS}ms)`),

  permissions: SandboxPermissionsSchema
    .default({})
    .describe('Deno sandbox permissions for file system and network access'),

  skipDangerousPatternCheck: z.boolean()
    .optional()
    .describe('Skip dangerous pattern validation (defense-in-depth only). Default: false (validation enabled). Can be overridden by CODE_EXECUTOR_SKIP_DANGEROUS_PATTERNS env var or config file.'),

  // MCP Sampling parameters (optional, disabled by default)
  enableSampling: z.boolean()
    .default(false)
    .describe('Enable MCP Sampling (recursive LLM calls). Default: false'),

  maxSamplingRounds: z.number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Override maximum sampling rounds per execution. Default: 10'),

  maxSamplingTokens: z.number()
    .int()
    .min(1000)
    .max(100000)
    .optional()
    .describe('Override maximum sampling tokens per execution. Default: 10000'),

  samplingSystemPrompt: z.string()
    .optional()
    .describe('System prompt for sampling calls. Must be in allowlist if specified.'),

  allowedSamplingModels: z.array(z.string())
    .default(['claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022'])
    .describe('Allowlist of permitted LLM models for sampling. Default: Haiku + Sonnet'),
}).strict();

/**
 * Execute Python input schema
 */
export const ExecutePythonInputSchema = z.object({
  code: z.string()
    .min(1, 'Code cannot be empty')
    .describe('Python code to execute in subprocess'),

  allowedTools: z.array(z.string())
    .default([])
    .describe('MCP tools allowed to be called (security whitelist). Format: mcp__<server>__<tool>. Default: [] (no tools allowed)'),

  timeoutMs: z.number()
    .int()
    .min(1000, 'Timeout must be at least 1 second')
    .max(MAX_TIMEOUT_MS, `Timeout cannot exceed ${MAX_TIMEOUT_MS}ms (5 minutes)`)
    .default(DEFAULT_TIMEOUT_MS)
    .describe(`Execution timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS}ms)`),

  permissions: SandboxPermissionsSchema
    .default({})
    .describe('Python subprocess permissions (limited filesystem/network access)'),

  skipDangerousPatternCheck: z.boolean()
    .optional()
    .describe('Skip dangerous pattern validation (defense-in-depth only). Default: false (validation enabled). Can be overridden by CODE_EXECUTOR_SKIP_DANGEROUS_PATTERNS env var or config file.'),

  // MCP Sampling parameters (optional, disabled by default)
  enableSampling: z.boolean()
    .default(false)
    .describe('Enable MCP Sampling (recursive LLM calls). Default: false'),

  maxSamplingRounds: z.number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Override maximum sampling rounds per execution. Default: 10'),

  maxSamplingTokens: z.number()
    .int()
    .min(1000)
    .max(100000)
    .optional()
    .describe('Override maximum sampling tokens per execution. Default: 10000'),

  samplingSystemPrompt: z.string()
    .optional()
    .describe('System prompt for sampling calls. Must be in allowlist if specified.'),

  allowedSamplingModels: z.array(z.string())
    .default(['claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022'])
    .describe('Allowlist of permitted LLM models for sampling. Default: Haiku + Sonnet'),
}).strict();

/**
 * Execution result schema
 */
const ToolCallSummaryEntrySchema = z
  .object({
    toolName: z.string().describe('Name of the MCP tool'),
    callCount: z.number().int().nonnegative().describe('Total number of invocations'),
    successCount: z.number().int().nonnegative().describe('Successful invocations'),
    errorCount: z.number().int().nonnegative().describe('Failed invocations'),
    totalDurationMs: z.number().nonnegative().describe('Total execution time in milliseconds'),
    averageDurationMs: z.number().nonnegative().describe('Average execution time per call in milliseconds'),
    lastCallDurationMs: z
      .number()
      .nonnegative()
      .optional()
      .describe('Duration of the most recent call in milliseconds'),
    lastCallStatus: z
      .enum(['success', 'error'])
      .optional()
      .describe('Status of the most recent call'),
    lastErrorMessage: z
      .string()
      .optional()
      .describe('Error message from the most recent failure (if any)'),
    lastCalledAt: z
      .string()
      .optional()
      .describe('ISO timestamp of the most recent call'),
  })
  .describe('Aggregated execution metrics for a specific MCP tool');

export const ExecutionResultSchema = z.object({
  success: z.boolean().describe('Whether execution succeeded'),
  output: z.string().describe('Output from stdout (console.log or print)'),
  error: z.string().optional().describe('Error message if execution failed'),
  executionTimeMs: z.number().describe('Execution time in milliseconds'),
  toolCallsMade: z.array(z.string()).optional().describe('List of MCP tools called during execution'),
  toolCallSummary: z
    .array(ToolCallSummaryEntrySchema)
    .optional()
    .describe('Aggregated tool call metrics collected during execution'),
});

/** Infer TypeScript types from Zod schemas */
export type ExecuteTypescriptInput = z.infer<typeof ExecuteTypescriptInputSchema>;
export type ExecutePythonInput = z.infer<typeof ExecutePythonInputSchema>;
export type ExecutionResultOutput = z.infer<typeof ExecutionResultSchema>;
