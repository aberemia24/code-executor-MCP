#!/usr/bin/env node
/**
 * CLI Entry Point - Interactive Setup Wizard
 *
 * **RESPONSIBILITY (SRP):** Bootstrap CLI wizard with error handling
 * **WHY:** Single entry point for CLI setup command
 */

import { CLIWizard } from './wizard.js';
import { ToolDetector } from './tool-detector.js';
import { WrapperGenerator } from './wrapper-generator.js';
import { SelfInstaller } from './self-installer.js';
import { MCPDiscoveryService } from './mcp-discovery.js';
import type { MCPServerConfig } from './types.js';
import path from 'path';
import os from 'os';

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  try {
    console.log('\n🚀 code-executor-mcp Setup Wizard\n');

    // Step 1: Self-install check (FR-9)
    console.log('📦 Checking global installation...\n');
    const installer = new SelfInstaller();
    await installer.runBootstrap();

    // Step 2: Initialize components
    const toolDetector = new ToolDetector();
    const wrapperGenerator = new WrapperGenerator({
      outputDir: path.join(os.homedir(), '.code-executor', 'wrappers'),
      templateDir: path.join(process.cwd(), 'templates'),
      manifestPath: path.join(os.homedir(), '.code-executor', 'wrapper-manifest.json'),
    });

    const wizard = new CLIWizard(toolDetector, wrapperGenerator);

    // Step 3: Acquire lock (FR-8)
    await wizard.acquireLock();

    try {
      // Step 4: Show banner (FR-7)
      console.log(wizard.showBanner());
      console.log('\n');

      // Step 5: Select AI tools first (needed for detectExistingConfigs)
      console.log('📋 Select AI Development Tools\n');
      const selectedTools = await wizard.selectTools();

      if (selectedTools.length === 0) {
        console.log('\n⚠️  No tools selected. Exiting.');
        return;
      }

      console.log(
        wizard.formatMessage('success', `Selected: ${selectedTools.map(t => t.name).join(', ')}`)
      );

      // Step 6: Detect existing configs (FR-8) - requires tools parameter
      const existingConfigs = await wizard.detectExistingConfigs(selectedTools);

      if (existingConfigs.length > 0) {
        console.log(
          wizard.formatMessage('info', `Found ${existingConfigs.length} existing configuration(s)`)
        );

        const updateMode = await wizard.promptConfigUpdate(existingConfigs);
        if (updateMode === null) {
          console.log('\n👋 Setup cancelled');
          return;
        }
      }

      // Step 7: Configure MCP server
      console.log('\n⚙️  Configure MCP Server\n');
      await wizard.askConfigQuestions();

      console.log(wizard.formatMessage('success', 'Configuration complete'));

      // Step 8: Discover MCP servers from AI tools
      console.log('\n🔎 Discovering MCP servers...\n');
      const discoveryService = new MCPDiscoveryService();
      const aiToolServers = await discoveryService.discoverMCPServers(selectedTools);

      console.log(
        wizard.formatMessage('info', `Found ${aiToolServers.length} MCP server(s) from AI tools`)
      );

      // Step 8.1: Prompt for project-specific .mcp.json
      console.log('\n📂 Project-Specific MCP Configuration\n');
      const projectConfigPath = await wizard.promptForProjectMCPConfig();

      let projectServers: MCPServerConfig[] = [];
      if (projectConfigPath) {
        console.log(wizard.formatMessage('info', `Scanning ${projectConfigPath}...`));
        projectServers = await discoveryService.scanProjectConfig(projectConfigPath);

        if (projectServers.length > 0) {
          console.log(
            wizard.formatMessage('success', `Found ${projectServers.length} MCP server(s) in project config`)
          );
        } else {
          console.log(
            wizard.formatMessage('warning', 'No MCP servers found in project config')
          );
        }
      }

      // Step 8.2: Merge AI tool and project MCPs
      const discoveredServers = [...aiToolServers, ...projectServers];

      if (discoveredServers.length === 0) {
        console.log(
          wizard.formatMessage('warning', 'No MCP servers found. You can add them manually later.')
        );
        console.log('\n✅ Setup complete!\n');
        return;
      }

      console.log(
        wizard.formatMessage('success', `Total: ${discoveredServers.length} MCP server(s) discovered`)
      );

      // Step 9: Select MCP servers - convert MCPServerConfig to MCPServerStatusResult
      const serversWithStatus = discoveredServers.map(server => ({
        server,
        status: 'available' as const, // ServerStatus type
      }));

      const selectedServers = await wizard.selectMCPServers(serversWithStatus);
      if (selectedServers.length === 0) {
        console.log('\n⚠️  No servers selected');
        console.log('\n✅ Setup complete!\n');
        return;
      }

      // Step 10: Select wrapper languages
      console.log('\n🌐 Select Wrapper Languages\n');
      const languageSelections = await wizard.selectLanguagePerMCP(selectedServers);

      // Step 11: Prompt for wrapper regeneration (FR-8)
      const regenOption = await wizard.promptWrapperRegeneration();

      if (regenOption === 'skip') {
        console.log(wizard.formatMessage('info', 'Skipping wrapper generation'));
      } else {
        // Step 12: Generate wrappers (FR-7)
        console.log('\n📝 Generating wrappers...\n');
        const result = await wizard.generateWrappersWithProgress(
          languageSelections,
          'esm',
          regenOption === 'force' ? 'force' : 'missing'
        );

        // Show generated count
        if (result.succeeded.length > 0) {
          console.log(
            wizard.formatMessage('success', `Generated ${result.succeeded.length} wrapper(s)`)
          );
        }

        // Show skipped count
        if (result.skipped.length > 0) {
          console.log(
            wizard.formatMessage('info', `Skipped ${result.skipped.length} existing wrapper(s)`)
          );
        }

        // Show failed count
        if (result.failed.length > 0) {
          console.log(
            wizard.formatMessage('error', `${result.failed.length} wrapper(s) failed`)
          );
        }

        // Show summary if nothing happened
        if (result.succeeded.length === 0 && result.skipped.length === 0 && result.failed.length === 0) {
          console.log(wizard.formatMessage('info', 'No wrappers to generate'));
        }
      }

      // Step 13: Daily sync configuration (FR-6)
      console.log('\n📅 Daily Sync\n');
      const dailySyncConfig = await wizard.askDailySyncConfig();

      if (dailySyncConfig) {
        console.log(
          wizard.formatMessage('success', `Scheduled for ${dailySyncConfig.syncTime}`)
        );
      }

      // Step 14: Show completion
      console.log('\n✅ Setup complete!\n');
      console.log('Next steps:');
      console.log('  • Start server: npm run server');
      console.log('  • View docs: https://github.com/aberemia24/code-executor-MCP\n');

    } finally {
      // Always release lock
      await wizard.releaseLock();
    }

  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('cancelled')) {
        console.log('\n👋 Cancelled');
        process.exit(0);
      }

      console.error('\n❌ Error:', error.message);
      process.exit(1);
    }

    console.error('\n❌ Unknown error');
    process.exit(1);
  }
}

// Run
main().catch(error => {
  console.error('Fatal:', error);
  process.exit(1);
});
