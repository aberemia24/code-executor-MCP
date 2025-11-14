/**
 * Type definitions for MCP tool discovery feature
 *
 * These types support the progressive disclosure pattern by enabling
 * in-sandbox tool discovery without exposing schemas in top-level MCP tool list.
 */

import type { JSONSchema7 } from 'json-schema';

/**
 * Schema representation for an MCP tool
 *
 * Contains metadata and parameter definitions for a single MCP tool.
 * Used by discovery functions to return tool information without executing them.
 *
 * @example
 * ```typescript
 * const toolSchema: ToolSchema = {
 *   name: 'mcp__zen__codereview',
 *   description: 'Performs comprehensive code review',
 *   parameters: {
 *     type: 'object',
 *     required: ['code', 'language'],
 *     properties: {
 *       code: { type: 'string', description: 'Code to review' },
 *       language: { type: 'string', description: 'Programming language' }
 *     }
 *   }
 * };
 * ```
 */
export interface ToolSchema {
  /**
   * Fully qualified tool name in format: mcp__<server>__<tool>
   *
   * @example 'mcp__zen__codereview'
   */
  name: string;

  /**
   * Human-readable description of tool functionality
   *
   * Used for search/filtering and AI agent decision-making.
   */
  description: string;

  /**
   * JSON Schema definition for tool parameters
   *
   * Follows JSON Schema Draft 7 specification.
   * Defines required/optional parameters, types, and constraints.
   */
  parameters: JSONSchema7;

  /**
   * JSON Schema definition for tool response structure (optional)
   *
   * Follows JSON Schema Draft 7 specification.
   * Describes the format of the tool's response/output.
   *
   * When present, enables AI agents to:
   * - Understand response structure without trial execution
   * - Write filtering/aggregation code correctly
   * - Validate responses match expected format
   *
   * Graceful fallback: undefined for third-party tools without outputSchema.
   *
   * @example
   * ```typescript
   * outputSchema: {
   *   type: 'object',
   *   properties: {
   *     success: { type: 'boolean' },
   *     output: { type: 'string' },
   *     executionTimeMs: { type: 'number' }
   *   },
   *   required: ['success', 'output', 'executionTimeMs']
   * }
   * ```
   */
  outputSchema?: JSONSchema7;
}

/**
 * Query parameters for discovery endpoint
 *
 * Used by GET /mcp/tools endpoint to filter tool results.
 * Optional search keywords filter tools by name/description matching.
 *
 * @example
 * ```typescript
 * // Single keyword search
 * const query1: DiscoveryQuery = { q: 'code' };
 *
 * // Multiple keyword search (OR logic)
 * const query2: DiscoveryQuery = { q: ['code', 'review'] };
 * ```
 */
export interface DiscoveryQuery {
  /**
   * Search keywords for filtering tools
   *
   * Single string or array of strings.
   * Multiple keywords use OR logic (any match).
   * Case-insensitive substring matching against tool name and description.
   *
   * Validation constraints:
   * - Max length: 100 characters per keyword
   * - Allowed characters: alphanumeric, spaces, hyphens, underscores
   * - Empty string returns all tools
   */
  q?: string | string[];

  /**
   * Maximum number of results to return (for searchTools convenience function)
   *
   * Optional limit for result pagination.
   * Default: 10 (if not specified)
   */
  limit?: number;
}

/**
 * Audit log entry for discovery requests
 *
 * Captures security-relevant information about tool discovery operations.
 * Logged to audit trail for compliance and security monitoring.
 *
 * @example
 * ```typescript
 * const logEntry: DiscoveryAuditLog = {
 *   action: 'discovery',
 *   endpoint: '/mcp/tools',
 *   searchTerms: ['code', 'review'],
 *   resultsCount: 3,
 *   clientId: 'default',
 *   timestamp: '2025-11-11T12:34:56.789Z'
 * };
 * ```
 */
export interface DiscoveryAuditLog {
  /**
   * Action type (always 'discovery' for discovery requests)
   *
   * Distinguishes discovery operations from tool execution operations.
   */
  action: 'discovery';

  /**
   * HTTP endpoint that was called
   *
   * @example '/mcp/tools'
   */
  endpoint: string;

  /**
   * Search keywords used in query (empty array if no search)
   *
   * Captures what the agent was searching for.
   */
  searchTerms: string[];

  /**
   * Number of tool schemas returned in response
   *
   * Indicates how many tools matched the search criteria.
   */
  resultsCount: number;

  /**
   * Client identifier (per-execution tracking)
   *
   * Default: 'default'
   * Future: per-client tracking for multi-tenant scenarios
   */
  clientId: string;

  /**
   * ISO 8601 timestamp of discovery request
   *
   * @example '2025-11-11T12:34:56.789Z'
   */
  timestamp: string;
}

/**
 * Options for discoverMCPTools() sandbox function
 *
 * Optional configuration for discovery requests from within sandbox.
 */
export interface DiscoverMCPToolsOptions {
  /**
   * Search keywords for filtering tools (optional)
   *
   * Array of keywords using OR logic.
   * Omit to return all tools.
   *
   * @example ['code', 'review']
   */
  search?: string[];
}
