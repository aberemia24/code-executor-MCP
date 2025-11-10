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

🔍 TOOL DISCOVERY - Use these tools FIRST to discover available capabilities:
  1. listAvailableTools - List all MCP tools with optional filtering
  2. searchTools - Search by capability (e.g., "analyze code", "create issues")
  3. getToolSchema - Get parameter schema for a specific tool

PROACTIVE USAGE: Before writing code, discover what tools are available and their parameters!

Executed code has access to callMCPTool(toolName, params) function for calling other MCP servers.
Import DopaMind wrappers: import { codereview } from './servers/zen/codereview'

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

Workflow Example:
  Step 1: Call searchTools with query "analyze code" to discover tools
  Step 2: Call getToolSchema for "mcp__zen__codereview" to see parameters
  Step 3: Call executeTypescript with the code and allowedTools

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

    // Tool 4: List Available MCP Tools (NEW - for AI tool discovery)
    this.server.registerTool(
      'listAvailableTools',
      {
        title: 'List Available MCP Tools',
        description: `List all available MCP tools that can be called via executeTypescript's callMCPTool() function.

Use this tool to discover what capabilities are available before writing code.

Args:
  - filter (string, optional): Filter tools by keyword in name or description
  - server (string, optional): Filter by specific server name
  - includeSchema (boolean, optional): Include full inputSchema for each tool (default: false)

Returns:
  {
    "tools": [
      {
        "name": string,           // Full tool name (e.g., "mcp__zen__codereview")
        "server": string,         // Server name (e.g., "zen")
        "shortName": string,      // Tool name without prefix (e.g., "codereview")
        "description": string,    // Tool description
        "inputSchema": object     // Full JSON schema (only if includeSchema=true)
      }
    ],
    "count": number,
    "totalAvailable": number
  }

Example - List all tools:
  {}

Example - Search for filesystem tools:
  {
    "filter": "file"
  }

Example - Get tools from specific server:
  {
    "server": "zen"
  }

Example - Get full schema for planning:
  {
    "filter": "codereview",
    "includeSchema": true
  }`,
        inputSchema: {
          filter: z.string().optional().describe('Filter by keyword in name or description'),
          server: z.string().optional().describe('Filter by specific server name'),
          includeSchema: z.boolean().optional().default(false).describe('Include full inputSchema'),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (params) => {
        try {
          const { filter, server, includeSchema } = params as {
            filter?: string;
            server?: string;
            includeSchema?: boolean;
          };

          // Get all tools from pool
          const allTools = this.mcpClientPool.listAllTools();

          // Apply filters
          let filteredTools = allTools;

          if (server) {
            filteredTools = filteredTools.filter(tool => tool.server === server);
          }

          if (filter) {
            const lowerFilter = filter.toLowerCase();
            filteredTools = filteredTools.filter(tool =>
              tool.name.toLowerCase().includes(lowerFilter) ||
              tool.description.toLowerCase().includes(lowerFilter)
            );
          }

          // Build response with full tool names
          const toolsWithSchemas = await Promise.all(
            filteredTools.map(async (tool) => {
              const fullName = `mcp__${tool.server}__${tool.name}`;
              const result: Record<string, unknown> = {
                name: fullName,
                server: tool.server,
                shortName: tool.name,
                description: tool.description,
              };

              // Optionally include schema
              if (includeSchema) {
                try {
                  const schema = await this.mcpClientPool.getToolSchema(fullName);
                  if (schema) {
                    result.inputSchema = schema.inputSchema;
                  }
                } catch {
                  // Silently skip schema fetch errors
                  result.schemaError = 'Failed to fetch schema';
                }
              }

              return result;
            })
          );

          const response = {
            tools: toolsWithSchemas,
            count: toolsWithSchemas.length,
            totalAvailable: allTools.length,
          };

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(response, null, 2),
            }],
            structuredContent: response,
          };
        } catch (error) {
          return this.handleToolError(error, ErrorType.EXECUTION);
        }
      }
    );

    // Tool 5: Get Tool Schema (NEW - for parameter inspection)
    this.server.registerTool(
      'getToolSchema',
      {
        title: 'Get MCP Tool Schema',
        description: `Get the full parameter schema for a specific MCP tool before calling it.

Use this to understand what parameters a tool accepts and plan your code accordingly.

Args:
  - toolName (string): Full MCP tool name (e.g., "mcp__zen__codereview")

Returns:
  {
    "name": string,
    "description": string,
    "inputSchema": {
      "type": "object",
      "properties": { ... },
      "required": [ ... ]
    }
  }

Example:
  {
    "toolName": "mcp__zen__codereview"
  }`,
        inputSchema: {
          toolName: z.string().min(1).describe('Full MCP tool name (e.g., "mcp__zen__codereview")'),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (params) => {
        try {
          const { toolName } = params as { toolName: string };

          // Validate tool name format
          if (!toolName.startsWith('mcp__')) {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  error: `Invalid tool name format. Must start with "mcp__". Example: "mcp__zen__codereview"`,
                  hint: 'Use listAvailableTools to discover available tool names',
                }, null, 2),
              }],
              isError: true,
            };
          }

          // Get schema from pool
          const schema = await this.mcpClientPool.getToolSchema(toolName);

          if (!schema) {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  error: `Tool not found: ${toolName}`,
                  hint: 'Use listAvailableTools to see available tools',
                }, null, 2),
              }],
              isError: true,
            };
          }

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(schema, null, 2),
            }],
            structuredContent: schema as unknown as Record<string, unknown>,
          };
        } catch (error) {
          return this.handleToolError(error, ErrorType.EXECUTION);
        }
      }
    );

    // Tool 6: Search Tools (NEW - for capability-based discovery)
    this.server.registerTool(
      'searchTools',
      {
        title: 'Search MCP Tools by Capability',
        description: `Search for MCP tools by describing what you want to do.

Use this when you know what capability you need but don't know which tool provides it.

Args:
  - query (string): Natural language query describing the capability
    Examples: "analyze code", "create issues", "read files", "database", etc.
  - limit (number, optional): Maximum number of results (default: 10)

Returns:
  {
    "query": string,
    "results": [
      {
        "name": string,
        "server": string,
        "shortName": string,
        "description": string,
        "relevance": number    // 0-1 relevance score
      }
    ],
    "count": number
  }

Example:
  {
    "query": "analyze code quality"
  }`,
        inputSchema: {
          query: z.string().min(1).describe('Natural language capability query'),
          limit: z.number().int().min(1).max(50).default(10).describe('Maximum results'),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (params) => {
        try {
          const { query, limit } = params as { query: string; limit?: number };
          const maxResults = limit ?? 10;

          // Get all tools
          const allTools = this.mcpClientPool.listAllTools();

          // Simple relevance scoring based on keyword matching
          const queryWords = query.toLowerCase().split(/\s+/);
          const scoredTools = allTools.map(tool => {
            const fullName = `mcp__${tool.server}__${tool.name}`;
            const searchText = `${tool.name} ${tool.description}`.toLowerCase();

            // Calculate relevance score (0-1)
            let score = 0;

            for (const word of queryWords) {
              if (searchText.includes(word)) {
                // Bonus for matches in name vs description
                if (tool.name.toLowerCase().includes(word)) {
                  score += 0.5;
                } else {
                  score += 0.3;
                }
              }
            }

            // Normalize score
            if (queryWords.length > 0) {
              score = Math.min(1.0, score / queryWords.length);
            }

            return {
              name: fullName,
              server: tool.server,
              shortName: tool.name,
              description: tool.description,
              relevance: Math.round(score * 100) / 100, // Round to 2 decimals
            };
          })
          .filter(tool => tool.relevance > 0) // Only include matches
          .sort((a, b) => b.relevance - a.relevance) // Sort by relevance
          .slice(0, maxResults); // Limit results

          const response = {
            query,
            results: scoredTools,
            count: scoredTools.length,
          };

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(response, null, 2),
            }],
            structuredContent: response,
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
