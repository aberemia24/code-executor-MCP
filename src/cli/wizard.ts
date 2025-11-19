/**
 * CLIWizard - Interactive CLI wizard for code-executor-mcp setup
 *
 * **RESPONSIBILITY (SRP):** Orchestrate interactive CLI prompts for setup wizard
 * **WHY:** Centralized wizard logic separates UI concerns from business logic
 */

import prompts from 'prompts';
import { Ajv } from 'ajv';
import cliProgress from 'cli-progress';
import figlet from 'figlet';
import kleur from 'kleur';
import ora, { type Ora } from 'ora';
import * as path from 'path';
import * as os from 'os';
import type { ToolDetector } from './tool-detector.js';
import { getSupportedToolsForPlatform, type AIToolMetadata } from './tool-registry.js';
import type { SetupConfig, MCPServerStatusResult, LanguageSelection, WrapperLanguage, MCPServerSelection } from './types.js';
import { setupConfigSchema } from './schemas/setup-config.schema.js';
import type { WrapperGenerator } from './wrapper-generator.js';
import { LockFileService } from '../services/lock-file.js';

/**
 * CLIWizard - Main orchestrator for setup wizard
 *
 * **DESIGN:** Composition over inheritance (uses ToolDetector via DI)
 */
export class CLIWizard {
  private readonly ajv: Ajv;
  private readonly wrapperGenerator?: WrapperGenerator;
  private readonly lockFileService: LockFileService;

  constructor(
    private readonly toolDetector: ToolDetector,
    wrapperGenerator?: WrapperGenerator,
    lockFilePath?: string
  ) {
    this.ajv = new Ajv();
    this.wrapperGenerator = wrapperGenerator;
    this.lockFileService = new LockFileService(
      lockFilePath || path.join(process.env.HOME || process.env.USERPROFILE || '~', '.code-executor', 'setup.lock')
    );
  }

  /**
   * Validate prompt response and throw on cancellation
   *
   * **WHY:** DRY - Extract repeated cancellation check (used 5 times)
   * **RETURNS:** Validated response value or throws
   *
   * @throws Error if user cancelled (null response or undefined field)
   */
  private validateResponse<T extends Record<string, unknown>>(
    response: T | null,
    fieldName: keyof T
  ): T[keyof T] {
    if (!response || response[fieldName] === undefined) {
      throw new Error('Configuration cancelled by user');
    }
    return response[fieldName];
  }

  /**
   * Prompt user to select AI development tools
   *
   * **VALIDATION:** Minimum 1 tool must be selected
   * **RETURNS:** Array of selected tool metadata (preserves selection order)
   *
   * @throws Error if no tools installed
   * @returns Selected tools in user's selection order
   */
  async selectTools(): Promise<AIToolMetadata[]> {
    // Get all supported tools for current platform
    const supportedTools = getSupportedToolsForPlatform();

    // Detect which ones are actually installed
    const installedToolIds = new Set<string>();
    for (const tool of supportedTools) {
      if (await this.toolDetector.isToolInstalled(tool)) {
        installedToolIds.add(tool.id);
      }
    }

    // Create prompt choices showing all supported tools (installed + not installed)
    const choices = supportedTools
      .filter(tool => tool.id === 'claude-code' || tool.id === 'cursor') // Only show Claude Code and Cursor for now
      .map(tool => {
        const isInstalled = installedToolIds.has(tool.id);
        return {
          title: `${tool.name}${isInstalled ? ' ✓' : ' (not detected)'}`,
          value: tool.id,
          description: `${tool.description} - ${tool.website}`,
        };
      });

    // Multi-select prompt with validation
    const response = await prompts({
      type: 'multiselect',
      name: 'selectedTools',
      message: 'Select AI development tools to configure',
      choices,
      hint: '- Space to select. Return to submit',
      validate: (selected: string[]) => {
        if (selected.length === 0) {
          return 'You must select at least one tool';
        }
        return true;
      },
    });

    // Handle cancelled prompts (user pressed Ctrl+C/ESC or null response)
    if (!response?.selectedTools || response.selectedTools.length === 0) {
      return [];
    }

    // Map selected IDs back to full metadata, preserving selection order
    const selectedToolIds: string[] = response.selectedTools;

    return selectedToolIds.map((id: string) => {
      const tool = supportedTools.find(t => t.id === id);
      if (!tool) {
        throw new Error(`Internal error: Selected tool '${id}' not found in registry`);
      }
      return tool;
    });
  }

