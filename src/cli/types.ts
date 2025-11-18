/**
 * CLI Setup Types - Type definitions for interactive wizard
 *
 * **RESPONSIBILITY (SRP):** Define TypeScript types for CLI setup configuration
 * **WHY:** Centralized type definitions maintain consistency across CLI modules
 */

/**
 * SetupConfig - Configuration collected from interactive prompts
 *
 * **VALIDATION:** Values validated against AJV schema (setup-config.schema.ts)
 * **USAGE:** Passed to ConfigManager for .mcp.json file generation
 */
export interface SetupConfig {
  /**
   * Proxy server port for MCP tool calls
   *
   * **RANGE:** 1024-65535 (unprivileged ports)
   * **DEFAULT:** 3000
   */
  proxyPort: number;

  /**
   * Execution timeout for MCP tool calls (milliseconds)
   *
   * **RANGE:** 1000-600000 (1s to 10 minutes)
   * **DEFAULT:** 120000 (2 minutes)
   */
  executionTimeout: number;

  /**
   * Rate limit for MCP proxy requests (requests per minute)
   *
   * **RANGE:** 1-1000
   * **DEFAULT:** 30
   */
  rateLimit: number;

  /**
   * Audit log file path
   *
   * **FORMAT:** Absolute path to .jsonl file
   * **DEFAULT:** ~/.code-executor/audit-logs/audit.jsonl
   */
  auditLogPath: string;

  /**
   * Schema cache TTL (time-to-live) in hours
   *
   * **RANGE:** 1-168 (1 hour to 1 week)
   * **DEFAULT:** 24 hours
   */
  schemaCacheTTL: number;
}

/**
 * MCPServerConfig - Configuration for a single MCP server
 *
 * **SOURCE:** Extracted from .mcp.json files
 * **FORMAT:** Standard MCP SDK configuration format
 */
export interface MCPServerConfig {
  /**
   * Server name/identifier
   *
   * **EXAMPLE:** "filesystem", "github", "code-executor"
   */
  name: string;

  /**
   * Command to execute the MCP server
   *
   * **EXAMPLES:** "node", "npx", "python", "/usr/bin/mcp-server"
   */
  command: string;

  /**
   * Command arguments
   *
   * **EXAMPLES:** ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
   */
  args: string[];

  /**
   * Environment variables for the server process
   *
   * **EXAMPLES:** { "API_KEY": "value", "DEBUG": "true" }
   */
  env?: Record<string, string>;

  /**
   * Source tool that defined this MCP server
   *
   * **EXAMPLES:** "claude-code", "cursor", "windsurf"
   */
  sourceTool: string;
}

/**
 * MCPConfig - Root configuration object from .mcp.json files
 *
 * **STRUCTURE:** Standard MCP SDK format
 */
export interface MCPConfig {
  mcpServers: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}
