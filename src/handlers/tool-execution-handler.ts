/**
 * Tool Execution Handler (SMELL-001 God Object Refactor)
 *
 * Handles POST / endpoint - MCP tool execution.
 *
 * Responsibilities:
 * - Parse request body (toolName, params)
 * - Validate against allowlist
 * - Validate parameters against JSON Schema (AJV)
 * - Execute tool via MCPClientPool
 * - Track tool calls for audit (success/error)
 * - Record metrics (duration, status code)
 * - Return result or error
 *
 * Complexity: HIGH (130 lines, 6 dependencies, critical path)
 *
 * WHY separate handler?
 * - Most complex endpoint: allowlist, schema validation, execution, tracking
 * - Critical path: Tool execution is the primary use case
 * - Many dependencies: AllowlistValidator, SchemaValidator, ToolCallTracker, etc.
 * - Testability: Mock all dependencies, verify validation/execution logic
 *
 * SECURITY: Enforces allowlist validation (execution requires explicit permission).
 *
 * @see https://github.com/aberemia24/code-executor-MCP/issues/42
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { IRequestHandler, HandlerDependencies } from './request-handler.interface.js';
import type { AllowlistValidator, ToolCallTracker } from '../proxy-helpers.js';
import type { SchemaCache } from '../schema-cache.js';
import type { SchemaValidator } from '../schema-validator.js';
import { normalizeError } from '../utils.js';

/**
 * Tool execution handler options
 */
export interface ToolExecutionHandlerOptions extends HandlerDependencies {
  /** Allowlist validator for checking tool permissions */
  allowlistValidator: AllowlistValidator;

  /** Tool call tracker for audit logging */
  toolCallTracker: ToolCallTracker;

  /** Schema cache for fetching tool schemas */
  schemaCache: SchemaCache;

  /** Schema validator for validating parameters */
  schemaValidator: SchemaValidator;
}

/**
 * Handles POST / - MCP Tool Execution Endpoint
 *
 * Primary endpoint for executing MCP tools from sandboxed code.
 * Request format: { toolName: string, params: unknown }
 * Response format: { result: unknown } or { error: string }
 *
 * Validation flow:
 * 1. Parse JSON body
 * 2. Check allowlist (403 if not allowed)
 * 3. Validate params against schema (400 if invalid)
 * 4. Execute tool via MCPClientPool
 * 5. Track call for audit
 * 6. Return result (200) or error (500)
 */
export class ToolExecutionHandler implements IRequestHandler {
  /**
   * Create tool execution handler
   *
   * @param options - Handler dependencies
   */
  constructor(private options: ToolExecutionHandlerOptions) {}

  /**
   * Handle POST / request
   *
   * @param req - HTTP request
   * @param res - HTTP response
   * @param authToken - Pre-validated auth token (for audit logging)
   */
  async handle(
    _req: IncomingMessage,
    res: ServerResponse,
    _authToken: string
  ): Promise<void> {
    const startTime = process.hrtime.bigint();

    try {
      // Read request body
      const chunks: Buffer[] = [];
      for await (const chunk of _req) {
        chunks.push(chunk as Buffer);
      }
      const body = Buffer.concat(chunks).toString();
      const { toolName, params } = JSON.parse(body) as {
        toolName: string;
        params: unknown;
      };

      // Validate against allowlist
      if (!this.options.allowlistValidator.isAllowed(toolName)) {
        const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
        this.options.metricsExporter.recordHttpRequest('POST', 403);
        this.options.metricsExporter.recordHttpDuration('POST', '/', duration);

        const allowedTools = this.options.allowlistValidator.getAllowedTools();
        res.writeHead(403);
        res.end(
          JSON.stringify({
            error: `Tool '${toolName}' not in allowlist`,
            allowedTools:
              allowedTools.length > 0
                ? allowedTools
                : ['(empty - no tools allowed)'],
            suggestion: `Add '${toolName}' to allowedTools array`,
          })
        );
        return;
      }

      // Validate parameters against schema
      const schema = await this.options.schemaCache.getToolSchema(toolName);
      if (schema) {
        const validation = this.options.schemaValidator.validate(params, schema);
        if (!validation.valid) {
          const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
          this.options.metricsExporter.recordHttpRequest('POST', 400);
          this.options.metricsExporter.recordHttpDuration('POST', '/', duration);

          const errorMessage = this.options.schemaValidator.formatError(
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

      const start = process.hrtime.bigint();
      try {
        // Call MCP tool through pool
        const result = await this.options.mcpClientPool.callTool(toolName, params);

        const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
        this.options.toolCallTracker.track(toolName, {
          durationMs,
          status: 'success',
        });

        // Record successful request metrics
        const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
        this.options.metricsExporter.recordHttpRequest('POST', 200);
        this.options.metricsExporter.recordHttpDuration('POST', '/', duration);

        // Return result
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result }));
        return;
      } catch (toolError) {
        const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
        const normalized = normalizeError(toolError, 'MCP tool call failed');

        this.options.toolCallTracker.track(toolName, {
          durationMs,
          status: 'error',
          errorMessage: normalized.message,
        });

        // Record error request metrics
        const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
        this.options.metricsExporter.recordHttpRequest('POST', 500);
        this.options.metricsExporter.recordHttpDuration('POST', '/', duration);

        res.writeHead(500);
        res.end(
          JSON.stringify({
            error: normalized.message,
          })
        );
        return;
      }
    } catch (error) {
      const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
      this.options.metricsExporter.recordHttpRequest('POST', 500);
      this.options.metricsExporter.recordHttpDuration('POST', '/', duration);

      res.writeHead(500);
      res.end(
        JSON.stringify({
          error: normalizeError(error, 'MCP tool call failed').message,
        })
      );
    }
  }

  /**
   * Get list of all tool calls made through this handler
   *
   * WHY public method?
   * - MCPProxyServer.getToolCalls() delegates to this method
   * - Maintains backward compatibility with existing API
   */
  getToolCalls(): string[] {
    return this.options.toolCallTracker.getCalls();
  }

  /**
   * Get aggregated summary of tool invocations
   *
   * WHY public method?
   * - MCPProxyServer.getToolCallSummary() delegates to this method
   * - Maintains backward compatibility with existing API
   */
  getToolCallSummary() {
    return this.options.toolCallTracker.getSummary();
  }
}