  /**
   * Prompt user for configuration settings
   *
   * **VALIDATION:** Each prompt validates input range per setupConfigSchema
   * **RETRY:** Prompts library automatically retries on validation failure
   * **DEFAULTS:** Shows recommended defaults for quick setup
   * **SECURITY:** Final AJV validation before returning (prevent divergence)
   *
   * @throws Error if user cancels (Ctrl+C/ESC) or validation fails
   * @returns SetupConfig object with validated configuration
   */
  async askConfigQuestions(): Promise<SetupConfig> {
    // Ask if user wants to use defaults
    const useDefaultsResponse = await prompts({
      type: 'confirm',
      name: 'useDefaults',
      message: 'Use default configuration?',
      initial: true,
    });

    // If user cancelled or wants defaults, return default config
    if (!useDefaultsResponse || useDefaultsResponse.useDefaults !== false) {
      return {
        proxyPort: 3333,
        executionTimeout: 30000,
        rateLimit: 30,
        auditLogPath: '~/.code-executor/audit-logs/audit.jsonl',
        schemaCacheTTL: 86400000, // 24 hours (in milliseconds)
      };
    }

    // Otherwise, ask detailed questions
    console.log('\n⚙️  Advanced Configuration\n');

    // Proxy Port
    const proxyPort = this.validateResponse(
      await prompts({
        type: 'number',
        name: 'proxyPort',
        message: 'Proxy server port',
        initial: 3333,
        validate: (value: number) => {
          if (value < 1024 || value > 65535) {
            return 'Port must be between 1024 and 65535 (unprivileged ports)';
          }
          return true;
        },
      }),
      'proxyPort'
    ) as number;

    // Execution Timeout
    const executionTimeout = this.validateResponse(
      await prompts({
        type: 'number',
        name: 'executionTimeout',
        message: 'Execution timeout (milliseconds)',
        initial: 120000,
        validate: (value: number) => {
          if (value < 1000 || value > 600000) {
            return 'Timeout must be between 1000ms (1s) and 600000ms (10min)';
          }
          return true;
        },
      }),
      'executionTimeout'
    ) as number;

    // Rate Limit
    const rateLimit = this.validateResponse(
      await prompts({
        type: 'number',
        name: 'rateLimit',
        message: 'Rate limit (requests per minute)',
        initial: 30,
        validate: (value: number) => {
          if (value < 1 || value > 1000) {
            return 'Rate limit must be between 1 and 1000 requests/minute';
          }
          return true;
        },
      }),
      'rateLimit'
    ) as number;

    // Audit Log Path
    const auditLogPath = this.validateResponse(
      await prompts({
        type: 'text',
        name: 'auditLogPath',
        message: 'Audit log file path',
        initial: '~/.code-executor/audit-logs/audit.jsonl',
        validate: (value: string) => {
          if (!value || value.trim().length === 0) {
            return 'Audit log path cannot be empty';
          }
          return true;
        },
      }),
      'auditLogPath'
    ) as string;

    // Schema Cache TTL
    const schemaCacheTTL = this.validateResponse(
      await prompts({
        type: 'number',
        name: 'schemaCacheTTL',
        message: 'Schema cache TTL (hours)',
        initial: 24,
        validate: (value: number) => {
          if (value < 1 || value > 168) {
            return 'Schema cache TTL must be between 1 hour and 168 hours (1 week)';
          }
          return true;
        },
      }),
      'schemaCacheTTL'
    ) as number;

    // Build config object
    const config: SetupConfig = {
      proxyPort,
      executionTimeout,
      rateLimit,
      auditLogPath,
      schemaCacheTTL,
    };

    // Runtime AJV validation (security: prevent prompt/schema divergence)
    const validate = this.ajv.compile(setupConfigSchema);
    if (!validate(config)) {
      const errors = this.ajv.errorsText(validate.errors);
      throw new Error(`Configuration validation failed: ${errors}`);
    }

    return config;
  }

  /**
   * Prompt user to select MCP servers for wrapper generation
   *
   * **INTEGRATION:** Combines discovery results with ping status for informed selection
   * **VALIDATION:** Minimum 1 server must be selected
   * **STATUS INDICATORS:** ✓ (available), ✗ (unavailable), ? (unknown)
   * **RETURNS:** Array of selected server status results (preserves selection order)
   *
   * @param servers - Array of MCP server status results from discovery + ping
   * @throws Error if no servers discovered
   * @returns Selected server status results in user's selection order
   */
  async selectMCPServers(servers: MCPServerStatusResult[]): Promise<MCPServerStatusResult[]> {
    // Validate input: must have at least 1 discovered server
    if (servers.length === 0) {
      throw new Error(
        'No MCP servers discovered. Please ensure your AI tools have MCP servers configured in their .mcp.json files.'
      );
    }

    // Create prompt choices with status indicators and metadata
    const choices = servers.map(statusResult => {
      // Status indicator (visual feedback)
      const statusIcon =
        statusResult.status === 'available' ? '✓' :
        statusResult.status === 'unavailable' ? '✗' :
        '?'; // unknown

      // Format title with status and server name
      const title = `${statusIcon} ${statusResult.server.name}`;

      // Format description with source tool and command info
      const description = `Source: ${statusResult.server.sourceTool} | Command: ${statusResult.server.command}`;

      return {
        title,
        value: statusResult.server.name,
        description,
      };
    });

    // Multi-select prompt with validation
    const response = await prompts({
      type: 'multiselect',
      name: 'selectedServers',
      message: 'Select MCP servers to generate wrappers for',
      choices,
      hint: '- Space to select. Return to submit',
      validate: (selected: string[]) => {
        if (selected.length === 0) {
          return 'You must select at least one MCP server';
        }
        return true;
      },
    });

    // Handle cancelled prompts (user pressed Ctrl+C/ESC or null response)
    if (!response?.selectedServers || response.selectedServers.length === 0) {
      return [];
    }

    // Map selected server names back to full status results, preserving selection order
    const selectedServerNames: string[] = response.selectedServers;

    return selectedServerNames.map((name: string) => {
      const serverStatus = servers.find(s => s.server.name === name);
      if (!serverStatus) {
        throw new Error(
          `Selected MCP server '${name}' is no longer available. ` +
          `It may have been removed from config after discovery. ` +
          `Please re-run the wizard.`
        );
      }
      return serverStatus;
    });
  }

