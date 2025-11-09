/**
 * Type definitions for Code Executor MCP Server
 */

/**
 * Code execution result
 */
export interface ExecutionResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Output from stdout */
  output: string;
  /** Error message if failed */
  error?: string;
  /** Execution time in milliseconds */
  executionTimeMs: number;
  /** MCP tools called during execution */
  toolCallsMade?: string[];
  /** WebSocket URL for streaming output (optional) */
  streamUrl?: string;
}

/**
 * Execution result compatible with MCP SDK (requires index signature)
 */
export type MCPExecutionResult = ExecutionResult & { [x: string]: unknown };

/**
 * Sandbox permissions configuration
 */
export interface SandboxPermissions {
  /** Allowed read paths */
  read?: string[];
  /** Allowed write paths */
  write?: string[];
  /** Allowed network hosts */
  net?: string[];
}

/**
 * Sandbox execution options
 */
export interface SandboxOptions {
  /** Code to execute */
  code: string;
  /** Allowed MCP tools (whitelist) */
  allowedTools: string[];
  /** Execution timeout in milliseconds */
  timeoutMs: number;
  /** Deno sandbox permissions */
  permissions: SandboxPermissions;
  /** Enable real-time output streaming (WebSocket) */
  streaming?: boolean;
}

/**
 * MCP server configuration (from .mcp.json)
 */
export interface MCPServerConfig {
  /** Command to run */
  command: string;
  /** Command arguments */
  args: string[];
  /** Environment variables */
  env?: Record<string, string>;
}

/**
 * Complete MCP configuration
 */
export interface MCPConfig {
  /** Map of server name to configuration */
  mcpServers: Record<string, MCPServerConfig>;
}

/**
 * MCP tool information
 */
export interface ToolInfo {
  /** Server providing the tool */
  server: string;
  /** Tool name */
  name: string;
  /** Tool description */
  description: string;
}

/**
 * Execution audit log entry
 */
export interface AuditLogEntry {
  /** Timestamp */
  timestamp: string;
  /** SHA-256 hash of executed code */
  codeHash: string;
  /** Allowed tools whitelist */
  allowedTools: string[];
  /** Tools actually called */
  toolsCalled: string[];
  /** Execution time in milliseconds */
  executionTimeMs: number;
  /** Whether execution succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Code validation result
 */
export interface CodeValidationResult {
  /** Whether code is valid */
  valid: boolean;
  /** Validation errors */
  errors: string[];
  /** Warnings (non-blocking) */
  warnings: string[];
}

/**
 * Error types for categorization
 */
export enum ErrorType {
  VALIDATION = 'validation',
  SECURITY = 'security',
  EXECUTION = 'execution',
  MCP = 'mcp',
  TIMEOUT = 'timeout',
}

/**
 * Structured error response
 */
export interface ErrorResponse {
  /** Error message */
  error: string;
  /** Error category */
  errorType: ErrorType;
  /** Suggestion for fixing */
  suggestion?: string;
  /** Tools called before failure */
  toolCallsMade?: string[];
}
