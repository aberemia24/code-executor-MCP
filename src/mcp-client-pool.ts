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
import type { IToolSchemaProvider, CachedToolSchema } from './types.js';
import type { ToolSchema } from './types/discovery.js';
import type { SchemaCache } from './schema-cache.js';
import { ConnectionQueue } from './connection-queue.js';
import type { MetricsExporter } from './metrics-exporter.js';

/**
 * MCP Client Pool Configuration (US4: FR-4)
 *
 * **WHY Concurrency Limiting?**
 * - Prevents overwhelming MCP servers with too many simultaneous requests
 * - Provides graceful degradation under load (queue vs fail immediately)
 * - Enables backpressure signaling to upstream callers
 *
 * **WHY 100 concurrent requests default?**
 * - Balances throughput vs MCP server resource consumption
 * - Most MCP servers handle 100 concurrent requests comfortably
 * - Configurable via POOL_MAX_CONCURRENT env var for tuning
 *
 * **WHY 200 queue size default?**
 * - See connection-queue.ts for queue size rationale
 * - Provides 2x buffer beyond concurrency limit
 * - Configurable via POOL_QUEUE_SIZE env var
 */
export interface MCPClientPoolConfig {
  /** Maximum concurrent requests (default: 100) */
  maxConcurrent?: number;
  /** Queue size when pool at capacity (default: 200) */
  queueSize?: number;
  /** Queue timeout in milliseconds (default: 30000ms = 30s) */
  queueTimeoutMs?: number;
}

/**
 * MCP Client Pool (US4: FR-4 Integration)
 *
 * Manages connections to multiple MCP servers and routes tool calls.
 * Implements IToolSchemaProvider to enable Dependency Inversion Principle (DIP).
 *
 * **US4 Enhancement: Concurrency Limiting with Overflow Queue**
 * - Tracks active concurrent requests per pool
 * - Queues requests when concurrency limit reached
 * - Records pool metrics (active connections, queue depth, wait time)
 */
export class MCPClientPool implements IToolSchemaProvider {
  private clients: Map<string, Client> = new Map();
  private toolCache: Map<string, ToolInfo> = new Map();
  private processes: Map<string, ProcessInfo> = new Map();
  private initialized = false;

  // US4: Concurrency limiting and overflow queue
  private maxConcurrent: number;
  private activeConcurrent = 0;
  private connectionQueue: ConnectionQueue;
  private metricsExporter?: MetricsExporter;

  /**
   * Constructor (US4: FR-4 Integration)
   *
   * @param config - Optional pool configuration (concurrency limits, queue size)
   * @param metricsExporter - Optional metrics exporter for recording pool metrics
   */
  constructor(config?: MCPClientPoolConfig, metricsExporter?: MetricsExporter) {
    // T053: Configurable concurrency limit (default: 100)
    // Env var: POOL_MAX_CONCURRENT
    this.maxConcurrent = config?.maxConcurrent ?? parseInt(process.env.POOL_MAX_CONCURRENT ?? '100', 10);

    // T053: Initialize connection queue
    this.connectionQueue = new ConnectionQueue({
      maxSize: config?.queueSize ?? parseInt(process.env.POOL_QUEUE_SIZE ?? '200', 10),
      timeoutMs: config?.queueTimeoutMs ?? parseInt(process.env.POOL_QUEUE_TIMEOUT_MS ?? '30000', 10),
    });

    // T054: Optional metrics exporter for recording pool metrics
    this.metricsExporter = metricsExporter;
  }

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
   * Call an MCP tool through the appropriate client (US4: FR-4 Integration)
   *
   * T053: Implements concurrency limiting with overflow queue:
   * 1. Check if at capacity (activeConcurrent >= maxConcurrent)
   * 2. If at capacity, enqueue request and wait
   * 3. If under capacity, execute immediately
   * 4. Record metrics (active connections, queue depth, wait time)
   *
   * @param toolName - Full MCP tool name (e.g., 'mcp__zen__codereview')
   * @param params - Tool parameters
   * @param clientId - Optional client ID for queue tracking (default: 'unknown')
   * @returns Tool result
   */
  async callTool(toolName: string, params: unknown, clientId = 'unknown'): Promise<unknown> {
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

    // T053: Check concurrency limit
    if (this.activeConcurrent >= this.maxConcurrent) {
      // T053: Pool at capacity, enqueue request
      const requestId = `${clientId}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const queueStartTime = Date.now();

      try {
        await this.connectionQueue.enqueue({
          requestId,
          clientId,
          toolName,
        });

        // T054: Record queue depth metric
        const stats = this.connectionQueue.getStats();
        if (this.metricsExporter) {
          this.metricsExporter.setPoolQueueDepth(stats.queueSize);
        }

        // Wait until dequeued (slot available)
        await this.waitForQueueSlot(requestId);

        // T054: Record queue wait time metric
        const queueWaitTimeSeconds = (Date.now() - queueStartTime) / 1000;
        if (this.metricsExporter) {
          this.metricsExporter.recordPoolQueueWait(queueWaitTimeSeconds);
        }
      } catch (error) {
        // Queue full or timeout - return 503
        throw new Error(
          `Service Unavailable: ${(error as Error).message || 'Connection pool queue exhausted'}`
        );
      }
    }

    // T053: Slot available, increment active count
    this.activeConcurrent++;

    // T054: Record active connections metric
    if (this.metricsExporter) {
      this.metricsExporter.setPoolActiveConnections(this.activeConcurrent);
    }

    try {
      // Get client for this server
      const client = this.clients.get(toolInfo.server);
      if (!client) {
        throw new Error(`No client connected for server: ${toolInfo.server}`);
      }

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
    } finally {
      // T053: Decrement active count (slot freed)
      this.activeConcurrent--;

      // T054: Update active connections metric
      if (this.metricsExporter) {
        this.metricsExporter.setPoolActiveConnections(this.activeConcurrent);
      }

      // T053: Process next queued request if any
      await this.processNextQueuedRequest();
    }
  }

  /**
   * Wait for queue slot to become available (T053)
   *
   * Polls the queue until this request is dequeued or timeout occurs.
   *
   * @param requestId - Request ID to wait for
   * @private
   */
  private async waitForQueueSlot(requestId: string): Promise<void> {
    // Poll every 100ms until dequeued
    while (true) {
      const nextRequest = await this.connectionQueue.dequeue();

      if (nextRequest && nextRequest.requestId === requestId) {
        // Our request dequeued, proceed
        return;
      }

      if (nextRequest && nextRequest.requestId !== requestId) {
        // Different request dequeued, re-enqueue it
        await this.connectionQueue.enqueue(nextRequest);
      }

      // Wait 100ms before next poll
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Process next queued request (T053)
   *
   * Called after a slot is freed to trigger processing of waiting requests.
   *
   * @private
   */
  private async processNextQueuedRequest(): Promise<void> {
    // Dequeue next request (triggers waitForQueueSlot to resolve)
    await this.connectionQueue.dequeue();

    // Update queue depth metric
    const stats = this.connectionQueue.getStats();
    if (this.metricsExporter) {
      this.metricsExporter.setPoolQueueDepth(stats.queueSize);
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
        outputSchema: tool.outputSchema, // Graceful fallback: undefined if not present
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
        // inputSchema → parameters, description? → description (required), outputSchema (optional)
        return {
          name: fullToolName,
          description: schema.description ?? '',
          parameters: schema.inputSchema,
          outputSchema: schema.outputSchema, // Graceful fallback: undefined if not present
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