  /**
   * Prompt user to select wrapper language for each MCP server
   *
   * **APPROACH:** Per-item prompting (iterate servers, ask language choice for each)
   * **VALIDATION:** Ensures all servers get language selection
   * **CHOICES:** TypeScript, Python, or Both
   * **RETURNS:** Array of language selections (server + language pairs)
   *
   * @param selectedServers - Array of MCP server status results from selectMCPServers()
   * @throws Error if no servers provided or user cancels
   * @returns Language selections in server order
   *
   * @example
   * ```typescript
   * const wizard = new CLIWizard(toolDetector);
   * const selections = await wizard.selectLanguagePerMCP(servers);
   * // selections: [{ server: {...}, language: 'typescript' }, { server: {...}, language: 'python' }]
   * ```
   */
  async selectLanguagePerMCP(selectedServers: MCPServerStatusResult[]): Promise<LanguageSelection[]> {
    // Validate input: must have at least 1 server
    if (selectedServers.length === 0) {
      throw new Error('No servers provided for language selection');
    }

    // Language selection choices (same for all servers)
    const languageChoices = [
      {
        title: 'TypeScript',
        value: 'typescript' as WrapperLanguage,
        description: 'Generate TypeScript wrapper with type definitions',
      },
      {
        title: 'Python',
        value: 'python' as WrapperLanguage,
        description: 'Generate Python wrapper with type hints',
      },
      {
        title: 'Both (TypeScript + Python)',
        value: 'both' as WrapperLanguage,
        description: 'Generate wrappers for both languages',
      },
    ];

    // Collect language selections per server
    const selections: LanguageSelection[] = [];

    // Ask if user wants same language for all servers (faster for many servers)
    const useSameForAll = await prompts({
      type: 'confirm',
      name: 'value',
      message: `Generate wrappers with same language for all ${selectedServers.length} servers?`,
      initial: true,
    });

    // Handle cancelled prompt
    if (useSameForAll.value === undefined) {
      throw new Error('Language selection cancelled by user');
    }

    // If yes, ask once and apply to all servers
    if (useSameForAll.value === true) {
      const languageResponse = await prompts({
        type: 'select',
        name: 'language',
        message: 'Select wrapper language for all MCP servers',
        choices: languageChoices,
        initial: 0, // Default to TypeScript
      });

      if (!languageResponse || languageResponse.language === undefined) {
        throw new Error('Language selection cancelled by user');
      }

      const language = languageResponse.language as WrapperLanguage;

      // Apply same language to all servers
      for (const serverStatus of selectedServers) {
        selections.push({
          server: serverStatus.server,
          language,
        });
      }

      return selections;
    }

    // Otherwise, iterate through servers and prompt for each
    for (const serverStatus of selectedServers) {
      const response = await prompts({
        type: 'select',
        name: 'language',
        message: `Select wrapper language for "${serverStatus.server.name}"`,
        choices: languageChoices,
        initial: 0, // Default to TypeScript
      });

      // Handle cancelled prompt (user pressed Ctrl+C/ESC)
      if (!response || response.language === undefined) {
        throw new Error('Language selection cancelled by user');
      }

      const language = response.language;

      // Runtime type guard validation (fail-fast if prompts library returns unexpected value)
      const validLanguages: WrapperLanguage[] = ['typescript', 'python', 'both'];
      if (!validLanguages.includes(language as WrapperLanguage)) {
        throw new Error(
          `Invalid language selection: ${language}. Expected one of: ${validLanguages.join(', ')}`
        );
      }

      // Add selection to results
      selections.push({
        server: serverStatus.server,
        language: language as WrapperLanguage, // Safe after validation
      });
    }

    return selections;
  }

