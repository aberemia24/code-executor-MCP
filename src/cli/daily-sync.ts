/**
 * DailySyncService - Incremental wrapper regeneration based on schema hash changes
 *
 * **RESPONSIBILITY (SRP):** Detect MCP schema changes and regenerate only modified wrappers
 * **WHY:** Daily automated sync should be fast (skip unchanged) and incremental (minimize work)
 * **USAGE:** Called by platform-specific schedulers (systemd timer, launchd agent, Task Scheduler)
 *
 * **ARCHITECTURE:**
 * - Reads wrapper manifest (~/.code-executor/wrapper-manifest.json)
 * - For each wrapper, fetches current MCP schema and computes SHA-256 hash
 * - Compares current hash with stored hash in manifest
 * - Regenerates wrappers only if hashes differ (incremental update)
 * - Updates manifest with new hashes and timestamps
 *
 * **DESIGN PATTERN:** Strategy (hash comparison strategy), Command (regeneration as command)
 * **PRINCIPLE:** Open-Closed (extensible for different hash strategies without modification)
 */

import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import * as path from 'path';
import type { WrapperManifest, WrapperEntry, MCPServerSelection, ToolSchema as CLIToolSchema } from './types.js';
import { WrapperGenerator } from './wrapper-generator.js';
import type { MCPClientPool } from '../mcp/client-pool.js';
import type { SchemaCache } from '../validation/schema-cache.js';
import type { ToolSchema as DiscoveryToolSchema } from '../types/discovery.js';

/**
 * DailySyncOptions - Configuration for daily sync service
 *
 * **USAGE:** Passed to DailySyncService constructor
 */
export interface DailySyncOptions {
  /**
   * Absolute path to wrapper manifest file
   *
   * **DEFAULT:** ~/.code-executor/wrapper-manifest.json
   * **FORMAT:** JSON file with WrapperManifest structure
   */
  manifestPath: string;

  /**
   * Absolute path to wrapper output directory
   *
   * **DEFAULT:** ~/.code-executor/wrappers
   * **STRUCTURE:** wrappers/typescript/, wrappers/python/
   */
  wrapperOutputDir: string;

  /**
   * Absolute path to template directory
   *
   * **DEFAULT:** Project root templates/ directory
   * **CONTENTS:** typescript-wrapper.hbs, python-wrapper.hbs
   */
  templateDir: string;

  /**
   * MCP Client Pool for fetching current tool schemas
   *
   * **REQUIRED:** Phase 10 implementation
   * **USAGE:** Used in computeCurrentSchemaHash() to fetch tool schemas
   */
  mcpClientPool: MCPClientPool;

  /**
   * Schema Cache for caching tool schemas
   *
   * **REQUIRED:** Phase 10 implementation
   * **USAGE:** Used in listAllToolSchemas() for performance
   */
  schemaCache: SchemaCache;

  /**
   * Wrapper Generator for regenerating wrappers
   *
   * **OPTIONAL:** If not provided, will be created internally
   * **USAGE:** Used in regenerateWrapper() to generate wrapper files
   */
  wrapperGenerator?: WrapperGenerator;
}

/**
 * DailySyncResult - Result of daily sync operation
 *
 * **USAGE:** Returned by DailySyncService.sync()
 */
export interface DailySyncResult {
  /**
   * Whether sync was skipped (no manifest, empty manifest, or read error)
   */
  skipped: boolean;

  /**
   * Reason for skipping (if skipped === true)
   */
  reason?: string;

  /**
   * List of wrappers that were regenerated (schema hash changed)
   *
   * **FORMAT:** 'mcpName (language)' (e.g., 'filesystem (typescript)')
   */
  regenerated: string[];

  /**
   * List of wrappers that were unchanged (schema hash same)
   *
   * **FORMAT:** 'mcpName (language)' (e.g., 'github (python)')
   */
  unchanged: string[];

  /**
   * List of wrappers that failed to regenerate (with error message)
   *
   * **FORMAT:** 'mcpName (language): error message'
   */
  failed: string[];

  /**
   * Total execution time in milliseconds
   */
  durationMs: number;
}

/**
 * DailySyncService - Daily sync service for incremental wrapper regeneration
 *
 * **RESPONSIBILITY (SRP):** Detect schema changes and regenerate wrappers incrementally
 * **WHY:** Minimize daily sync execution time by skipping unchanged wrappers
 */
