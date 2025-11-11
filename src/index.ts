#!/usr/bin/env node

/**
 * Code Executor MCP Server
 *
 * Progressive disclosure MCP server that executes TypeScript/Python code
 * with integrated MCP client access.
 *
 * Reduces token usage by ~98% by exposing only 2 tools instead of 47.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { initConfig, isPythonEnabled, isRateLimitEnabled, getRateLimitConfig } from './config.js';
import { ExecuteTypescriptInputSchema, ExecutePythonInputSchema } from './schemas.js';
import { MCPClientPool } from './mcp-client-pool.js';
import { SecurityValidator } from './security.js';
import { ConnectionPool } from './connection-pool.js';
import { RateLimiter } from './rate-limiter.js';
import { executeTypescriptInSandbox } from './sandbox-executor.js';
import { executePythonInSandbox } from './python-executor.js';
import { formatErrorResponse } from './utils.js';
import { ErrorType } from './types.js';
import { checkDenoAvailable, getDenoVersion, getDenoInstallMessage } from './deno-checker.js';
import type { MCPExecutionResult } from './types.js';

/**
 * Main server class
 */
class CodeExecutorServer {
  private server: McpServer;
  private mcpClientPool: MCPClientPool;
  private securityValidator: SecurityValidator;
  private connectionPool: ConnectionPool;
  private rateLimiter: RateLimiter | null = null;
  private denoAvailable: boolean = false;

  constructor() {
    // Initialize MCP server
    this.server = new McpServer({
      name: 'code-executor-mcp-server',
      version: '1.0.0',
    });

    // Initialize components
    this.mcpClientPool = new MCPClientPool();
    this.securityValidator = new SecurityValidator();
    this.connectionPool = new ConnectionPool(100); // Max 100 concurrent executions

    // Rate limiter will be initialized after config is loaded
    this.rateLimiter = null;

    // Deno availability checked in start()
    this.denoAvailable = false;

    // Note: registerTools() is called in start() after config initialization
  }

