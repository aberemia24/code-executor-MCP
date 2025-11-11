/**
 * MCP Client Pool - Manages connections to multiple MCP servers
 *
 * This class creates MCP clients that connect to other servers (zen, playwright, etc.)
 * and provides a unified callTool() interface that routes calls to the appropriate server.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import * as fs from 'fs/promises';
import { getMCPConfigPath } from './config.js';
import { isValidMCPToolName, normalizeError } from './utils.js';
import type { MCPConfig, MCPServerConfig, ToolInfo, ProcessInfo, StdioServerConfig, HttpServerConfig } from './types.js';
import { isStdioConfig, isHttpConfig } from './types.js';
import type { CachedToolSchema } from './schema-cache.js';
import type { ToolSchema } from './types/discovery.js';
import type { SchemaCache } from './schema-cache.js';

/**
 * MCP Client Pool
 *
 * Manages connections to multiple MCP servers and routes tool calls
 */
export class MCPClientPool {
  private clients: Map<string, Client> = new Map();
  private toolCache: Map<string, ToolInfo> = new Map();
  private processes: Map<string, ProcessInfo> = new Map();
  private initialized = false;

  /**
   * Initialize client pool by reading config and connecting to servers
   */
  async initialize(configPath?: string): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Resolve config path if not provided
      const resolvedPath = configPath ?? await getMCPConfigPath();

      // Read MCP configuration
      const configContent = await fs.readFile(resolvedPath, 'utf-8');
      const config: MCPConfig = JSON.parse(configContent);

      // Filter out code-executor to prevent circular dependency
      const filteredServers = Object.entries(config.mcpServers).filter(
        ([serverName]) => serverName !== 'code-executor'
      );

      console.error(`🔌 Initializing MCP client pool (excluding self, ${filteredServers.length} servers)`);

      // Connect to each configured server with detailed error tracking
      const serverNames = filteredServers.map(([name]) => name);
      const connections = filteredServers.map(
        ([serverName, serverConfig]) =>
          this.connectToServer(serverName, serverConfig)
      );

      const results = await Promise.allSettled(connections);

      // Track failures
      const failures = results.filter(r => r.status === 'rejected');

      // If ALL servers failed (and there were servers to connect to), throw error
      // Allow zero servers as valid configuration (code-executor can run standalone)
      if (serverNames.length > 0 && failures.length === serverNames.length) {
        const errorMessages = results
          .map((r, i) => {
            if (r.status === 'rejected') {
              return `  - ${serverNames[i]}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`;
            }
            return '';
          })
          .filter(Boolean)
          .join('\n');

        throw new Error(
          `All MCP server connections failed. Check .mcp.json configuration:\n${errorMessages}`
        );
      }

      // If zero servers configured, log info message
      if (serverNames.length === 0) {
        console.error('ℹ️  No other MCP servers configured (code-executor running standalone)');
      }

      // If some servers failed, warn but continue
      if (failures.length > 0) {
        console.warn(`⚠️  ${failures.length}/${serverNames.length} MCP servers failed to connect`);
        failures.forEach((f, i) => {
          if (f.status === 'rejected') {
            const serverName = serverNames[i];
            console.error(`  ✗ ${serverName}: ${f.reason instanceof Error ? f.reason.message : String(f.reason)}`);
          }
        });
      }

      // Report successful connections
      const successes = results.filter(r => r.status === 'fulfilled').length;
      console.error(`✓ Connected to ${successes}/${serverNames.length} MCP servers`);

      // Cache tool listings
      await this.cacheToolListings();