export class DailySyncService {
  private manifestPath: string;
  private wrapperGenerator: WrapperGenerator;
  private mcpClientPool: MCPClientPool;
  private schemaCache: SchemaCache;

  /**
   * Constructor
   *
   * **VALIDATION:**
   * - manifestPath must be absolute (security: prevent path traversal)
   * - wrapperOutputDir must be absolute (security: prevent path traversal)
   * - templateDir must be absolute (security: prevent path traversal)
   *
   * **DEPENDENCY INJECTION:**
   * - mcpClientPool: Required for fetching current MCP tool schemas (Phase 10)
   * - schemaCache: Required for caching tool schemas (Phase 10)
   * - wrapperGenerator: Optional, can be injected via options for testing (mocking)
   *   If not provided, creates default WrapperGenerator instance
   *
   * @param options Daily sync configuration
   * @throws Error if paths are not absolute
   */
  constructor(options: DailySyncOptions) {
    // Validation: all paths must be absolute (security)
    if (!path.isAbsolute(options.manifestPath)) {
      throw new Error('manifestPath must be absolute');
    }
    if (!path.isAbsolute(options.wrapperOutputDir)) {
      throw new Error('wrapperOutputDir must be absolute');
    }
    if (!path.isAbsolute(options.templateDir)) {
      throw new Error('templateDir must be absolute');
    }

    this.manifestPath = options.manifestPath;
    this.mcpClientPool = options.mcpClientPool;
    this.schemaCache = options.schemaCache;

    // Dependency Injection: use provided generator from options or create default
    this.wrapperGenerator = options.wrapperGenerator ?? new WrapperGenerator({
      outputDir: options.wrapperOutputDir,
      templateDir: options.templateDir,
      manifestPath: options.manifestPath,
    });
  }

  /**
   * Execute daily sync
   *
   * **BEHAVIOR:**
   * 1. Read wrapper manifest from disk
   * 2. For each wrapper entry:
   *    a. Compute current schema hash (fetch MCP schemas, hash them)
   *    b. Compare with stored hash in manifest
   *    c. If different, regenerate wrapper using WrapperGenerator
   *    d. If same, skip regeneration
   * 3. Return sync result with regenerated/unchanged/failed counts
   *
   * **ERROR HANDLING:**
   * - Manifest not found → skip sync (not an error, first run scenario)
   * - Manifest read error → skip sync with error message
   * - Individual wrapper regeneration failure → log and continue (partial failure OK)
   *
   * @returns DailySyncResult Sync result summary
   */
  async sync(): Promise<DailySyncResult> {
    const startTime = Date.now();
    const result: DailySyncResult = {
      skipped: false,
      regenerated: [],
      unchanged: [],
      failed: [],
      durationMs: 0,
    };

    try {
      // Step 1: Read manifest
      const manifest = await this.readManifest();

      // Skip if manifest doesn't exist
      if (!manifest) {
        result.skipped = true;
        result.reason = 'Manifest not found (first run or no wrappers generated yet)';
        result.durationMs = Date.now() - startTime;
        return result;
      }

      // Skip if manifest has no wrappers
      if (manifest.wrappers.length === 0) {
        result.skipped = true;
        result.reason = 'No wrappers in manifest (nothing to sync)';
        result.durationMs = Date.now() - startTime;
        return result;
      }

      // Step 2: Process each wrapper entry
      for (const wrapper of manifest.wrappers) {
        const wrapperKey = `${wrapper.mcpName} (${wrapper.language})`;

        try {
          // Compute current schema hash
          const currentHash = await this.computeCurrentSchemaHash(wrapper.mcpName);

          // Compare with stored hash
          if (currentHash === wrapper.schemaHash) {
            // Schema unchanged → skip regeneration
            result.unchanged.push(wrapperKey);
          } else {
            // Schema changed → regenerate wrapper
            const success = await this.regenerateWrapper(wrapper);

            if (success) {
              result.regenerated.push(wrapperKey);
            } else {
              result.failed.push(`${wrapperKey}: Regeneration failed (see logs)`);
            }
          }
        } catch (error: unknown) {
          // Individual wrapper failure → log and continue
          const errorMessage = this.formatError(error);
          result.failed.push(`${wrapperKey}: ${errorMessage}`);
        }
      }
    } catch (error: unknown) {
      // Manifest read error → skip sync
      result.skipped = true;
      result.reason = `Failed to read manifest: ${this.formatError(error)}`;
    }

    result.durationMs = Date.now() - startTime;
    return result;
  }

