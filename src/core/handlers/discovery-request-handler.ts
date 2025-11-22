/**
 * Discovery Request Handler (SMELL-001 God Object Refactor)
 *
 * Handles GET /mcp/tools endpoint - Tool discovery with search.
 *
 * Responsibilities:
 * - Rate limiting (30 req/60s)
 * - Validate search query parameters
 * - Fetch tool schemas from MCP servers (with timeout)
 * - Filter tools by keywords (OR logic)
 * - Audit log discovery requests
 * - Return JSON response
 *
 * Complexity: MEDIUM (170 lines, 4 dependencies, complex validation logic)
 *
 * WHY separate handler?
 * - Complex validation logic: query length, invalid characters
 * - Complex filtering logic: keyword matching, OR logic
 * - Rate limiting specific to discovery endpoint
 * - Timeout management for MCP server queries
 *
 * SECURITY EXCEPTION (BY DESIGN):
 * This endpoint BYPASSES the allowlist to enable in-sandbox tool discovery.
 * Discovery returns READ-ONLY metadata (tool names, descriptions, parameters).
 * Execution (POST /) STILL requires allowlist validation.
 *
 * @see https://github.com/aberemia24/code-executor-MCP/issues/42
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { IRequestHandler, HandlerDependencies } from './request-handler.interface.js';
import type { SchemaCache } from '../schema-cache.js';
import type { RateLimiter } from '../rate-limiter.js';
import type { ToolSchema } from '../types/discovery.js';
import { normalizeError } from '../utils.js';

/**
 * Discovery handler options
 */
export interface DiscoveryHandlerOptions extends HandlerDependencies {
  /** Schema cache for fetching tool schemas */
  schemaCache: SchemaCache;

  /** Rate limiter for throttling discovery requests */
  rateLimiter: RateLimiter;

  /** Discovery timeout in milliseconds (default: 500ms) */
  discoveryTimeoutMs?: number;
}

/**
 * Handles GET /mcp/tools - Tool Discovery Endpoint
 *
 * Allows sandboxed code to discover available MCP tools without
 * knowing tool names upfront (progressive disclosure pattern).
 *
 * Query Parameters:
 * - ?q=keyword1 - Filter tools by keyword (case-insensitive)
 * - ?q=keyword1&q=keyword2 - Multiple keywords (OR logic)
 *
 * Example:
 * - GET /mcp/tools → All tools
 * - GET /mcp/tools?q=file → Tools matching "file"
 * - GET /mcp/tools?q=code&q=review → Tools matching "code" OR "review"
 */
export class DiscoveryRequestHandler implements IRequestHandler {
  private readonly MAX_SEARCH_QUERY_LENGTH = 100;
  private readonly discoveryTimeoutMs: number;

  /**
   * Create discovery request handler
   *
   * @param options - Handler dependencies and configuration
   */
  constructor(private options: DiscoveryHandlerOptions) {
    this.discoveryTimeoutMs = options.discoveryTimeoutMs ?? 500;
  }

  /**
   * Handle GET /mcp/tools request
   *
   * @param req - HTTP request
   * @param res - HTTP response
   * @param authToken - Pre-validated auth token (for audit logging)
   */
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    _authToken: string
  ): Promise<void> {
    const startTime = process.hrtime.bigint();

    try {
      // Rate limiting: Check limit for this client
      const rateLimit = await this.options.rateLimiter.checkLimit('default');
      if (!rateLimit.allowed) {
        const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
        this.options.metricsExporter.recordHttpRequest('GET', 429);
        this.options.metricsExporter.recordHttpDuration('GET', '/mcp/tools', duration);

        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Rate limit exceeded',
            retryAfter: Math.ceil(rateLimit.resetIn / 1000), // seconds
            limit: 30,
            window: '60s',
          })
        );
        return;
      }

      // Parse query parameters from URL
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      const searchParams = url.searchParams.getAll('q'); // Get all ?q= parameters

      // Validate search queries
      const validationError = this.validateSearchQuery(searchParams);
      if (validationError) {
        const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
        this.options.metricsExporter.recordHttpRequest('GET', 400);
        this.options.metricsExporter.recordHttpDuration('GET', '/mcp/tools', duration);

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(validationError));
        return;
      }

      // Fetch all tool schemas from MCPClientPool with configured timeout
      let timeoutHandle: NodeJS.Timeout | null = null;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Request timeout after ${this.discoveryTimeoutMs}ms`)),
          this.discoveryTimeoutMs
        );
      });

      const toolsPromise = this.options.mcpClientPool.listAllToolSchemas(
        this.options.schemaCache
      );

      let allTools: ToolSchema[];
      try {
        allTools = await Promise.race([toolsPromise, timeoutPromise]);
      } finally {
        // Clear timeout to prevent memory leaks
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }

      // Filter tools by search keywords (OR logic, case-insensitive)
      const filteredTools = this.filterToolsByKeywords(allTools, searchParams);

      // Audit log: Discovery request
      console.error(
        JSON.stringify({
          action: 'discovery',
          endpoint: '/mcp/tools',
          searchTerms: searchParams,
          resultsCount: filteredTools.length,
          clientId: 'default',
          timestamp: new Date().toISOString(),
        })
      );

      // Record successful request metrics
      const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
      this.options.metricsExporter.recordHttpRequest('GET', 200);
      this.options.metricsExporter.recordHttpDuration('GET', '/mcp/tools', duration);

      // Return JSON response with tool schemas
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          tools: filteredTools,
        })
      );
    } catch (error) {
      // Record error metrics
      const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
      this.options.metricsExporter.recordHttpRequest('GET', 500);
      this.options.metricsExporter.recordHttpDuration('GET', '/mcp/tools', duration);

      // Error handling
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: normalizeError(error, 'Discovery request failed').message,
        })
      );
    }
  }

  /**
   * Validate search query parameters
   *
   * WHY separate method?
   * - Testable in isolation
   * - Single Responsibility: validation logic
   * - Reusable if needed
   *
   * @param queries - Array of search query strings
   * @returns Error object if validation fails, null if valid
   */
  private validateSearchQuery(
    queries: string[]
  ): { error: string; query?: string } | null {
    for (const query of queries) {
      // Max length validation
      if (query.length > this.MAX_SEARCH_QUERY_LENGTH) {
        return {
          error: `Search query too long (max ${this.MAX_SEARCH_QUERY_LENGTH} characters)`,
          query,
        };
      }

      // Allowed characters: alphanumeric, spaces, hyphens, underscores
      const validPattern = /^[a-zA-Z0-9\s\-_]+$/;
      if (!validPattern.test(query)) {
        return {
          error:
            'Invalid characters in search query (allowed: alphanumeric, spaces, hyphens, underscores)',
          query,
        };
      }
    }

    return null; // All queries valid
  }

  /**
   * Filter tools by search keywords using OR logic
   *
   * WHY OR logic?
   * - User-friendly: "code OR review" matches more tools than "code AND review"
   * - Progressive disclosure: Help users discover related tools
   *
   * @param tools - Array of tool schemas to filter
   * @param keywords - Array of search keywords
   * @returns Filtered tools matching any keyword (case-insensitive)
   */
  private filterToolsByKeywords(
    tools: ToolSchema[],
    keywords: string[]
  ): ToolSchema[] {
    // No keywords = return all tools
    if (keywords.length === 0) {
      return tools;
    }

    // Filter using OR logic: tool matches if ANY keyword is found
    return tools.filter((tool) => {
      const searchText = `${tool.name} ${tool.description}`.toLowerCase();
      return keywords.some((keyword) => searchText.includes(keyword.toLowerCase()));
    });
  }
}
