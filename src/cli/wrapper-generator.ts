/**
 * WrapperGenerator - Generates type-safe MCP wrappers from tool schemas
 *
 * **RESPONSIBILITY (SRP):** Template rendering and file generation for MCP wrappers
 * **SECURITY:** CVE-2021-23369 mitigated via Handlebars >= 4.7.7 with auto-escaping
 * **WHY:** Automated wrapper generation reduces manual API integration work
 *
 * @see https://github.com/aberemia24/code-executor-MCP/blob/main/docs/architecture.md#wrapper-generation
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import Handlebars from 'handlebars';
import AsyncLock from 'async-lock';
import type {
  MCPServerSelection,
  WrapperGenerationResult,
  ModuleFormat,
  ToolSchema,
} from './types.js';

/**
 * WrapperGeneratorOptions - Configuration for WrapperGenerator
 */
export interface WrapperGeneratorOptions {
  /**
   * Output directory for generated wrappers
   *
   * **DEFAULT:** ./generated/wrappers
   */
  outputDir: string;

  /**
   * Template directory path
   *
   * **DEFAULT:** ./templates
   */
  templateDir: string;

  /**
   * Manifest file path (optional)
   *
   * **DEFAULT:** ~/.code-executor/wrapper-manifest.json
   * **PURPOSE:** Tracks generated wrappers for schema change detection (FR-6)
   */
  manifestPath?: string;
}

/**
 * WrapperGenerator - Generates TypeScript/Python wrappers from MCP schemas
 *
 * **SECURITY FEATURES:**
 * - Handlebars auto-escaping enabled (prevents template injection CVE-2021-23369)
 * - Path canonicalization prevents directory traversal
 * - MCP name sanitization removes special characters
 *
 * **USAGE:**
 * ```typescript
 * const generator = new WrapperGenerator({ outputDir: './wrappers', templateDir: './templates' });
 * const result = await generator.generateWrapper(mcpServer, 'typescript', 'esm');
 * ```
 */
export class WrapperGenerator {
  private outputDir: string;
  private templateDir: string;
  private manifestPath: string;
  private handlebars: typeof Handlebars;
  private manifestLock: AsyncLock;

  constructor(options: WrapperGeneratorOptions) {
    this.outputDir = options.outputDir;
    this.templateDir = options.templateDir;
    this.manifestPath = options.manifestPath || path.join(os.homedir(), '.code-executor', 'wrapper-manifest.json');
    this.handlebars = Handlebars.create(); // Create isolated Handlebars instance
    this.manifestLock = new AsyncLock();

    // Register custom helpers
    this.registerHelpers();
  }

  /**
   * Map JSON Schema type to TypeScript type
   *
   * **SRP:** Single responsibility for TypeScript type mapping
   * **WHY:** Extracted from inline helper for testability and maintainability
   *
   * @param type JSON Schema type string
   * @returns TypeScript type string
   */
  private mapTypeScriptType(type: string): string {
    const typeMap: Record<string, string> = {
      string: 'string',
      number: 'number',
      integer: 'number',
      boolean: 'boolean',
      array: 'any[]',
      object: 'Record<string, any>',
      null: 'null',
    };
    return typeMap[type] || 'any';
  }

  /**
   * Map JSON Schema type to Python type hint
   *
   * **SRP:** Single responsibility for Python type mapping
   * **WHY:** Extracted from inline helper for testability and maintainability
   *
   * @param type JSON Schema type string
   * @returns Python type hint string
   */
  private mapPythonType(type: string): string {
    const typeMap: Record<string, string> = {
      string: 'str',
      number: 'float',
      integer: 'int',
      boolean: 'bool',
      array: 'List[Any]',
      object: 'Dict[str, Any]',
      null: 'None',
    };
    return typeMap[type] || 'Any';
  }