  /**
   * Read wrapper manifest from disk
   *
   * **ERROR HANDLING:**
   * - File not found → return null (not an error, first run scenario)
   * - JSON parse error → throw (invalid manifest structure)
   *
   * @returns WrapperManifest | null Manifest object or null if not found
   * @throws Error if manifest exists but is invalid JSON
   */
  private async readManifest(): Promise<WrapperManifest | null> {
    try {
      const manifestJson = await fs.readFile(this.manifestPath, 'utf8');
      const parsed = JSON.parse(manifestJson) as unknown;

      // Validate manifest structure (runtime type checking)
      if (!this.isValidWrapperManifest(parsed)) {
        throw new Error('Invalid manifest structure: missing required fields (version, generatedAt, wrappers)');
      }

      return parsed;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File not found → return null (first run scenario)
        return null;
      }
      // Other errors (JSON parse, permission, validation) → throw
      throw error;
    }
  }

  /**
   * Validate WrapperManifest structure (runtime type guard)
   *
   * **WHY:** Type assertions without runtime validation = `any` backdoor
   * **PRINCIPLE:** Validate ALL external inputs (manifest is disk-based external input)
   *
   * @param value Unknown value to validate
   * @returns boolean true if valid WrapperManifest structure
   */
  private isValidWrapperManifest(value: unknown): value is WrapperManifest {
    if (typeof value !== 'object' || value === null) return false;

    const obj = value as Record<string, unknown>;

    // Validate required fields
    if (typeof obj.version !== 'string') return false;
    if (typeof obj.generatedAt !== 'string') return false;
    if (!Array.isArray(obj.wrappers)) return false;

    // Validate each wrapper entry (basic structure check)
    for (const wrapper of obj.wrappers) {
      if (typeof wrapper !== 'object' || wrapper === null) return false;

      const entry = wrapper as Record<string, unknown>;
      if (typeof entry.mcpName !== 'string') return false;
      if (entry.language !== 'typescript' && entry.language !== 'python') return false;
      if (typeof entry.schemaHash !== 'string') return false;
      if (typeof entry.outputPath !== 'string') return false;
      if (typeof entry.generatedAt !== 'string') return false;
      if (entry.status !== 'success' && entry.status !== 'failed') return false;
    }

    return true;
  }

  /**
   * Format error for user-friendly display (DRY utility)
   *
   * **WHY:** Eliminate duplicated error formatting pattern
   *
   * @param error Unknown error value
   * @returns string Formatted error message
   */
  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Convert DiscoveryToolSchema to CLIToolSchema
   *
   * **WHY:** Discovery types use JSONSchema7 which is more flexible than CLI types
   * **BEHAVIOR:** Safely converts parameters field to expected CLI format
   *
   * @param discoveryTool Tool schema from MCPClientPool discovery
   * @returns CLIToolSchema Tool schema compatible with WrapperGenerator
   */
  private convertToCLIToolSchema(discoveryTool: DiscoveryToolSchema): CLIToolSchema {
    // Extract parameters as object, defaulting to empty if not present
    const params = discoveryTool.parameters || {};

    // Type guard: Check if params has properties and required fields
    const hasProperties = typeof params === 'object' && params !== null && 'properties' in params;
    const hasRequired = typeof params === 'object' && params !== null && 'required' in params;

    // Ensure parameters conform to CLI expectations
    const cliParameters = {
      type: 'object' as const,
      properties: (hasProperties && typeof params.properties === 'object' && params.properties !== null)
        ? params.properties as Record<string, unknown>
        : {},
      required: (hasRequired && Array.isArray(params.required))
        ? params.required as string[]
        : [],
    };

    return {
      name: discoveryTool.name,
      description: discoveryTool.description,
      inputSchema: cliParameters,
    };
  }

  /**
   * Compute current schema hash for an MCP server
   *
   * **ALGORITHM:**
   * 1. Fetch current MCP tool schemas (via MCPClientPool.listAllToolSchemas())
   * 2. Filter tools by MCP server name
   * 3. Sort tools by name (deterministic order)
   * 4. Normalize and stringify (sorted keys)
   * 5. Compute SHA-256 hash
   *
   * **IMPLEMENTATION (Phase 10):**
   * - Fetches all tool schemas from MCP Client Pool
   * - Filters by MCP server name (e.g., 'filesystem', 'github')
   * - Sorts tools by name for deterministic hashing
   * - Uses JSON.stringify with replacer for sorted keys
   * - Computes SHA-256 hash of normalized JSON
   *
   * @param mcpName MCP server name (e.g., 'filesystem', 'github')
   * @returns Promise<string> SHA-256 hash of current schemas (hex string)
   */
  private async computeCurrentSchemaHash(mcpName: string): Promise<string> {
    // Step 1: Fetch all tool schemas from MCP Client Pool
    const allTools = await this.mcpClientPool.listAllToolSchemas(this.schemaCache);

    // Step 2: Filter tools by MCP server name
    // Tool names are in format: mcp__servername__toolname
    const serverTools = allTools.filter((tool) => {
      const parts = tool.name.split('__');
      return parts.length === 3 && parts[1] === mcpName;
    });

    // Step 3: Sort tools by name (deterministic order)
    const sortedTools = serverTools.sort((a, b) => a.name.localeCompare(b.name));

    // Step 4: Normalize and stringify with sorted keys
    // Use JSON.stringify with replacer to ensure consistent key order
    const normalizedJson = JSON.stringify(
      sortedTools,
      (key, value) => {
        // Sort object keys alphabetically for deterministic output
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return Object.keys(value)
            .sort()
            .reduce((sorted, k) => {
              sorted[k] = value[k];
              return sorted;
            }, {} as Record<string, unknown>);
        }
        return value;
      }
    );

    // Step 5: Compute SHA-256 hash
    const hash = createHash('sha256');
    hash.update(normalizedJson);
    return hash.digest('hex');
  }

  /**
   * Regenerate wrapper for a wrapper entry
   *
   * **BEHAVIOR:**
   * 1. Fetch current tool schemas for the MCP server
   * 2. Reconstruct MCPServerSelection from wrapper entry
   * 3. Call WrapperGenerator.generateWrapper() with current config
   * 4. Return true if generation succeeds, false otherwise
   *
   * **IMPLEMENTATION (Phase 10):**
   * - Fetches tool schemas from MCPClientPool
   * - Constructs minimal MCPServerSelection for regeneration
   * - Calls WrapperGenerator with 'force' regeneration option
   * - Returns result.success status
   *
   * @param wrapper Wrapper entry from manifest
   * @returns Promise<boolean> true if regeneration succeeded, false otherwise
   */
  private async regenerateWrapper(wrapper: WrapperEntry): Promise<boolean> {
    try {
      // Step 1: Fetch current tool schemas for this MCP server
      const allTools = await this.mcpClientPool.listAllToolSchemas(this.schemaCache);

      // Filter tools by MCP server name (same logic as computeCurrentSchemaHash)
      const serverTools = allTools.filter((tool) => {
        const parts = tool.name.split('__');
        return parts.length === 3 && parts[1] === wrapper.mcpName;
      });

      // Convert discovery tool schemas to CLI tool schemas
      const cliTools = serverTools.map((tool) => this.convertToCLIToolSchema(tool));

      // Step 2: Reconstruct MCPServerSelection from wrapper entry
      // Use minimal required fields for regeneration
      const mcpSelection: MCPServerSelection = {
        name: wrapper.mcpName,
        description: `MCP server: ${wrapper.mcpName}`,
        type: 'STDIO', // Default type (doesn't affect wrapper generation)
        status: 'online', // Assume online since we fetched schemas successfully
        toolCount: cliTools.length,
        sourceConfig: wrapper.outputPath, // Use output path as reference
        tools: cliTools,
      };

      // Step 3: Call WrapperGenerator with 'force' regeneration
      // Module format: ESM (standard for TypeScript wrappers)
      const result = await this.wrapperGenerator.generateWrapper(
        mcpSelection,
        wrapper.language,
        'esm', // Default module format
        'force' // Force regeneration (override existing file)
      );

      // Step 4: Return success status
      return result.success;
    } catch (error: unknown) {
      // Log error and return false (partial failure pattern)
      console.error(`Failed to regenerate wrapper for ${wrapper.mcpName} (${wrapper.language}):`, error);
      return false;
    }
  }
}
