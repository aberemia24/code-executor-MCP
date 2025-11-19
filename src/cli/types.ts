/**
 * CLI Setup Types - Type definitions for interactive wizard
 *
 * **RESPONSIBILITY (SRP):** Define TypeScript types for CLI setup configuration
 * **WHY:** Centralized type definitions maintain consistency across CLI modules
 */

/**
 * SetupConfig - Configuration collected from interactive prompts
 *
 * **VALIDATION:** Values validated against AJV schema (setup-config.schema.ts)
 * **USAGE:** Passed to ConfigManager for .mcp.json file generation
 */
export interface SetupConfig {
  /**
   * Proxy server port for MCP tool calls
   *
   * **RANGE:** 1024-65535 (unprivileged ports)
   * **DEFAULT:** 3000
   */
  proxyPort: number;

  /**
   * Execution timeout for MCP tool calls (milliseconds)
   *
   * **RANGE:** 1000-600000 (1s to 10 minutes)
   * **DEFAULT:** 120000 (2 minutes)
   */
  executionTimeout: number;

  /**
   * Rate limit for MCP proxy requests (requests per minute)
   *
   * **RANGE:** 1-1000
   * **DEFAULT:** 30
   */
  rateLimit: number;

  /**
   * Audit log file path
   *
   * **FORMAT:** Absolute path to .jsonl file
   * **DEFAULT:** ~/.code-executor/audit-logs/audit.jsonl
   */
  auditLogPath: string;

  /**
   * Schema cache TTL (time-to-live) in hours
   *
   * **RANGE:** 1-168 (1 hour to 1 week)
   * **DEFAULT:** 24 hours
   */
  schemaCacheTTL: number;
}

/**
 * MCPServerConfig - Configuration for a single MCP server
 *
 * **SOURCE:** Extracted from .mcp.json files
 * **FORMAT:** Standard MCP SDK configuration format
 */
export interface MCPServerConfig {
  /**
   * Server name/identifier
   *
   * **EXAMPLE:** "filesystem", "github", "code-executor"
   */
  name: string;

  /**
   * Command to execute the MCP server
   *
   * **EXAMPLES:** "node", "npx", "python", "/usr/bin/mcp-server"
   */
  command: string;

  /**
   * Command arguments
   *
   * **EXAMPLES:** ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
   */
  args: string[];

  /**
   * Environment variables for the server process
   *
   * **EXAMPLES:** { "API_KEY": "value", "DEBUG": "true" }
   */
  env?: Record<string, string>;

  /**
   * Source tool that defined this MCP server
   *
   * **EXAMPLES:** "claude-code", "cursor", "windsurf"
   */
  sourceTool: string;
}

/**
 * MCPConfig - Root configuration object from .mcp.json files
 *
 * **STRUCTURE:** Standard MCP SDK format
 */
export interface MCPConfig {
  mcpServers: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

/**
 * MCPServerStatus - Status of an MCP server after validation/ping
 *
 * **STATES:**
 * - available: Command exists and can be executed
 * - unavailable: Command not found or not executable
 * - unknown: Cannot determine status (validation skipped)
 */
export type ServerStatus = 'available' | 'unavailable' | 'unknown';

/**
 * MCPServerStatusResult - Result of server validation/ping
 *
 * **USAGE:** Returned by pingServer() and pingAllServers()
 */
export interface MCPServerStatusResult {
  /**
   * Server configuration being validated
   */
  server: MCPServerConfig;

  /**
   * Validation status
   */
  status: ServerStatus;

  /**
   * Optional message (error details, validation info)
   */
  message?: string;
}

/**
 * DependencyCheckResult - Result of dependency version validation
 *
 * **USAGE:** Returned by DependencyChecker methods
 */
export interface DependencyCheckResult {
  /**
   * Whether the dependency is available and meets minimum version requirements
   */
  available: boolean;

  /**
   * Detected version (if available)
   *
   * **FORMAT:** Semantic version string without 'v' prefix (e.g., "22.0.0", "3.11.0")
   */
  version?: string;

  /**
   * Human-readable message (success confirmation or installation instructions)
   */
  message: string;
}

/**
 * AllDependenciesResult - Result of checking all required dependencies
 *
 * **USAGE:** Returned by DependencyChecker.checkAllDependencies()
 */
export interface AllDependenciesResult {
  /**
   * Node.js version check result (minimum: 22.0.0)
   */
  node: DependencyCheckResult;

  /**
   * Python version check result (minimum: 3.9.0)
   */
  python: DependencyCheckResult;

  /**
   * TypeScript compiler availability check
   */
  typescript: DependencyCheckResult;

  /**
   * pip package manager availability check
   */
  pip: DependencyCheckResult;
}

/**
 * WrapperLanguage - Supported wrapper languages for code generation
 *
 * **USAGE:** Language selection for MCP wrapper generation (FR-4)
 */
export type WrapperLanguage = 'typescript' | 'python' | 'both';

/**
 * LanguageSelection - Language choice for a specific MCP server
 *
 * **USAGE:** Maps MCP server to user's language selection
 */
export interface LanguageSelection {
  /**
   * MCP server configuration
   */
  server: MCPServerConfig;

  /**
   * Selected wrapper language(s)
   */
  language: WrapperLanguage;
}

/**
 * ToolSchema - MCP tool schema definition
 *
 * **SOURCE:** Retrieved from MCP server via listTools RPC
 * **USAGE:** Used for wrapper generation template data
 */
export interface ToolSchema {
  /**
   * Tool name (fully qualified MCP tool identifier)
   *
   * **FORMAT:** mcp__server__toolname (e.g., "mcp__filesystem__read_file")
   */
  name: string;

  /**
   * Human-readable tool description
   */
  description: string;