  /**
   * Display benefits panel explaining advantages of using generated wrappers
   *
   * **WHY:** Educate users on wrapper benefits to maximize adoption
   * **RESPONSIBILITY (SRP):** UI-only method, displays static information
   *
   * @returns void - No return value, displays panel and waits for user to read
   */
  displayBenefitsPanel(): void {
    console.log('\n🎯 Why Use Wrappers?\n');
    console.log('✅ Type Safety: IntelliSense autocomplete for all MCP tool parameters');
    console.log('✅ Progressive Disclosure: AI agents see typed signatures, reducing trial-and-error');
    console.log('✅ Easier Testing: Mock MCP calls with typed stubs');
    console.log('✅ Error Prevention: Compile-time validation catches invalid parameters');
    console.log('✅ Better Visibility: Call graph analysis shows MCP usage patterns');
    console.log('✅ Documentation: Generated JSDoc/docstrings from MCP schemas');
    console.log('');
  }

  /**
   * Generate wrappers with progress tracking
   *
   * **RESPONSIBILITY (SRP):** Orchestrate wrapper generation with UI feedback
   * **WHY:** Provides visual feedback during potentially long-running operation
   * **RESILIENCE:** Handles partial failures gracefully (some succeed, some fail)
   *
   * @param selections - Language selections per MCP server
   * @param moduleFormat - Module format for TypeScript wrappers (ESM or CommonJS)
   * @returns Result object with succeeded and failed arrays
   *
   * @throws Error if wrapperGenerator not injected
   */
  async generateWrappersWithProgress(
    selections: LanguageSelection[],
    moduleFormat: 'esm' | 'commonjs',
    regenOption: 'missing' | 'force' = 'force'
  ): Promise<{ succeeded: Array<{ server: string; language: string; path: string }>; skipped: Array<{ server: string; language: string; path: string }>; failed: Array<{ server: string; language: string; error: string }> }> {
    if (!this.wrapperGenerator) {
      throw new Error('WrapperGenerator not initialized. Cannot generate wrappers.');
    }

    const succeeded: Array<{ server: string; language: string; path: string }> = [];
    const skipped: Array<{ server: string; language: string; path: string }> = [];
    const failed: Array<{ server: string; language: string; error: string }> = [];

    // Calculate total tasks (expand 'both' language into 2 tasks)
    const totalTasks = selections.reduce((count, selection) => {
      return count + (selection.language === 'both' ? 2 : 1);
    }, 0);

    // Create progress bar
    const progressBar = new cliProgress.SingleBar({
      format: 'Generating wrappers [{bar}] {percentage}% | {value}/{total} | {task}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
    });

    progressBar.start(totalTasks, 0, { task: 'Initializing...' });

    let currentTask = 0;

    for (const selection of selections) {
      const { server, language } = selection;

      // Expand 'both' into TypeScript + Python
      const languages: Array<'typescript' | 'python'> = language === 'both' ? ['typescript', 'python'] : [language as 'typescript' | 'python'];

      for (const lang of languages) {
        currentTask++;
        progressBar.update(currentTask, { task: `${server.name} (${lang})` });

        try {
          // Convert MCPServerConfig to MCPServerSelection for WrapperGenerator
          //
          // **WHY HARDCODED VALUES ARE SAFE:**
          // WrapperGenerator.generateWrapper() only uses:
          //   - name (required): Passed from server.name
          //   - tools (optional): Fetched by generator if undefined
          //
          // Unused fields (safe to mock):
          //   - type, status, toolCount, sourceConfig: Not accessed by generator
          //
          // **ARCHITECTURE NOTE:** LanguageSelection uses MCPServerConfig (from selectLanguagePerMCP),
          // but WrapperGenerator requires MCPServerSelection (superset with metadata).
          // Since metadata fields aren't used for generation, hardcoded defaults are acceptable.
          //
          // **FUTURE:** If WrapperGenerator needs real metadata, pass MCPServerStatusResult
          // instead of MCPServerConfig in LanguageSelection.
          const mcpForGeneration: MCPServerSelection = {
            name: server.name,
            description: undefined,
            type: 'STDIO' as const, // Not used by generator
            status: 'online' as const, // Not used by generator
            toolCount: 0, // Not used by generator
            sourceConfig: '', // Not used by generator
            tools: undefined, // WrapperGenerator fetches if missing
          };

          const result = await this.wrapperGenerator.generateWrapper(mcpForGeneration, lang, moduleFormat, regenOption);

          if (result.success) {
            if (result.skipped) {
              skipped.push({
                server: server.name,
                language: lang,
                path: result.outputPath,
              });
            } else {
              succeeded.push({
                server: server.name,
                language: lang,
                path: result.outputPath,
              });
            }
          } else {
            failed.push({
              server: server.name,
              language: lang,
              error: 'Generation failed (check logs)',
            });
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          failed.push({
            server: server.name,
            language: lang,
            error: errorMessage,
          });
        }
      }
    }

    progressBar.stop();

    return { succeeded, skipped, failed };
  }

  /**
   * Display completion screen with success/failure breakdown
   *
   * **RESPONSIBILITY (SRP):** UI-only method, displays generation results summary
   * **WHY:** Provides clear feedback on what succeeded/failed during setup
   *
   * @param results - Generation results with succeeded and failed arrays
   * @returns void - No return value, displays completion summary
   */
  displayCompletionScreen(results: {
    succeeded: Array<{ server: string; language: string; path: string }>;
    failed: Array<{ server: string; language: string; error: string }>;
  }): void {
    console.log('\n');

    // Display header
    if (results.failed.length === 0) {
      console.log('✅ Setup Complete!\n');
    } else if (results.succeeded.length === 0) {
      console.log('❌ Setup Failed\n');
    } else {
      console.log('⚠️  Setup Complete (with warnings)\n');
    }

    // Display statistics
    const total = results.succeeded.length + results.failed.length;
    console.log(`Wrappers Generated: ${results.succeeded.length} succeeded, ${results.failed.length} failed (${total} total)\n`);

    // Display succeeded wrappers
    if (results.succeeded.length > 0) {
      console.log('✅ Successful:');
      results.succeeded.forEach(({ server, language, path }) => {
        console.log(`   ${server} (${language}) → ${path}`);
      });
      console.log('');
    }

    // Display failed wrappers
    if (results.failed.length > 0) {
      console.log('❌ Failed:');
      results.failed.forEach(({ server, language, error }) => {
        console.log(`   ${server} (${language}): ${error}`);
      });
      console.log('');
    }

    // Display next steps
    if (results.succeeded.length > 0) {
      console.log('📚 Next Steps:');
      console.log('   1. Import wrappers: import { readFile } from \'./generated/wrappers/typescript/mcp-<server>\'');
      console.log('   2. Use in code: const content = await readFile({ path: \'/path/to/file\' });');
      if (results.failed.length > 0) {
        console.log('   3. Check logs: ~/.code-executor/wrapper-generation.log');
        console.log('   4. Retry failed: code-executor-mcp generate-wrappers --mcps <server-name>');
      }
      console.log('');
    } else {
      console.log('💡 Troubleshooting:');
      console.log('   1. Check logs: ~/.code-executor/wrapper-generation.log');
      console.log('   2. Verify MCP servers are running: code-executor-mcp config');
      console.log('   3. Retry setup: code-executor-mcp setup --force');
      console.log('');
    }
  }

  /**
   * Ask daily sync configuration
   *
   * **BEHAVIOR:**
   * 1. Prompt: "Enable daily wrapper sync? (Y/n)" - default Yes
   * 2. If yes, prompt: "Preferred sync time (4-6 AM):" - default 05:00
   * 3. Validate sync time: HH:MM format, 4-6 AM range
   * 4. Return config object or null if disabled
   *
   * **VALIDATION:**
   * - Sync time format: HH:MM (24-hour)
   * - Sync time range: 04:00 to 06:00 (inclusive)
   * - Retry on invalid input
   *
   * @returns Promise<DailySyncConfig | null> Configuration or null if disabled
   *
   * @example
   * const config = await wizard.askDailySyncConfig();
   * if (config) {
   *   console.log(`Daily sync enabled at ${config.syncTime}`);
   * }
   */
  async askDailySyncConfig(): Promise<import('./types.js').DailySyncConfig | null> {
    // Prompt 1: Enable daily sync?
    const enableResponse = await prompts({
      type: 'confirm',
      name: 'enabled',
      message: 'Enable daily wrapper sync?',
      initial: true, // Default: Yes
    });

    // If user declined or cancelled (Ctrl+C)
    if (!enableResponse.enabled) {
      return null;
    }

    // Prompt 2: Sync time (4-6 AM)
    const timeResponse = await prompts({
      type: 'text',
      name: 'syncTime',
      message: 'Preferred sync time (4-6 AM):',
      initial: '05:00',
      validate: (value: string) => {
        // Validate format: HH:MM
        const timeRegex = /^(\d{2}):(\d{2})$/;
        const match = value.match(timeRegex);

        if (!match) {
          return 'Invalid time format. Please use HH:MM format (e.g., 05:00)';
        }

        const hours = parseInt(match[1]!, 10);
        const minutes = parseInt(match[2]!, 10);

        // Validate range: 4-6 AM (04:00 to 06:00 inclusive)
        if (hours < 4 || hours > 6 || (hours === 6 && minutes > 0)) {
          return 'Sync time must be between 04:00 and 06:00';
        }

        // Validate minutes range (00-59)
        if (minutes < 0 || minutes > 59) {
          return 'Invalid minutes. Please use 00-59';
        }

        return true;
      },
    });

    // If user cancelled (Ctrl+C)
    if (!timeResponse.syncTime) {
      return null;
    }

    return {
      enabled: true,
      syncTime: timeResponse.syncTime,
    };
  }

  /**
   * Generate VS Code task configuration
   *
   * **BEHAVIOR:**
   * 1. Create .vscode directory if it doesn't exist
   * 2. Copy vscode-tasks.json template to .vscode/tasks.json
   * 3. Merge with existing tasks if file already exists
   *
   * **USAGE:** Called after daily sync setup to provide manual sync task
   *
   * @param projectRoot Absolute path to project root directory
   * @returns Promise<void>
   *
   * @example
   * await wizard.generateVSCodeTasks('/home/user/my-project');
   */
  async generateVSCodeTasks(projectRoot: string): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');

    // Create .vscode directory if it doesn't exist
    const vscodeDir = path.join(projectRoot, '.vscode');
    await fs.mkdir(vscodeDir, { recursive: true });

    // Read template
    const templatePath = path.join(__dirname, '..', '..', 'templates', 'vscode-tasks.json');
    const templateContent = await fs.readFile(templatePath, 'utf8');
    const templateTasks = JSON.parse(templateContent);

    // Check if tasks.json already exists
    const tasksPath = path.join(vscodeDir, 'tasks.json');
    let finalTasks = templateTasks;

    try {
      const existingContent = await fs.readFile(tasksPath, 'utf8');
      const existingTasks = JSON.parse(existingContent);

      // Merge tasks (append new tasks to existing)
      if (existingTasks.tasks && Array.isArray(existingTasks.tasks)) {
        finalTasks = {
          ...existingTasks,
          tasks: [...existingTasks.tasks, ...templateTasks.tasks],
        };
      }
    } catch {
      // File doesn't exist or is invalid JSON - use template as-is
    }

    // Write merged tasks
    await fs.writeFile(tasksPath, JSON.stringify(finalTasks, null, 2));

    console.log(`✅ VS Code tasks generated: ${tasksPath}`);
    console.log('   Run "Tasks: Run Task" in VS Code to use them');
  }

