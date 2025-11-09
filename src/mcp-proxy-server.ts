/**
 * MCP Proxy Server
 *
 * HTTP server that proxies MCP tool calls from sandboxed code execution environments.
 * Shared by TypeScript (Deno) and Python executors.
 */

import * as http from 'http';
import { normalizeError } from './utils.js';
import { AllowlistValidator, ToolCallTracker } from './proxy-helpers.js';
import type { MCPClientPool } from './mcp-client-pool.js';

/**
 * MCP proxy server that handles callMCPTool requests from sandbox
 *
 * Architecture:
 * - Sandbox (Deno/Python) → HTTP POST → MCPProxyServer → MCPClientPool → MCP tools
 * - Provides callMCPTool() / call_mcp_tool() function injected into sandbox
 * - Validates tool access against allowlist before proxying
 * - Tracks all tool calls for audit logging
 *
 * Refactored to follow SRP:
 * - AllowlistValidator: Tool allowlist validation
 * - ToolCallTracker: Tool call tracking
 * - MCPProxyServer: HTTP routing only
 *
 * @example
 * const proxy = new MCPProxyServer(clientPool, ['mcp__zen__codereview']);
 * const port = await proxy.start();
 * // Sandbox can now call: callMCPTool('mcp__zen__codereview', {...})
 * await proxy.stop();
 */
export class MCPProxyServer {
  private server: http.Server | null = null;
  private port = 0;
  private validator: AllowlistValidator;
  private tracker: ToolCallTracker;

  /**
   * Create MCP proxy server
   *
   * @param mcpClientPool - Pool of MCP clients to proxy requests to
   * @param allowedTools - Whitelist of allowed MCP tool names
   */
  constructor(
    private mcpClientPool: MCPClientPool,
    allowedTools: string[]
  ) {
    this.validator = new AllowlistValidator(allowedTools);
    this.tracker = new ToolCallTracker();
  }

  /**
   * Start proxy server on random port
   *
   * Returns the port number that the server is listening on.
   * The sandbox code will connect to localhost:<port> to call MCP tools.
   */
  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // Only accept POST requests
        if (req.method !== 'POST') {
          res.writeHead(405);
          res.end();
          return;
        }

        try {
          // Read request body
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(chunk as Buffer);
          }
          const body = Buffer.concat(chunks).toString();
          const { toolName, params } = JSON.parse(body) as {
            toolName: string;
            params: unknown;
          };

          // Validate against allowlist
          if (!this.validator.isAllowed(toolName)) {
            res.writeHead(403);
            res.end(JSON.stringify({
              error: `Tool '${toolName}' not in allowlist`,
              suggestion: `Add '${toolName}' to allowedTools array`
            }));
            return;
          }

          // Track tool call
          this.tracker.track(toolName);

          // Call MCP tool through pool
          const result = await this.mcpClientPool.callTool(toolName, params);

          // Return result
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result }));
        } catch (error) {
          res.writeHead(500);
          res.end(JSON.stringify({
            error: normalizeError(error, 'MCP tool call failed').message
          }));
        }
      });

      this.server.listen(0, 'localhost', () => {
        const address = this.server!.address();
        if (address && typeof address !== 'string') {
          this.port = address.port;
          resolve(this.port);
        } else {
          reject(new Error('Failed to get server port'));
        }
      });
    });
  }

  /**
   * Stop proxy server
   *
   * Closes the HTTP server and releases the port.
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  /**
   * Get the port number the server is listening on
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Get list of all MCP tool calls made through this proxy
   *
   * Used for audit logging and tracking tool usage.
   */
  getToolCalls(): string[] {
    return this.tracker.getCalls();
  }
}
