/**
 * CLIWizard - Interactive CLI wizard for code-executor-mcp setup
 *
 * **RESPONSIBILITY (SRP):** Orchestrate interactive CLI prompts for setup wizard
 * **WHY:** Centralized wizard logic separates UI concerns from business logic
 */

import prompts from 'prompts';
import { Ajv } from 'ajv';
import cliProgress from 'cli-progress';
import type { ToolDetector } from './tool-detector.js';
import type { AIToolMetadata } from './tool-registry.js';
import type { SetupConfig, MCPServerStatusResult, LanguageSelection, WrapperLanguage, MCPServerSelection } from './types.js';
import { setupConfigSchema } from './schemas/setup-config.schema.js';
import type { WrapperGenerator } from './wrapper-generator.js';

/**
 * CLIWizard - Main orchestrator for setup wizard
 *
 * **DESIGN:** Composition over inheritance (uses ToolDetector via DI)
 */
export class CLIWizard {
  private readonly ajv: Ajv;
  private readonly wrapperGenerator?: WrapperGenerator;

  constructor(
    private readonly toolDetector: ToolDetector,
    wrapperGenerator?: WrapperGenerator
  ) {
    this.ajv = new Ajv();
    this.wrapperGenerator = wrapperGenerator;
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
    // Detect installed tools
    const installedTools = await this.toolDetector.detectInstalledTools();

    if (installedTools.length === 0) {
      throw new Error(
        'No AI tools detected. Please install at least one supported tool:\n' +
        '- Claude Code (https://code.claude.com)\n' +
        '- Cursor (https://cursor.sh)\n' +
        '- Windsurf (https://windsurf.ai)'
      );
    }

    // Create prompt choices from installed tools
    const choices = installedTools.map(tool => ({
      title: tool.name,
      value: tool.id,
      description: `${tool.description} (${tool.website})`,
    }));

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
    // TypeScript narrows type automatically after guard (no assertion needed)
    const selectedToolIds: string[] = response.selectedTools;

    return selectedToolIds.map((id: string) => {
      const tool = installedTools.find(t => t.id === id);
      if (!tool) {
        throw new Error(
          `Selected tool '${id}' is no longer available. ` +
          `It may have been uninstalled after detection. ` +
          `Please re-run the wizard.`
        );
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
    // Proxy Port
    const proxyPort = this.validateResponse(
      await prompts({
        type: 'number',
        name: 'proxyPort',
        message: 'Proxy server port',
        initial: 3000,
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

    // Iterate through servers and prompt for each
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
    moduleFormat: 'esm' | 'commonjs'
  ): Promise<{ succeeded: Array<{ server: string; language: string; path: string }>; failed: Array<{ server: string; language: string; error: string }> }> {
    if (!this.wrapperGenerator) {
      throw new Error('WrapperGenerator not initialized. Cannot generate wrappers.');
    }

    const succeeded: Array<{ server: string; language: string; path: string }> = [];
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

          const result = await this.wrapperGenerator.generateWrapper(mcpForGeneration, lang, moduleFormat);

          if (result.success) {
            succeeded.push({
              server: server.name,
              language: lang,
              path: result.outputPath,
            });
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

    return { succeeded, failed };
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
}