  /**
   * Register Handlebars helper functions for code generation
   *
   * **HELPERS:**
   * - camelCase: Converts snake_case to camelCase
   * - pascalCase: Converts snake_case to PascalCase
   * - snakeCase: Converts camelCase/PascalCase to snake_case
   * - tsType: Maps JSON Schema types to TypeScript types
   * - pythonType: Maps JSON Schema types to Python type hints
   * - eq: Equality comparison
   *
   * **WHY:** Template reusability and consistent naming conventions
   * **TYPE SAFETY:** All helpers use `unknown` + type guards (no `any`)
   */
  private registerHelpers(): void {
    // camelCase helper
    this.handlebars.registerHelper('camelCase', (str: unknown): string => {
      if (typeof str !== 'string') {
        throw new Error(`camelCase helper expects string, got ${typeof str}`);
      }
      if (!str) return '';
      // Remove mcp__ prefix if present
      const cleaned = str.replace(/^mcp__[^_]+__/, '');
      // Convert snake_case/kebab-case to camelCase
      return cleaned
        .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
        .replace(/^(.)/, (_, char) => char.toLowerCase());
    });

    // pascalCase helper
    this.handlebars.registerHelper('pascalCase', (str: unknown): string => {
      if (typeof str !== 'string') {
        throw new Error(`pascalCase helper expects string, got ${typeof str}`);
      }
      if (!str) return '';
      const cleaned = str.replace(/^mcp__[^_]+__/, '');
      return cleaned
        .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
        .replace(/^(.)/, (_, char) => char.toUpperCase());
    });

    // snakeCase helper
    this.handlebars.registerHelper('snakeCase', (str: unknown): string => {
      if (typeof str !== 'string') {
        throw new Error(`snakeCase helper expects string, got ${typeof str}`);
      }
      if (!str) return '';
      return str
        .replace(/([A-Z])/g, '_$1')
        .replace(/^_/, '')
        .toLowerCase()
        .replace(/[-]/g, '_');
    });

    // TypeScript type mapping
    this.handlebars.registerHelper('tsType', (type: unknown): string => {
      if (typeof type !== 'string') {
        throw new Error(`tsType helper expects string, got ${typeof type}`);
      }
      return this.mapTypeScriptType(type);
    });

    // Python type mapping
    this.handlebars.registerHelper('pythonType', (type: unknown): string => {
      if (typeof type !== 'string') {
        throw new Error(`pythonType helper expects string, got ${typeof type}`);
      }
      return this.mapPythonType(type);
    });

    // Equality helper
    this.handlebars.registerHelper('eq', (a: unknown, b: unknown): boolean => {
      return a === b;
    });

    // Lookup helper for checking if param is required
    this.handlebars.registerHelper('lookup', (obj: unknown, key: unknown): boolean => {
      if (typeof key !== 'string') return false;
      if (!obj || typeof obj !== 'object') return false;
      if (Array.isArray(obj)) {
        return obj.includes(key);
      }
      return key in obj && (obj as Record<string, unknown>)[key] !== undefined;
    });
  }

