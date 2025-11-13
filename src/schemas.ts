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
}).strict();

/**
 * Execution result schema
 */
export const ExecutionResultSchema = z.object({
  success: z.boolean().describe('Whether execution succeeded'),
  output: z.string().describe('Output from stdout (console.log or print)'),
  error: z.string().optional().describe('Error message if execution failed'),
  executionTimeMs: z.number().describe('Execution time in milliseconds'),
  toolCallsMade: z.array(z.string()).optional().describe('List of MCP tools called during execution'),
});

/** Infer TypeScript types from Zod schemas */
export type ExecuteTypescriptInput = z.infer<typeof ExecuteTypescriptInputSchema>;
export type ExecutePythonInput = z.infer<typeof ExecutePythonInputSchema>;
export type ExecutionResultOutput = z.infer<typeof ExecutionResultSchema>;