  // ============================================================================
  // Visual Feedback Methods (FR-7)
  // ============================================================================

  /**
   * Display ASCII art banner for wizard
   *
   * **BEHAVIOR:**
   * 1. Generates ASCII art using figlet library
   * 2. Returns banner string for display
   *
   * **WHY:** Professional branding and visual appeal for CLI wizard
   *
   * @returns ASCII art banner string
   *
   * @example
   * const wizard = new CLIWizard(toolDetector);
   * const banner = wizard.showBanner();
   * console.log(banner);
   */
  showBanner(): string {
    try {
      const banner = figlet.textSync('Code Executor MCP', {
        font: 'Standard',
        horizontalLayout: 'default',
        verticalLayout: 'default',
      });
      return kleur.yellow(banner); // Orange-ish (closest to Claude orange)
    } catch {
      // Fallback if figlet fails
      return kleur.bold().cyan('=== Code Executor MCP Setup Wizard ===');
    }
  }

  /**
   * Format message with color coding and icons
   *
   * **BEHAVIOR:**
   * - success: Green with ✓ icon
   * - error: Red with ✗ icon
   * - warning: Yellow with ⚠ icon
   * - info: Blue with ℹ icon
   *
   * **WHY:** Consistent visual feedback across wizard
   *
   * @param type Message type (success, error, warning, info)
   * @param message Message text
   * @returns Formatted message string
   *
   * @example
   * wizard.formatMessage('success', 'Configuration saved');
   * // Returns: "✓ Configuration saved" (in green)
   */
  formatMessage(type: 'success' | 'error' | 'warning' | 'info', message: string): string {
    switch (type) {
      case 'success':
        return kleur.green(`✓ ${message}`);
      case 'error':
        return kleur.red(`✗ ${message}`);
      case 'warning':
        return kleur.yellow(`⚠ ${message}`);
      case 'info':
        return kleur.yellow(`ℹ ${message}`); // Orange-ish (closest to Claude orange)
      default:
        return message;
    }
  }