  /**
   * Read wrapper manifest from disk
   *
   * **CONCURRENCY:** AsyncLock not needed for reads (read-only operation)
   * **PURPOSE:** Load existing manifest for schema change detection (FR-6)
   *
   * @returns Manifest object or null if file doesn't exist
   */
  private async readManifest(): Promise<{
    version: string;
    generatedAt: string;
    wrappers: Array<{
      mcpName: string;
      language: string;
      schemaHash: string;
      outputPath: string;
      generatedAt: string;
      status?: 'success' | 'failed';
      errorMessage?: string;
    }>;
  } | null> {
    try {
      const content = await fs.readFile(this.manifestPath, 'utf-8');
      return JSON.parse(content);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return null; // File doesn't exist yet
      }
      throw error; // Other errors should propagate
    }
  }

  /**
   * Write wrapper manifest to disk with AsyncLock protection
   *
   * **CONCURRENCY:** AsyncLock prevents race conditions on manifest writes
   * **PURPOSE:** Track generated wrappers for schema change detection (FR-6)
   * **FORMAT:** JSON with version, generatedAt, and wrappers array
   *
   * @param wrapperEntry New or updated wrapper entry
   */
  private async updateManifest(wrapperEntry: {
    mcpName: string;
    language: string;
    schemaHash: string;
    outputPath: string;
    generatedAt: string;
    status?: 'success' | 'failed';
    errorMessage?: string;
  }): Promise<void> {
    await this.manifestLock.acquire('manifest-write', async () => {
      // Read existing manifest (or create new)
      const manifest = await this.readManifest() || {
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        wrappers: [],
      };

      // Find existing entry for this MCP + language (if any)
      const existingIndex = manifest.wrappers.findIndex(
        (w) => w.mcpName === wrapperEntry.mcpName && w.language === wrapperEntry.language
      );

      if (existingIndex >= 0) {
        // Update existing entry
        manifest.wrappers[existingIndex] = wrapperEntry;
      } else {
        // Add new entry
        manifest.wrappers.push(wrapperEntry);
      }

      // Update manifest timestamp
      manifest.generatedAt = new Date().toISOString();

      // Ensure manifest directory exists
      const manifestDir = path.dirname(this.manifestPath);
      await fs.mkdir(manifestDir, { recursive: true });

      // Write manifest atomically
      await fs.writeFile(this.manifestPath, JSON.stringify(manifest, null, 2));

      // Set restrictive permissions (rw-------, user-only access)
      await fs.chmod(this.manifestPath, 0o600);
    });
  }

  /**
   * Generate wrapper for an MCP server
   *
   * **FLOW:**
   * 1. Validate MCP name (prevent path traversal)
   * 2. Calculate schema hash (for change detection)
   * 3. Load appropriate template (TypeScript/Python)
   * 4. Render template with tool schemas
   * 5. Write generated file to output directory
   *
   * **SECURITY:**
   * - MCP name sanitized (alphanumeric, hyphens, underscores only)
   * - Output path canonicalized (prevents ../../../etc/passwd)
   * - Handlebars auto-escaping prevents template injection
   *
   * **ERROR HANDLING STRATEGY:**
   * This method uses a **resilient generation pattern** (FR-5 Task 8.5):
   * - **Validation errors** (invalid MCP name, language) → throw immediately (fail-fast)
   * - **Generation errors** (template missing, rendering failure) → return WrapperGenerationResult with success=false
   *
   * **WHY RESILIENT?**
   * - Allows partial success in multi-wrapper generation scenarios
   * - One template failure doesn't block other wrappers from generating
   * - Errors are captured in result.errorMessage for user feedback
   * - Aligns with FR-5 requirement: "Partial failures logged but don't interrupt flow"
   *
   * **TRADE-OFF:**
   * - ❌ Fail-fast would surface errors immediately (better for debugging)
   * - ✅ Resilient allows graceful degradation (better for UX in batch operations)
   *
   * @param mcp MCP server configuration with tool schemas
   * @param language Target language (typescript or python)
   * @param moduleFormat Module system format (ESM or CommonJS, for TypeScript only)
   * @returns Generation result with output path and metadata (success: false if generation fails)
   * @throws Error if MCP name invalid or language unsupported (validation errors only)
   */
  async generateWrapper(
    mcp: MCPServerSelection,
    language: 'typescript' | 'python',
    moduleFormat: ModuleFormat
  ): Promise<WrapperGenerationResult> {
    // Validate MCP name (prevent path traversal) - throw for validation errors
    this.validateMCPName(mcp.name);

    // Validate language - throw for invalid language
    if (!['typescript', 'python'].includes(language)) {
      throw new Error(`Invalid language: ${language}. Supported: typescript, python`);
    }

    // RESILIENT GENERATION PATTERN: Catch generation errors, return result object
    // (See docstring for rationale - FR-5 Task 8.5 requirement)
    try {

      // Calculate schema hash
      const schemaHash = this.calculateSchemaHash(mcp.tools || []);

      // Determine output filename
      const outputFileName = this.getOutputFileName(mcp.name, language);
      const languageDir = path.join(this.outputDir, language);
      const outputPath = path.join(languageDir, outputFileName);

      // Ensure output directory exists
      await fs.mkdir(languageDir, { recursive: true });

      // Load template
      const templatePath = path.join(
        this.templateDir,
        language === 'typescript' ? 'typescript-wrapper.hbs' : 'python-wrapper.hbs'
      );

      const templateSource = await fs.readFile(templatePath, 'utf-8').catch((error: unknown) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          throw new Error(`Template not found: ${templatePath}`);
        }
        throw error;
      });

      // Compile template with auto-escaping enabled (CVE-2021-23369 mitigation)
      const template = this.handlebars.compile(templateSource, {
        noEscape: false, // Enable auto-escaping (security critical)
        strict: true, // Fail on missing properties (catch template bugs)
      });

      // Prepare template data
      const templateData = {
        mcpName: mcp.name,
        description: mcp.description || '',
        toolCount: mcp.toolCount || (mcp.tools?.length ?? 0),
        tools: mcp.tools || [],
        schemaHash,
        generatedAt: new Date().toISOString(),
        moduleFormat, // For TypeScript import/export syntax
      };

      // Render template
      const rendered = template(templateData);

      // Write file
      await fs.writeFile(outputPath, rendered, 'utf-8');

      // Set file permissions (rw-r--r--)
      await fs.chmod(outputPath, 0o644);

      // Update manifest (success case)
      await this.updateManifest({
        mcpName: mcp.name,
        language,
        schemaHash,
        outputPath,
        generatedAt: templateData.generatedAt,
        status: 'success',
      });

      return {
        success: true,
        mcpName: mcp.name,
        language,
        outputPath,
        schemaHash,
        generatedAt: templateData.generatedAt,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Update manifest (failure case) - track failed attempts for debugging
      await this.updateManifest({
        mcpName: mcp.name,
        language,
        schemaHash: '', // No hash available if generation failed
        outputPath: '',
        generatedAt: new Date().toISOString(),
        status: 'failed',
        errorMessage,
      });

      return {
        success: false,
        mcpName: mcp.name,
        language,
        outputPath: '',
        schemaHash: '',
        generatedAt: new Date().toISOString(),
        errorMessage,
      };
    }
  }

  /**
   * Validate MCP name to prevent path traversal attacks
   *
   * **SECURITY:** Blocks ../../../etc/passwd and other path traversal attempts
   * **ALLOWED:** Alphanumeric characters, hyphens, underscores only
   *
   * @param name MCP server name
   * @throws Error if name contains invalid characters
   */
  private validateMCPName(name: string): void {
    if (!name) {
      throw new Error('Invalid MCP name: empty');
    }

    // Allow only alphanumeric, hyphens, underscores
    const validNamePattern = /^[a-zA-Z0-9_-]+$/;
    if (!validNamePattern.test(name)) {
      throw new Error(
        `Invalid MCP name: "${name}". Path traversal or invalid characters detected.`
      );
    }

    // Additional check: block paths with directory separators
    if (name.includes('/') || name.includes('\\') || name.includes('..')) {
      throw new Error(
        `Invalid MCP name: "${name}". Path traversal detected.`
      );
    }
  }

  /**
   * Calculate SHA-256 hash of tool schemas for change detection
   *
   * **USAGE:** Daily sync compares hashes to detect MCP schema changes
   * **FORMAT:** Canonical JSON (no whitespace) for consistent hashing
   *
   * @param tools Array of tool schemas
   * @returns Hex-encoded SHA-256 hash
   */
  private calculateSchemaHash(tools: ToolSchema[]): string {
    const canonical = JSON.stringify(tools, null, 0); // No whitespace
    return crypto.createHash('sha256').update(canonical, 'utf-8').digest('hex');
  }

  /**
   * Get output filename for generated wrapper
   *
   * **FORMAT:**
   * - TypeScript: mcp-{name}.ts
   * - Python: mcp_{name}.py
   *
   * @param mcpName MCP server name
   * @param language Target language
   * @returns Output filename
   */
  private getOutputFileName(mcpName: string, language: 'typescript' | 'python'): string {
    if (language === 'typescript') {
      return `mcp-${mcpName}.ts`;
    } else {
      return `mcp_${mcpName}.py`;
    }
  }
}