  /**
   * Handle tool execution errors with standardized response format
   */
  private handleToolError(error: unknown, errorType: ErrorType) {
    const errorResponse = formatErrorResponse(error, errorType);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(errorResponse, null, 2),
      }],
      isError: true,
    };
  }

  /**
   * Check rate limit before executing code
   *
   * Returns error response if rate limited, null otherwise.
   */
  private async checkRateLimit(): Promise<ReturnType<typeof this.handleToolError> | null> {
    if (!this.rateLimiter) {
      return null; // Rate limiting disabled
    }

    // Use 'default' as client ID since MCP servers run locally
    // In a networked environment, this would be the client IP
    const result = await this.rateLimiter.checkLimit('default');

    if (!result.allowed) {
      const error = new Error(
        `Rate limit exceeded. Maximum ${getRateLimitConfig()?.maxRequests ?? 30} requests per ` +
        `${(getRateLimitConfig()?.windowMs ?? 60000) / 1000}s. ` +
        `Try again in ${Math.ceil(result.resetIn / 1000)}s.`
      );
      return this.handleToolError(error, ErrorType.VALIDATION);
    }

    return null;
  }

  /**
   * Register MCP tools
   */
  private registerTools(): void {
    // Tool 1: Execute TypeScript (only if Deno is available)
    if (this.denoAvailable) {
      this.server.registerTool(
      'executeTypescript',
      {
        title: 'Execute TypeScript with MCP Access',
        description: `Execute TypeScript/JavaScript code in a secure Deno sandbox with access to MCP tools.

Executed code has access to callMCPTool(toolName, params) function for calling other MCP servers.
Import DopaMind wrappers: import { codereview } from './servers/zen/codereview'

**NEW: In-Sandbox Tool Discovery**
Three discovery functions are injected into the sandbox for self-service tool exploration:

1. discoverMCPTools(options?) - Discover all available MCP tools
   - Options: { search?: string[] } - Array of keywords to filter tools (OR logic)
   - Returns: ToolSchema[] - Array of tool schemas
   - Example: const tools = await discoverMCPTools({ search: ['file', 'read'] });

2. getToolSchema(toolName) - Get detailed schema for a specific tool
   - Parameter: toolName (string) - Full tool name (e.g., 'mcp__filesystem__read_file')
   - Returns: ToolSchema | null - Tool schema or null if not found
   - Example: const schema = await getToolSchema('mcp__filesystem__read_file');

3. searchTools(query, limit?) - Search tools by keywords with result limiting
   - Parameters: query (string), limit (number, default: 10)
   - Returns: ToolSchema[] - Filtered and limited tool schemas
   - Example: const fileTools = await searchTools('file read write', 5);

**Proactive Workflow Example:**
// Discover tools, inspect schema, then execute
const networkTools = await searchTools('fetch url');
const schema = await getToolSchema(networkTools[0].name);
const result = await callMCPTool(networkTools[0].name, { url: 'https://...' });

Security:
- Only tools in allowedTools array can be called
- Deno sandbox permissions enforce file system and network restrictions
- Execution timeout prevents infinite loops
- All executions are audit logged

Args:
  - code (string): TypeScript/JavaScript code to execute
  - allowedTools (string[]): MCP tools whitelist (default: [])
    Format: ['mcp__<server>__<tool>', ...]
    Example: ['mcp__zen__codereview', 'mcp__filesystem__read_file']
  - timeoutMs (number): Execution timeout in milliseconds (default: 30000)
  - permissions (object): Deno sandbox permissions
    - read (string[]): Allowed read paths
    - write (string[]): Allowed write paths
    - net (string[]): Allowed network hosts

Returns:
  {
    "success": boolean,
    "output": string,           // stdout from console.log()
    "error": string,            // Error message if failed
    "executionTimeMs": number,
    "toolCallsMade": string[]   // MCP tools called
  }

Example:
  {
    "code": "const result = await callMCPTool('mcp__zen__codereview', {...}); console.log(result);",
    "allowedTools": ["mcp__zen__codereview"],
    "timeoutMs": 60000
  }`,
        inputSchema: {
          code: z.string().min(1).describe('TypeScript/JavaScript code to execute'),
          allowedTools: z.array(z.string()).default([]).describe('MCP tools whitelist'),
          timeoutMs: z.number().int().min(1000).default(30000).describe('Timeout in milliseconds'),
          permissions: z.object({
            read: z.array(z.string()).optional(),
            write: z.array(z.string()).optional(),
            net: z.array(z.string()).optional(),
          }).default({}).describe('Deno sandbox permissions'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async (params) => {
        try {
          // Check rate limit
          const rateLimitError = await this.checkRateLimit();
          if (rateLimitError) {
            return rateLimitError;
          }

          // Validate input with Zod schema (runtime validation)
          const parseResult = ExecuteTypescriptInputSchema.safeParse(params);
          if (!parseResult.success) {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  success: false,
                  output: '',
                  error: `Input validation failed: ${parseResult.error.message}`,
                  executionTimeMs: 0,
                }, null, 2),
              }],
              isError: true,
            };
          }
          const input = parseResult.data;

          // Validate security
          this.securityValidator.validateAllowlist(input.allowedTools);
          await this.securityValidator.validatePermissions(input.permissions);
          const codeValidation = this.securityValidator.validateCode(input.code);

          if (!codeValidation.valid) {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  success: false,
                  output: '',
                  error: codeValidation.errors.join('\n'),
                  executionTimeMs: 0,
                }, null, 2),
              }],
              isError: true,
            };
          }

          // Execute code with connection pooling
          const result = await this.connectionPool.execute(async () => {
            return await executeTypescriptInSandbox(
              {
                code: input.code,
                allowedTools: input.allowedTools,
                timeoutMs: input.timeoutMs,
                permissions: input.permissions,
              },
              this.mcpClientPool
            );
          });

          // Audit log
          await this.securityValidator.auditLog(
            {
              executor: 'typescript',
              allowedTools: input.allowedTools,
              toolsCalled: result.toolCallsMade ?? [],
              executionTimeMs: result.executionTimeMs,
              success: result.success,
              error: result.error,
              clientId: 'default', // MCP servers run locally
              memoryUsage: process.memoryUsage().heapUsed,
            },
            input.code
          );

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            }],
            structuredContent: result as MCPExecutionResult,
            isError: !result.success,
          };
        } catch (error) {
          return this.handleToolError(error, ErrorType.EXECUTION);
        }
      }
    );
    }

    // Tool 2: Execute Python (optional, enabled via config)
    if (isPythonEnabled()) {
      this.server.registerTool(
        'executePython',
        {
          title: 'Execute Python with MCP Access',
          description: `Execute Python code in a subprocess with access to MCP tools.

Executed code has access to call_mcp_tool(toolName, params) function for calling other MCP servers.

Security:
- Only tools in allowedTools array can be called
- Code pattern validation blocks dangerous operations
- Execution timeout prevents infinite loops
- All executions are audit logged

Args:
  - code (string): Python code to execute
  - allowedTools (string[]): MCP tools whitelist (default: [])
    Format: ['mcp__<server>__<tool>', ...]
    Example: ['mcp__zen__codereview', 'mcp__filesystem__read_file']
  - timeoutMs (number): Execution timeout in milliseconds (default: 30000)
  - permissions (object): Subprocess permissions (limited to temp directory and localhost)

Returns:
  {
    "success": boolean,
    "output": string,           // stdout from print()
    "error": string,            // Error message if failed
    "executionTimeMs": number,
    "toolCallsMade": string[]   // MCP tools called
  }

Example:
  {
    "code": "result = call_mcp_tool('mcp__zen__codereview', {...}); print(result)",
    "allowedTools": ["mcp__zen__codereview"],
    "timeoutMs": 60000
  }`,
          inputSchema: {
            code: z.string().min(1).describe('Python code to execute'),
            allowedTools: z.array(z.string()).default([]).describe('MCP tools whitelist'),
            timeoutMs: z.number().int().min(1000).default(30000).describe('Timeout in milliseconds'),
            permissions: z.object({
              read: z.array(z.string()).optional(),
              write: z.array(z.string()).optional(),
              net: z.array(z.string()).optional(),
            }).default({}).describe('Subprocess permissions'),
          },
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
          },
        },
        async (params) => {
          try {
            // Check rate limit
            const rateLimitError = await this.checkRateLimit();
            if (rateLimitError) {
              return rateLimitError;
            }

            // Validate input with Zod schema
            const parseResult = ExecutePythonInputSchema.safeParse(params);
            if (!parseResult.success) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify({
                    success: false,
                    output: '',
                    error: `Input validation failed: ${parseResult.error.message}`,
                    executionTimeMs: 0,
                  }, null, 2),
                }],
                isError: true,
              };
            }
            const input = parseResult.data;

            // Validate security
            this.securityValidator.validateAllowlist(input.allowedTools);
            await this.securityValidator.validatePermissions(input.permissions);
            const codeValidation = this.securityValidator.validateCode(input.code);

            if (!codeValidation.valid) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify({
                    success: false,
                    output: '',
                    error: codeValidation.errors.join('\n'),
                    executionTimeMs: 0,
                  }, null, 2),
                }],
                isError: true,
              };
            }

            // Execute code with connection pooling
            const result = await this.connectionPool.execute(async () => {
              return await executePythonInSandbox(
                {
                  code: input.code,
                  allowedTools: input.allowedTools,
                  timeoutMs: input.timeoutMs,
                  permissions: input.permissions,
                },
                this.mcpClientPool
              );
            });

            // Audit log
            await this.securityValidator.auditLog(
              {
                executor: 'python',
                allowedTools: input.allowedTools,
                toolsCalled: result.toolCallsMade ?? [],
                executionTimeMs: result.executionTimeMs,
                success: result.success,
                error: result.error,
                clientId: 'default', // MCP servers run locally
                memoryUsage: process.memoryUsage().heapUsed,
              },
              input.code
            );

            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify(result, null, 2),
              }],
              structuredContent: result as MCPExecutionResult,
              isError: !result.success,
            };
          } catch (error) {
            return this.handleToolError(error, ErrorType.EXECUTION);
          }
        }
      );
    }

    // Tool 3: Health Check
    this.server.registerTool(
      'health',
      {
        title: 'Server Health Check',
        description: `Get server health status including audit log, MCP connections, connection pool, and uptime.

Returns:
  {
    "healthy": boolean,
    "auditLog": { "enabled": boolean },
    "mcpClients": { "connected": number },
    "connectionPool": { "active": number, "waiting": number, "max": number },
    "uptime": number
  }`,
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async () => {
        try {
          const tools = this.mcpClientPool.listAllTools();
          const poolStats = this.connectionPool.getStats();

          const health = {
            healthy: true,
            auditLog: {
              enabled: this.securityValidator.isAuditLogEnabled(),
            },
            mcpClients: {
              connected: tools.length,
            },
            connectionPool: poolStats,
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
          };

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(health, null, 2),
            }],
            structuredContent: health,
          };
        } catch (error) {
          return this.handleToolError(error, ErrorType.EXECUTION);
        }
      }
    );
  }

  /**
   * Start server
   *
   * Errors are propagated to caller for proper error handling.
   */
  async start(): Promise<void> {
    // Initialize configuration
    console.error('Loading configuration...');
    await initConfig();

    // Check Deno availability
    console.error('Checking Deno availability...');
    this.denoAvailable = await checkDenoAvailable();

    if (this.denoAvailable) {
      const version = getDenoVersion();
      console.error(`✓ Deno ${version ?? 'found'} - TypeScript execution enabled`);
    } else {
      console.error(getDenoInstallMessage());
      console.error(''); // Empty line for readability
    }

    // Register tools (now that config is initialized and Deno checked)
    this.registerTools();

    // Initialize rate limiter if enabled
    if (isRateLimitEnabled()) {
      const rateLimitConfig = getRateLimitConfig();
      if (rateLimitConfig) {
        this.rateLimiter = new RateLimiter({
          maxRequests: rateLimitConfig.maxRequests,
          windowMs: rateLimitConfig.windowMs,
        });
        console.error(`Rate limiting enabled: ${rateLimitConfig.maxRequests} requests per ${rateLimitConfig.windowMs / 1000}s`);
      }
    }

    // Initialize MCP client pool
    console.error('Initializing MCP client pool...');
    await this.mcpClientPool.initialize();

    const tools = this.mcpClientPool.listAllTools();
    console.error(`Connected to ${tools.length} MCP tools across multiple servers`);

    // Start stdio transport
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error('Code Executor MCP Server started successfully');
  }

  /**
   * Shutdown server
   */
  async shutdown(): Promise<void> {
    // Clean up rate limiter
    if (this.rateLimiter) {
      this.rateLimiter.destroy();
    }

    // Disconnect MCP clients
    await this.mcpClientPool.disconnect();
    process.exit(0);
  }
}

// Start server
const server = new CodeExecutorServer();

// Handle shutdown signals
process.on('SIGINT', async () => {
  console.error('Received SIGINT, shutting down...');
  await server.shutdown();
});

process.on('SIGTERM', async () => {
  console.error('Received SIGTERM, shutting down...');
  await server.shutdown();
});

// Start server
server.start().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