      this.initialized = true;
    } catch (error) {
      throw normalizeError(error, 'Failed to initialize MCP client pool');
    }
  }

  /**
   * Connect to a single MCP server (dispatcher)
   */
  private async connectToServer(serverName: string, config: MCPServerConfig): Promise<void> {
    if (isStdioConfig(config)) {
      await this.connectStdio(serverName, config);
    } else if (isHttpConfig(config)) {
      await this.connectHttp(serverName, config);
    } else {
      throw new Error(`Unknown transport type for server: ${serverName}`);
    }
  }

  /**
   * Connect to STDIO-based MCP server
   */
  private async connectStdio(serverName: string, config: StdioServerConfig): Promise<void> {
    // Create client
    const client = new Client(
      {
        name: 'code-executor-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    // Create STDIO transport
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: {
        ...(process.env as Record<string, string>),
        ...config.env,
      },
    });

    // Connect to server
    await client.connect(transport);

    // Track process for cleanup
    if (transport.pid) {
      this.processes.set(serverName, {
        pid: transport.pid,
        serverName,
      });
    }

    // Store client
    this.clients.set(serverName, client);
  }

  /**
   * Connect to HTTP/SSE-based MCP server
   *
   * Tries StreamableHTTP first (modern), falls back to SSE (legacy)
   */
  private async connectHttp(serverName: string, config: HttpServerConfig): Promise<void> {
    // Create client
    const client = new Client(
      {
        name: 'code-executor-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    let connected = false;

    // Try StreamableHTTP first (modern)
    try {
      const transport = new StreamableHTTPClientTransport(
        new URL(config.url),
        {
          requestInit: {
            headers: config.headers,
          },
        }
      );
      await client.connect(transport);
      connected = true;
      console.error(`✓ Connected to ${serverName} via StreamableHTTP`);
    } catch {
      console.error(`⚠️  StreamableHTTP failed for ${serverName}, trying SSE...`);
    }

    // Fallback to SSE if StreamableHTTP failed
    if (!connected) {
      const transport = new SSEClientTransport(
        new URL(config.url),
        {
          requestInit: {
            headers: config.headers,
          },
        }
      );
      await client.connect(transport);
      console.error(`✓ Connected to ${serverName} via SSE (fallback)`);
    }

    // Store client (no PID for HTTP servers)
    this.clients.set(serverName, client);
  }

  /**
   * Cache tool listings from all connected servers
   */
  private async cacheToolListings(): Promise<void> {
    for (const [serverName, client] of this.clients.entries()) {
      try {
        const tools = await client.listTools();

        for (const tool of tools.tools) {
          const fullToolName = `mcp__${serverName}__${tool.name}`;
          this.toolCache.set(fullToolName, {
            server: serverName,
            name: tool.name,
            description: tool.description ?? '',
          });
        }
      } catch (error) {
        console.error(`Failed to list tools for ${serverName}:`, error);
      }
    }
  }

  /**
   * Call an MCP tool through the appropriate client
   *
   * @param toolName - Full MCP tool name (e.g., 'mcp__zen__codereview')
   * @param params - Tool parameters
   * @returns Tool result
   */
  async callTool(toolName: string, params: unknown): Promise<unknown> {
    if (!this.initialized) {
      throw new Error('MCPClientPool not initialized. Call initialize() first.');
    }

    // Validate tool name format
    if (!isValidMCPToolName(toolName)) {
      throw new Error(
        `Invalid MCP tool name: ${toolName}. Must match pattern: mcp__<server>__<tool>`
      );
    }

    // Check if tool exists in cache
    const toolInfo = this.toolCache.get(toolName);
    if (!toolInfo) {
      throw new Error(
        `Tool not found: ${toolName}. Available tools: ${Array.from(this.toolCache.keys()).join(', ')}`
      );
    }

    // Get client for this server
    const client = this.clients.get(toolInfo.server);
    if (!client) {
      throw new Error(`No client connected for server: ${toolInfo.server}`);
    }

    try {
      // Call tool through client
      const result = await client.callTool({
        name: toolInfo.name,
        arguments: params as Record<string, unknown>,
      });

      // Extract result from content
      const content = result.content as Array<{ type: string; text?: string }> | undefined;
      if (content && content.length > 0) {
        const firstContent = content[0];
        if (firstContent && firstContent.type === 'text' && firstContent.text) {
          return firstContent.text;
        }
      }

      return result;
    } catch (error) {
      throw normalizeError(error, `MCP tool '${toolName}' failed`);
    }
  }

  /**
   * Get list of all available tools
   */
  listAllTools(): ToolInfo[] {
    return Array.from(this.toolCache.values());
  }

  /**
   * Get full tool schema including inputSchema
   *
   * @param toolName - Full MCP tool name (e.g., 'mcp__zen__codereview')
   * @returns Full tool schema with inputSchema, or null if not found
   */
  async getToolSchema(toolName: string): Promise<CachedToolSchema | null> {
    if (!this.initialized) {
      throw new Error('MCPClientPool not initialized. Call initialize() first.');
    }

    // Check if tool exists in cache
    const toolInfo = this.toolCache.get(toolName);
    if (!toolInfo) {
      return null;
    }

    // Get client for this server
    const client = this.clients.get(toolInfo.server);
    if (!client) {
      throw new Error(`No client connected for server: ${toolInfo.server}`);
    }

    try {
      // Fetch full tool list from server (includes inputSchema)
      const tools = await client.listTools();

      // Find the specific tool
      const tool = tools.tools.find(t => t.name === toolInfo.name);
      if (!tool) {
        return null;
      }

      return {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      };
    } catch (error) {
      throw normalizeError(error, `Failed to fetch schema for ${toolName}`);
    }
  }

  /**
   * Check if a tool is available
   */
  hasTool(toolName: string): boolean {
    return this.toolCache.has(toolName);
  }

  /**
   * List all tool schemas from all connected MCP servers
   *
   * Uses SchemaCache to retrieve schemas efficiently. First call populates cache (50-100ms),
   * subsequent calls return cached schemas (<5ms). This is used by the discovery endpoint
   * to return full tool metadata including parameter schemas.
   *
   * Performance:
   * - First call (cache miss): 50-100ms (populates cache via network calls)
   * - Subsequent calls (cache hit): <5ms (from in-memory LRU cache)
   * - 20x faster than direct MCP server queries
   * - 24h TTL with disk persistence (survives restarts)
   *
   * Resilient aggregation: If one server's schema fetch fails, returns partial results
   * from successful servers. Uses stale cache as fallback on network errors.
   *
   * @param schemaCache - SchemaCache instance for retrieving cached schemas
   * @returns Array of tool schemas from all connected servers
   *
   * @example
   * ```typescript
   * const schemas = await clientPool.listAllToolSchemas(schemaCache);
   * // First call: 50-100ms (populates cache)
   * // Returns: [{ name: 'mcp__zen__codereview', description: '...', parameters: {...} }, ...]
   *
   * // Second call: <5ms (from cache)
   * const cachedSchemas = await clientPool.listAllToolSchemas(schemaCache);
   * ```
   */
  async listAllToolSchemas(schemaCache: SchemaCache): Promise<ToolSchema[]> {
    if (!this.initialized) {
      throw new Error('MCPClientPool not initialized. Call initialize() first.');
    }

    // Use in-memory listAllTools() to get tool list (no network calls)
    // This is O(1) constant time - just returns cached Map values
    const allTools = this.listAllTools();

    // Fetch schemas in parallel using SchemaCache (respects cache TTL)
    // On cache hit: <5ms per schema (in-memory)
    // On cache miss: 50-100ms per schema (network call + cache population)
    const schemaQueries = allTools.map(async (toolInfo) => {
      const fullToolName = `mcp__${toolInfo.server}__${toolInfo.name}`;

      try {
        // Retrieve schema from cache (or fetch if missing/expired)
        const schema = await schemaCache.getToolSchema(fullToolName);

        if (!schema) {
          // Tool exists in tool list but schema unavailable
          // This can happen if MCP server is unreachable
          console.warn(`Schema not found for ${fullToolName} (server may be down)`);
          return null;
        }

        // Transform CachedToolSchema to ToolSchema format
        // inputSchema → parameters, description? → description (required)
        return {
          name: fullToolName,
          description: schema.description ?? '',
          parameters: schema.inputSchema,
        } as ToolSchema;
      } catch (error) {
        // Resilient aggregation: log error but continue with other tools
        console.error(`Failed to fetch schema for ${fullToolName}:`, error);
        return null;
      }
    });

    // Execute all schema queries in parallel
    const results = await Promise.all(schemaQueries);

    // Filter out null results (failed schema fetches) and return successful ones
    return results.filter((schema): schema is ToolSchema => schema !== null);
  }

  /**
   * Disconnect all clients and kill child processes
   *
   * Graceful shutdown: SIGTERM → wait 2s → SIGKILL
   */
  async disconnect(): Promise<void> {
    // Close MCP clients
    const disconnections = Array.from(this.clients.values()).map(
      async (client) => {
        try {
          await client.close();
        } catch (error) {
          console.error('Error disconnecting client:', error);
        }
      }
    );

    await Promise.all(disconnections);

    // Kill child processes (STDIO servers only)
    const processCleanup = Array.from(this.processes.values()).map(
      async (processInfo) => {
        try {
          const { pid, serverName } = processInfo;

          // Try graceful shutdown (SIGTERM)
          try {
            process.kill(pid, 'SIGTERM');
            console.error(`✓ Sent SIGTERM to ${serverName} (PID ${pid})`);

            // Wait 2 seconds for graceful shutdown
            await new Promise((resolve) => setTimeout(resolve, 2000));

            // Check if process still exists
            try {
              process.kill(pid, 0); // Signal 0 checks existence
              // Process still alive, force kill
              process.kill(pid, 'SIGKILL');
              console.error(`⚠️  Force killed ${serverName} (PID ${pid}) with SIGKILL`);
            } catch {
              // Process already exited
              console.error(`✓ ${serverName} (PID ${pid}) exited gracefully`);
            }
          } catch (error) {
            // Process might already be dead, safe to ignore
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
              console.error(`Error killing ${serverName} (PID ${pid}):`, error);
            }
          }
        } catch (error) {
          console.error('Error during process cleanup:', error);
        }
      }
    );

    await Promise.all(processCleanup);

    // Clear all state
    this.clients.clear();
    this.toolCache.clear();
    this.processes.clear();
    this.initialized = false;
  }
}
