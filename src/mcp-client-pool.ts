/**
 * MCP Client Pool - Manages connections to multiple MCP servers
 *
 * This class creates MCP clients that connect to other servers (zen, playwright, etc.)
 * and provides a unified callTool() interface that routes calls to the appropriate server.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { MCP_CONFIG_PATH } from './constants.js';
import { extractServerName, isValidMCPToolName, normalizeError } from './utils.js';
import type { MCPConfig, MCPServerConfig, ToolInfo } from './types.js';

/**
 * MCP Client Pool
 *
 * Manages connections to multiple MCP servers and routes tool calls
 */
export class MCPClientPool {
  private clients: Map<string, Client> = new Map();
  private toolCache: Map<string, ToolInfo> = new Map();
  private initialized = false;

  /**
   * Initialize client pool by reading config and connecting to servers
   */
  async initialize(configPath: string = MCP_CONFIG_PATH): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Read MCP configuration
      const configContent = await fs.readFile(configPath, 'utf-8');
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

      // If ALL servers failed, throw error
      if (failures.length === serverNames.length) {
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
   * Connect to a single MCP server
   */
  private async connectToServer(serverName: string, config: MCPServerConfig): Promise<void> {
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

    // Store client
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
   * Check if a tool is available
   */
  hasTool(toolName: string): boolean {
    return this.toolCache.has(toolName);
  }

  /**
   * Disconnect all clients
   */
  async disconnect(): Promise<void> {
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

    this.clients.clear();
    this.toolCache.clear();
    this.initialized = false;
  }
}