  /**
   * Create spinner for async operations
   *
   * **BEHAVIOR:**
   * - Creates ora spinner instance
   * - Returns spinner with start/succeed/fail/warn methods
   *
   * **LIFECYCLE:** Caller MUST call .stop(), .succeed(), or .fail() to clean up
   * **WHY:** Unclosed spinners leak Node.js timers and prevent process exit
   *
   * @param text Initial spinner text
   * @returns Ora spinner instance
   *
   * @example
   * const spinner = wizard.createSpinner('Discovering MCP servers...');
   * try {
   *   spinner.start();
   *   await asyncOperation();
   *   spinner.succeed('Success');
   * } catch (error) {
   *   spinner.fail('Failed');
   * }
   */
  createSpinner(text: string): Ora {
    return ora({
      text,
      color: 'cyan',
      spinner: 'dots',
    });
  }

  /**
   * Create progress bar for multi-step operations
   *
   * **BEHAVIOR:**
   * - Creates cli-progress SingleBar instance
   * - Returns progress bar with start/update/increment/stop methods
   *
   * **LIFECYCLE:** Caller MUST call .stop() to clean up (restores cursor, clears output)
   * **WHY:** Unclosed progress bars leave cursor hidden and incomplete terminal output
   *
   * @param total Total number of steps
   * @param label Progress bar label
   * @returns CLI progress bar instance
   *
   * @example
   * const bar = wizard.createProgressBar(10, 'Generating wrappers');
   * try {
   *   bar.start(10, 0);
   *   for (let i = 0; i < 10; i++) {
   *     // ... generate wrapper ...
   *     bar.increment();
   *   }
   * } finally {
   *   bar.stop(); // ✅ Guaranteed cleanup
   * }
   */
  createProgressBar(total: number, label: string): cliProgress.SingleBar {
    return new cliProgress.SingleBar({
      format: `${kleur.yellow(label)} |${kleur.yellow('{bar}')}| {percentage}% | {value}/{total}`,
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true,
    });
  }

