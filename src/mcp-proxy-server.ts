/**
 * MCP Proxy Server
 *
 * HTTP server that proxies MCP tool calls from sandboxed code execution environments.
 * Shared by TypeScript (Deno) and Python executors.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { normalizeError } from './utils.js';
import { AllowlistValidator, ToolCallTracker } from './proxy-helpers.js';
import { SchemaCache } from './schema-cache.js';
import { SchemaValidator } from './schema-validator.js';
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
  private authToken: string;
  private validator: AllowlistValidator;
  private tracker: ToolCallTracker;
  private schemaCache: SchemaCache;
  private schemaValidator: SchemaValidator;

  /**
   * Create MCP proxy server
   *
   * @param mcpClientPool - Pool of MCP clients to proxy requests to
   * @param allowedTools - Whitelist of allowed MCP tool names
   *
   * SECURITY: Generates random bearer token for authentication
   */
  constructor(
    private mcpClientPool: MCPClientPool,
    allowedTools: string[]
  ) {
    this.validator = new AllowlistValidator(allowedTools);
    this.tracker = new ToolCallTracker();
    this.schemaCache = new SchemaCache(mcpClientPool);
    this.schemaValidator = new SchemaValidator();
    // Generate cryptographically secure random token (32 bytes = 64 hex chars)
    this.authToken = crypto.randomBytes(32).toString('hex');
  }

  /**
   * Start proxy server on random port
   *
   * SECURITY: Returns both port and authentication token.
   * The sandbox code will connect to localhost:<port> with Bearer token.
   *
   * Pre-populates schema cache before starting to ensure fast validation.
   *
   * @returns Object with port number and auth token
   */
  async start(): Promise<{ port: number; authToken: string }> {
    // Pre-populate schema cache (loads from disk + fetches missing/expired)
    await this.schemaCache.prePopulate();

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // Only accept POST requests
        if (req.method !== 'POST') {
          res.writeHead(405);
          res.end();
          return;
        }

        // SECURITY: Validate bearer token authentication (constant-time comparison)
        const authHeader = req.headers['authorization'];
        if (!this.validateBearerToken(authHeader)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Unauthorized - invalid or missing authentication token'
          }));
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
            const allowedTools = this.validator.getAllowedTools();
            res.writeHead(403);
            res.end(JSON.stringify({
              error: `Tool '${toolName}' not in allowlist`,
              allowedTools: allowedTools.length > 0 ? allowedTools : ['(empty - no tools allowed)'],
              suggestion: `Add '${toolName}' to allowedTools array`
            }));
            return;
          }

          // Validate parameters against schema
          const schema = await this.schemaCache.getToolSchema(toolName);
          if (schema) {
            const validation = this.schemaValidator.validate(params, schema);
            if (!validation.valid) {
              const errorMessage = this.schemaValidator.formatError(
                toolName,
                params,
                schema,
                validation
              );
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: errorMessage }));
              return;
            }
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

      // SECURITY: Bind explicitly to 127.0.0.1 (not just 'localhost')
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server!.address();
        if (address && typeof address !== 'string') {
          this.port = address.port;
          resolve({ port: this.port, authToken: this.authToken });
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
   * Get the authentication token
   *
   * SECURITY: Used to inject token into sandbox environment
   */
  getAuthToken(): string {
    return this.authToken;
  }

  /**
   * Get list of all MCP tool calls made through this proxy
   *
   * Used for audit logging and tracking tool usage.
   */
  getToolCalls(): string[] {
    return this.tracker.getCalls();
  }


  /**
   * Validate bearer token using constant-time comparison
   *
   * SECURITY: Prevents timing attacks that could be used to brute-force the token.
   * Uses crypto.timingSafeEqual to ensure comparison takes constant time regardless
   * of where strings differ.
   *
   * @param authHeader - Authorization header value (e.g., "Bearer <token>")
   * @returns True if token is valid, false otherwise
   */
  private validateBearerToken(authHeader: string | undefined): boolean {
    if (!authHeader) {
      return false;
    }

    // Parse Bearer token
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return false;
    }

    const providedToken = parts[1];
    if (!providedToken) {
      return false;
    }

    // Constant-time comparison to prevent timing attacks
    try {
      const providedBuffer = Buffer.from(providedToken, 'utf8');
      const validBuffer = Buffer.from(this.authToken, 'utf8');

      // timingSafeEqual throws if lengths differ, so check length first
      if (providedBuffer.length !== validBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(providedBuffer, validBuffer);
    } catch {
      // Any error (including length mismatch) returns false
      return false;
    }
  }
}