  /**
   * JSON Schema for tool parameters
   *
   * **FORMAT:** JSON Schema Draft 7
   */
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * MCPServerSelection - MCP server selected for wrapper generation
 *
 * **USAGE:** Extended MCPServerConfig with discovered tools
 */
export interface MCPServerSelection {
  /**
   * MCP server name
   */
  name: string;

  /**
   * MCP server description (optional)
   */
  description?: string;

  /**
   * Connection type
   */
  type: 'STDIO' | 'HTTP';

  /**
   * Connection status (from ping)
   */
  status: 'online' | 'offline' | 'unknown';

  /**
   * Number of tools exposed by this MCP server
   */
  toolCount: number;

  /**
   * Source AI tool config file path
   */
  sourceConfig: string;

  /**
   * Discovered tool schemas (optional, populated during generation)
   */
  tools?: ToolSchema[];
}

/**
 * WrapperGenerationResult - Result of wrapper generation
 *
 * **USAGE:** Returned by WrapperGenerator.generateWrapper()
 */
export interface WrapperGenerationResult {
  /**
   * Whether generation succeeded
   */
  success: boolean;

  /**
   * MCP server name
   */
  mcpName: string;

  /**
   * Generated wrapper language
   */
  language: 'typescript' | 'python';

  /**
   * Output file path (absolute)
   */
  outputPath: string;

  /**
   * SHA-256 hash of tool schemas
   */
  schemaHash: string;

  /**
   * Generation timestamp (ISO 8601)
   */
  generatedAt: string;

  /**
   * Error message (if failed)
   */
  errorMessage?: string;

  /**
   * Whether wrapper generation was skipped (file already exists and regenOption was 'missing')
   */
  skipped?: boolean;
}

/**
 * WrapperManifest - Tracks generated wrappers for incremental updates
 *
 * **LOCATION:** ~/.code-executor/wrapper-manifest.json
 * **USAGE:** Daily sync compares hashes to detect MCP schema changes
 */
export interface WrapperManifest {
  /**
   * Manifest version (semantic version)
   */
  version: string;

  /**
   * Manifest generation timestamp (ISO 8601)
   */
  generatedAt: string;

  /**
   * List of generated wrappers
   */
  wrappers: WrapperEntry[];
}

/**
 * WrapperEntry - Single wrapper generation record
 *
 * **USAGE:** Stored in WrapperManifest.wrappers array
 */
export interface WrapperEntry {
  /**
   * MCP server name
   */
  mcpName: string;

  /**
   * Wrapper language
   */
  language: 'typescript' | 'python';

  /**
   * SHA-256 hash of tool schemas
   */
  schemaHash: string;

  /**
   * Generated file path
   */
  outputPath: string;

  /**
   * Generation timestamp (ISO 8601)
   */
  generatedAt: string;

  /**
   * Generation status
   */
  status: 'success' | 'failed';

  /**
   * Error message (if status === 'failed')
   */
  errorMessage?: string;
}

/**
 * ModuleFormat - JavaScript module system format
 *
 * **USAGE:** Determines import/export syntax in generated TypeScript wrappers
 */
export type ModuleFormat = 'esm' | 'commonjs';

/**
 * ISyncScheduler - Platform-specific scheduler interface for daily MCP wrapper sync
 *
 * **RESPONSIBILITY (SRP):** Abstract scheduler API for timer/cron management
 * **WHY:** Platform abstraction allows Linux/macOS/Windows implementations without tight coupling
 * **IMPLEMENTATIONS:**
 * - SystemdScheduler (Linux): Uses systemd timer units
 * - LaunchdScheduler (macOS): Uses launchd plist files
 * - TaskSchedulerWrapper (Windows): Uses Task Scheduler via PowerShell
 *
 * @example
 * const scheduler = PlatformSchedulerFactory.create();
 * await scheduler.install('/path/to/daily-sync.sh', '05:00');
 */
export interface ISyncScheduler {
  /**
   * Install daily sync timer
   *
   * **BEHAVIOR:**
   * - Creates platform-specific timer configuration (systemd unit, launchd plist, Windows task)
   * - Enables/starts the timer
   * - Verifies installation succeeded
   *
   * **SECURITY:**
   * - scriptPath MUST be absolute and validated (path traversal prevention)
   * - syncTime MUST be 4-6 AM (HH:MM format, 24-hour)
   *
   * @param scriptPath Absolute path to daily sync script (e.g., /home/user/.code-executor/daily-sync.sh)
   * @param syncTime Sync time in HH:MM format, 4-6 AM range (e.g., '05:00')
   * @throws Error if installation fails or validation fails
   * @returns Promise<void>
   */
  install(scriptPath: string, syncTime: string): Promise<void>;

  /**
   * Uninstall daily sync timer
   *
   * **BEHAVIOR:**
   * - Stops the timer
   * - Removes timer configuration files
   * - Cleans up any related resources
   *
   * @throws Error if uninstallation fails or timer doesn't exist
   * @returns Promise<void>
   */
  uninstall(): Promise<void>;

  /**
   * Check if daily sync timer is installed
   *
   * **BEHAVIOR:**
   * - Checks for presence of timer configuration
   * - Verifies timer is enabled/active
   *
   * @returns Promise<boolean> true if timer exists and is active
   */
  exists(): Promise<boolean>;
}

/**
 * DailySyncConfig - Configuration for daily MCP wrapper sync
 *
 * **USAGE:** Returned by CLIWizard.askDailySyncConfig()
 */
export interface DailySyncConfig {
  /**
   * Whether daily sync is enabled
   */
  enabled: boolean;

  /**
   * Sync time in HH:MM format (4-6 AM range)
   *
   * **EXAMPLE:** '05:00'
   */
  syncTime: string;
}
