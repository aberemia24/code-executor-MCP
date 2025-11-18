/**
 * MCPDiscoveryService - Discover MCP servers from AI tool configurations
 *
 * **RESPONSIBILITY (SRP):** Scan .mcp.json files and extract MCP server configurations
 * **WHY:** Centralized MCP discovery separates config parsing from UI/business logic
 */

import * as fs from 'node:fs/promises';
import { exec } from 'node:child_process';
import type { AIToolMetadata } from './tool-registry.js';
import type { MCPServerConfig, MCPConfig, MCPServerStatusResult } from './types.js';

/**
 * MCPDiscoveryService - Scan AI tool configs for MCP servers
 *
 * **DESIGN:** Parallel scanning using Promise.all for performance
 * **ERROR HANDLING:** Graceful degradation (skip failed scans, continue with others)
 */
export class MCPDiscoveryService {
  /**
   * Scan a single AI tool's config file for MCP servers
   *
   * **ERROR HANDLING:** Returns empty array on failure (file not found, invalid JSON, etc.)
   * **VALIDATION:** Skips servers without required 'command' field
   *
   * @param tool - AI tool metadata with config path
   * @returns Array of discovered MCP server configurations
   */
  async scanToolConfig(tool: AIToolMetadata): Promise<MCPServerConfig[]> {
    try {
      // Get platform-specific config path
      const configPath = this.getConfigPath(tool, process.platform as 'linux' | 'darwin' | 'win32');

      // Read and parse config file
      let configContent: string;
      try {
        configContent = await fs.readFile(configPath, 'utf-8');
      } catch (error) {
        // File not found or permission denied
        console.error(`Failed to read config file at ${configPath}:`, error);
        return [];
      }

      // Parse JSON with error context
      let config: MCPConfig;
      try {
        config = JSON.parse(configContent);
      } catch (error) {
        // Invalid JSON
        console.error(`Failed to parse MCP config at ${configPath}:`, error);
        return [];
      }

      // Validate mcpServers key exists
      if (!config.mcpServers || typeof config.mcpServers !== 'object') {
        return [];
      }

      // Extract server configurations
      const servers: MCPServerConfig[] = [];
      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        // Validate required command field
        if (!serverConfig.command) {
          console.warn(`Skipping MCP server '${name}' in ${configPath}: missing 'command' field`);
          continue; // Skip invalid server
        }

        servers.push({
          name,
          command: serverConfig.command,
          args: serverConfig.args || [],
          env: serverConfig.env,
          sourceTool: tool.id,
        });
      }

      return servers;
    } catch (error) {
      // Unexpected error (shouldn't reach here with nested try-catch above)
      console.error(`Unexpected error scanning tool config for ${tool.id}:`, error);
      return [];
    }
  }

  /**
   * Discover MCP servers from multiple AI tool configurations
   *
   * **PARALLEL:** Uses Promise.all for concurrent scanning (O(1) amortized)
   * **RESILIENT:** Partial failures don't block other scans
   *
   * @param tools - Array of AI tools to scan
   * @returns Merged array of all discovered MCP servers
   */
  async discoverMCPServers(tools: AIToolMetadata[]): Promise<MCPServerConfig[]> {
    // Parallel scanning using Promise.all
    const scanPromises = tools.map(tool => this.scanToolConfig(tool));
    const results = await Promise.all(scanPromises);

    // Merge results (flatten array of arrays)
    return results.flat();
  }

  /**
   * Get platform-specific config path for a tool
   *
   * **WHY:** Different platforms store configs in different locations
   * **VALIDATION:** Throws if platform path not defined
   *
   * @param tool - AI tool metadata
   * @param platform - Platform identifier (linux, darwin, win32)
   * @returns Absolute path to .mcp.json file
   * @throws Error if platform path not defined
   */
  getConfigPath(tool: AIToolMetadata, platform: 'linux' | 'darwin' | 'win32'): string {
    const path = tool.configPaths[platform];
    if (!path) {
      throw new Error(
        `No config path defined for tool '${tool.id}' on platform '${platform}'. ` +
        `Available platforms: ${Object.keys(tool.configPaths).join(', ')}`
      );
    }
    return path;
  }

  /**
   * Validate if an MCP server's command is available on the system
   *
   * **METHOD:** Uses 'which' (Linux/macOS) or 'where' (Windows) to check command existence
   * **STATUS:** Returns 'available' if command found, 'unavailable' if not found
   *
   * @param server - MCP server configuration to validate
   * @returns Server status result with availability information
   */
  async pingServer(server: MCPServerConfig): Promise<MCPServerStatusResult> {
    return new Promise((resolve) => {
      // Determine command checker based on platform
      const isWindows = process.platform === 'win32';
      const checkCommand = isWindows ? 'where' : 'which';

      // Execute command checker
      exec(`${checkCommand} ${server.command}`, (error, stdout, _stderr) => {
        if (error) {
          // Command not found or execution error
          resolve({
            server,
            status: 'unavailable',
            message: `Command '${server.command}' not found or not executable: ${error.message}`,
          });
        } else {
          // Command found - return available status
          resolve({
            server,
            status: 'available',
            message: `Command '${server.command}' found at: ${stdout.trim()}`,
          });
        }
      });
    });
  }

  /**
   * Validate multiple MCP servers in parallel
   *
   * **PARALLEL:** Uses Promise.all for concurrent validation (O(1) amortized)
   * **PERFORMANCE:** All checks run simultaneously, total time = slowest check
   *
   * @param servers - Array of MCP servers to validate
   * @returns Array of server status results (same order as input)
   */
  async pingAllServers(servers: MCPServerConfig[]): Promise<MCPServerStatusResult[]> {
    // Parallel validation using Promise.all
    const pingPromises = servers.map(server => this.pingServer(server));
    return Promise.all(pingPromises);
  }
}