  /**
   * Format completion summary table
   *
   * **BEHAVIOR:**
   * - Displays setup completion summary
   * - Shows configured tools, MCPs discovered, wrappers generated
   * - Highlights failures with warning color
   *
   * **WHY:** Clear summary of wizard results
   *
   * @param summary Setup completion data
   * @returns Formatted summary table string
   *
   * @example
   * const summary = {
   *   toolsConfigured: ['claude-code', 'windsurf'],
   *   mcpsDiscovered: 5,
   *   wrappersGenerated: 3,
   *   wrappersFailed: 0,
   *   dailySyncEnabled: true,
   * };
   * const table = wizard.formatCompletionSummary(summary);
   * console.log(table);
   */
  formatCompletionSummary(summary: {
    toolsConfigured: string[];
    mcpsDiscovered: number;
    wrappersGenerated: number;
    wrappersFailed: number;
    dailySyncEnabled: boolean;
  }): string {
    const lines: string[] = [];

    // Header
    lines.push('');
    lines.push(kleur.bold().green('═'.repeat(60)));
    lines.push(kleur.bold().green('  Setup Complete! 🎉'));
    lines.push(kleur.bold().green('═'.repeat(60)));
    lines.push('');

    // Tools configured
    lines.push(kleur.bold('AI Tools Configured:'));
    summary.toolsConfigured.forEach((tool) => {
      lines.push(kleur.yellow(`  ✓ ${tool}`)); // Orange-ish (closest to Claude orange)
    });
    lines.push('');

    // MCP discovery
    lines.push(kleur.bold('MCP Servers:'));
    lines.push(kleur.yellow(`  ${summary.mcpsDiscovered} servers discovered`)); // Orange-ish (closest to Claude orange)
    lines.push('');

    // Wrapper generation
    lines.push(kleur.bold('Wrappers Generated:'));
    lines.push(kleur.green(`  ✓ ${summary.wrappersGenerated} successful`));
    if (summary.wrappersFailed > 0) {
      lines.push(kleur.yellow(`  ⚠ ${summary.wrappersFailed} failed (see logs)`));
    }
    lines.push('');

    // Daily sync
    lines.push(kleur.bold('Daily Sync:'));
    if (summary.dailySyncEnabled) {
      lines.push(kleur.green('  ✓ Enabled (automated wrapper updates)'));
    } else {
      lines.push(kleur.gray('  ⊘ Disabled (manual updates only)'));
    }
    lines.push('');

    // Footer
    lines.push(kleur.bold().green('═'.repeat(60)));
    lines.push('');

    return lines.join('\n');
  }

  /**
   * FR-8: Detect existing configuration files
   *
   * **TDD:** RED phase test exists, implementing GREEN
   * **RETURNS:** Array of existing config detection results
   *
   * @param tools Selected AI tools to check for existing configs
   */
  async detectExistingConfigs(tools: AIToolMetadata[]): Promise<Array<{
    toolId: string;
    toolName: string;
    configPath: string;
    exists: boolean;
    valid: boolean;
    config?: any;
  }>> {
    const results = [];

    for (const tool of tools) {
      try {
        const configPath = tool.configPaths[process.platform as 'linux' | 'darwin' | 'win32'] || tool.configPaths.linux;
        if (!configPath) {
          continue;
        }
        const expandedPath = configPath.replace(/^~/, process.env.HOME || process.env.USERPROFILE || '~');

        try {
          // Check if config file exists
          const stat = await import('fs/promises').then(fs => fs.stat(expandedPath));
          if (!stat.isFile()) {
            results.push({
              toolId: tool.id,
              toolName: tool.name,
              configPath: expandedPath,
              exists: false,
              valid: false,
            });
            continue;
          }

          // Read and parse config
          const configContent = await import('fs/promises').then(fs => fs.readFile(expandedPath, 'utf-8'));
          const config = JSON.parse(configContent);

          results.push({
            toolId: tool.id,
            toolName: tool.name,
            configPath: expandedPath,
            exists: true,
            valid: true,
            config,
          });
        } catch {
          // Config doesn't exist or is invalid
          results.push({
            toolId: tool.id,
            toolName: tool.name,
            configPath: expandedPath,
            exists: false,
            valid: false,
          });
        }
      } catch {
        // Tool config path resolution failed
        continue;
      }
    }

    return results;
  }

