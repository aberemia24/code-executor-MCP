/**
 * Type definitions for Code Executor MCP Server
 */

/**
 * Tool call status types used across execution metadata
 */
export type ToolCallStatus = 'success' | 'error';

/**
 * Aggregated summary information for tool invocations during execution
 */
export interface ToolCallSummaryEntry {
  /** MCP tool name */
  toolName: string;
  /** Total number of invocations */
  callCount: number;
  /** Number of successful invocations */
  successCount: number;
  /** Number of failed invocations */
  errorCount: number;
  /** Total execution time accumulated across calls (ms) */
  totalDurationMs: number;
  /** Average execution time per call (ms) */
  averageDurationMs: number;
  /** Duration of the most recent call (ms) */
  lastCallDurationMs?: number;
  /** Status of the most recent call */
  lastCallStatus?: ToolCallStatus;
  /** Error message from the most recent failure (if any) */
  lastErrorMessage?: string;
  /** ISO timestamp for the most recent call */
  lastCalledAt?: string;
}

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
  /** Aggregated metadata for each MCP tool invocation */
  toolCallSummary?: ToolCallSummaryEntry[];
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
  /** Skip dangerous pattern validation (defense-in-depth protection) */
  skipDangerousPatternCheck?: boolean;
}

/**
 * STDIO transport configuration (default)
 * For local MCP servers spawned as child processes
 */
export interface StdioServerConfig {
  /** Command to run */
  command: string;
  /** Command arguments */
  args: string[];
  /** Environment variables */
  env?: Record<string, string>;
}

/**
 * HTTP/SSE transport configuration
 * For remote HTTP-based MCP servers
 */
export interface HttpServerConfig {
  /** Transport type identifier */
  type: 'http';
  /** Server URL (e.g., https://mcp.linear.app/mcp) */
  url: string;
  /** HTTP headers (e.g., Authorization: Bearer <token>) */
  headers?: Record<string, string>;
}

/**
 * MCP server configuration (from .mcp.json)
 *
 * Supports two transport types:
 * 1. STDIO: { command, args, env? }
 * 2. HTTP/SSE: { type: "http", url, headers? }
 */
export type MCPServerConfig = StdioServerConfig | HttpServerConfig;

/**
 * Type guard: Check if config is STDIO transport
 */
export function isStdioConfig(config: MCPServerConfig): config is StdioServerConfig {
  return 'command' in config;
}

/**
 * Type guard: Check if config is HTTP transport
 */
export function isHttpConfig(config: MCPServerConfig): config is HttpServerConfig {
  return 'type' in config && config.type === 'http';
}

/**
 * Process tracking information for cleanup
 */
export interface ProcessInfo {
  /** Process ID */
  pid: number;
  /** Server name */
  serverName: string;
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
 * Tool schema provider abstraction
 *
 * Enables Dependency Inversion Principle (DIP) by allowing high-level modules
 * (like SchemaCache) to depend on this abstraction instead of concrete implementations
 * (like MCPClientPool). This improves testability and allows swapping implementations.
 */
export interface IToolSchemaProvider {
  /**
   * List all available tools from connected MCP servers
   *
   * @returns Array of tool information (server, name, description)
   */
  listAllTools(): ToolInfo[];

  /**
   * Get full schema for a specific tool
   *
   * @param toolName - Full MCP tool name (e.g., 'mcp__zen__codereview')
   * @returns Tool schema with inputSchema, or null if not found
   */
  getToolSchema(toolName: string): Promise<CachedToolSchema | null>;
}

/**
 * Cached tool schema (used by SchemaCache and IToolSchemaProvider)
 *
 * NOTE ON `any` TYPES:
 * JSON Schema supports arbitrary nesting and dynamic properties that cannot be
 * statically typed in TypeScript. Runtime validation is enforced by AJV in SchemaValidator.
 *
 * Why `any` is unavoidable here:
 * - JSON Schema allows recursive nesting (properties can contain sub-schemas)
 * - Properties can have arbitrary keys and value types (e.g., "type", "enum", "anyOf", etc.)
 * - No safer TypeScript alternative exists for this dynamic structure
 *
 * Safety mitigations:
 * - Runtime validation with AJV in SchemaValidator (strict type checking)
 * - Deep recursive validation (nested objects, arrays, constraints, enums)
 * - No type coercion (integer ≠ number)
 *
 * @see SchemaValidator for runtime type checking implementation
 */
export interface CachedToolSchema {
  name: string;
  description?: string;
  /**
   * JSON Schema for tool input parameters
   *
   * Uses `any` because JSON Schema supports arbitrary nesting (see interface JSDoc above)
   */
  inputSchema: {
    type?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties?: Record<string, any>;
    required?: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any; // Index signature for arbitrary JSON Schema properties
  };
  /**
   * Optional JSON Schema describing the tool's response structure
   *
   * Uses `any` for same reasons as inputSchema (arbitrary JSON Schema nesting)
   */
  outputSchema?: {
    type?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties?: Record<string, any>;
    required?: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any; // Index signature for arbitrary JSON Schema properties
  };
}

/**
 * Execution audit log entry
 */
export interface AuditLogEntry {
  /** Timestamp (ISO 8601) */
  timestamp: string;
  /** Executor type (typescript or python) */
  executor: 'typescript' | 'python';
  /** SHA-256 hash of executed code */
  codeHash: string;
  /** Code length in bytes */
  codeLength: number;
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
  /** Client identifier (for rate limiting) */
  clientId?: string;
  /** Memory usage in bytes (if available) */
  memoryUsage?: number;
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