  /**
   * FR-8: Prompt user for config update options
   *
   * **TDD:** RED phase test exists, implementing GREEN
   * **RETURNS:** Update option ('keep' | 'merge' | 'reset') or null if cancelled
   *
   * @param existingConfigs Array of existing config detection results
   */
  async promptConfigUpdate(_existingConfigs: Array<{ toolId: string; toolName: string; configPath: string; exists: boolean; valid: boolean; config?: any }>): Promise<'keep' | 'merge' | 'reset' | null> {
    const response = await prompts({
      type: 'select',
      name: 'updateOption',
      message: kleur.bold('Existing configurations detected. How would you like to proceed?'),
      choices: [
        {
          title: kleur.green('Keep existing') + kleur.gray(' - Preserve all current settings (no changes)'),
          value: 'keep',
        },
        {
          title: kleur.yellow('Merge new MCPs') + kleur.gray(' - Add new MCP servers to existing configs'), // Orange-ish
          value: 'merge',
        },
        {
          title: kleur.yellow('Full reset') + kleur.gray(' - Replace all configs (backup created first)'),
          value: 'reset',
        },
      ],
      initial: 1, // Default to merge
    });

    if (!response.updateOption) {
      return null;
    }

    return response.updateOption;
  }

  /**
   * FR-8: Acquire wizard lock file
   *
   * **TDD:** RED phase test exists, implementing GREEN
   * **THROWS:** Error if lock already held by another wizard process
   */
  async acquireLock(): Promise<void> {
    await this.lockFileService.acquire();
  }

  /**
   * FR-8: Release wizard lock file
   *
   * **TDD:** RED phase test exists, implementing GREEN
   */
  async releaseLock(): Promise<void> {
    await this.lockFileService.release();
  }

  /**
   * FR-8: Prompt user for wrapper regeneration options
   *
   * **TDD:** RED phase test exists, implementing GREEN
   * **RETURNS:** Regeneration option ('missing' | 'force' | 'skip') or null if cancelled
   */
  async promptWrapperRegeneration(): Promise<'missing' | 'force' | 'skip' | null> {
    const response = await prompts({
      type: 'select',
      name: 'regenOption',
      message: kleur.bold('Wrapper regeneration:'),
      choices: [
        {
          title: kleur.green('Generate missing only') + kleur.gray(' - Only create wrappers that don\'t exist'),
          value: 'missing',
        },
        {
          title: kleur.yellow('Force regenerate all') + kleur.gray(' - Overwrite all existing wrappers'),
          value: 'force',
        },
        {
          title: kleur.gray('Skip generation') + kleur.gray(' - Don\'t generate any wrappers'),
          value: 'skip',
        },
      ],
      initial: 0, // Default to missing only
    });

    if (!response.regenOption) {
      return null;
    }

    return response.regenOption;
  }

  /**
   * Prompt user for project-specific .mcp.json path
   *
   * **WHY:** Users with multiple projects need to specify which project's MCP config to use
   * **VALIDATION:** Expands ~ to home directory, validates path is within allowed directories
   * **SECURITY:** Prevents path traversal attacks by validating resolved path
   * **RETURNS:** Absolute path to project .mcp.json or null if skipped/cancelled
   *
   * @returns Project .mcp.json path or null if user skips/cancels
   * @throws Error if path is invalid or outside allowed directories
   */
  async promptForProjectMCPConfig(): Promise<string | null> {
    const response = await prompts({
      type: 'text',
      name: 'path',
      message: kleur.bold('Path to project .mcp.json (optional, press Enter to skip):'),
      initial: '',
      validate: (value: string) => {
        // Empty is valid (skip)
        if (!value || !value.trim()) {
          return true;
        }

        // Basic path validation
        if (!value.endsWith('.mcp.json') && !value.endsWith('.json')) {
          return 'Path must point to a .json or .mcp.json file';
        }

        return true;
      },
    });

    // User cancelled
    if (!response) {
      return null;
    }

    // User skipped (empty path)
    if (!response.path || !response.path.trim()) {
      return null;
    }

    // Expand ~ to home directory
    const expandedPath = response.path.replace(/^~/, os.homedir());

    // Resolve to absolute path to prevent path traversal
    const resolvedPath = path.resolve(expandedPath);

    // Validate path is within allowed directories (home or current working directory)
    const allowedDirs = [
      path.resolve(os.homedir()),
      path.resolve(process.cwd()),
    ];

    const isAllowed = allowedDirs.some(dir => resolvedPath.startsWith(dir));
    if (!isAllowed) {
      throw new Error(
        `Invalid path: ${resolvedPath}. Path must be within home directory or current working directory.`
      );
    }

    return resolvedPath;
  }
}
