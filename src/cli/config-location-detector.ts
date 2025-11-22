/**
 * MCP Config Location Detector
 *
 * Detects where to write MCP server configuration based on:
 * 1. Which AI tool is installed (Claude Desktop, Cursor, etc.)
 * 2. Operating system (Mac, Linux, Windows)
 * 3. Whether config file already exists
 *
 * **PRIORITY:**
 * 1. Existing config file (preserve existing setup)
 * 2. Detected AI tool's standard location
 * 3. Fallback to ~/.mcp/config.json
 */

import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';

export interface MCPConfigLocation {
  /** Absolute path to config file */
  path: string;
  /** Which AI tool this config is for */
  tool: 'claude-code' | 'claude-desktop' | 'cursor' | 'windsurf' | 'generic';
  /** Whether file already exists */
  exists: boolean;
  /** Whether this is the recommended location */
  recommended: boolean;
}

/**
 * Get MCP config file locations for current platform
 */
export function getMCPConfigLocations(): {
  claudeCode: string;
  claudeDesktop: string;
  cursor: string;
  windsurf: string;
  generic: string;
} {
  const homeDir = os.homedir();
  const platform = process.platform;

  // Claude Code (CLI tool) - SINGLE FILE, not directory
  // This is for global installation: npx code-executor-mcp
  const claudeCode = path.join(homeDir, '.claude.json');

  // Claude Desktop locations (GUI application)
  let claudeDesktop: string;
  if (platform === 'darwin') {
    claudeDesktop = path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
    claudeDesktop = path.join(appData, 'Claude', 'claude_desktop_config.json');
  } else {
    // Linux
    claudeDesktop = path.join(homeDir, '.config', 'Claude', 'claude_desktop_config.json');
  }

  // Cursor (cross-platform)
  const cursor = path.join(homeDir, '.cursor', 'mcp.json');

  // Windsurf (cross-platform)
  const windsurf = path.join(homeDir, '.windsurf', 'mcp.json');

  // Generic fallback
  const generic = path.join(homeDir, '.mcp', 'config.json');

  return { claudeCode, claudeDesktop, cursor, windsurf, generic };
}

/**
 * Detect which MCP config file to use
 *
 * Priority:
 * 1. If Claude Code config exists (~/.claude.json) → use it (MOST COMMON for global install)
 * 2. If Claude Desktop config exists → use it
 * 3. If Cursor config exists → use it
 * 4. If Windsurf config exists → use it
 * 5. If none exist → CREATE ~/.claude.json (default for global install)
 */
export async function detectMCPConfigLocation(): Promise<MCPConfigLocation> {
  const locations = getMCPConfigLocations();

  // Check which config files exist (priority order)
  const existingConfigs = await Promise.all([
    fileExists(locations.claudeCode).then(exists => ({
      path: locations.claudeCode,
      tool: 'claude-code' as const,
      exists
    })),
    fileExists(locations.claudeDesktop).then(exists => ({
      path: locations.claudeDesktop,
      tool: 'claude-desktop' as const,
      exists
    })),
    fileExists(locations.cursor).then(exists => ({
      path: locations.cursor,
      tool: 'cursor' as const,
      exists
    })),
    fileExists(locations.windsurf).then(exists => ({
      path: locations.windsurf,
      tool: 'windsurf' as const,
      exists
    }))
  ]);

  // Priority 1-4: Use existing config
  for (const config of existingConfigs) {
    if (config.exists) {
      return { ...config, recommended: true };
    }
  }

  // Priority 5: No existing config found
  // Default to ~/.claude.json (most common for global installation)
  return {
    path: locations.claudeCode,
    tool: 'claude-code',
    exists: false,
    recommended: true
  };
}

/**
 * Get all potential config locations with their status
 *
 * Useful for displaying to user which configs exist
 */
export async function getAllMCPConfigLocations(): Promise<MCPConfigLocation[]> {
  const locations = getMCPConfigLocations();

  return await Promise.all([
    fileExists(locations.claudeCode).then(exists => ({
      path: locations.claudeCode,
      tool: 'claude-code' as const,
      exists,
      recommended: true
    })),
    fileExists(locations.claudeDesktop).then(exists => ({
      path: locations.claudeDesktop,
      tool: 'claude-desktop' as const,
      exists,
      recommended: true
    })),
    fileExists(locations.cursor).then(exists => ({
      path: locations.cursor,
      tool: 'cursor' as const,
      exists,
      recommended: true
    })),
    fileExists(locations.windsurf).then(exists => ({
      path: locations.windsurf,
      tool: 'windsurf' as const,
      exists,
      recommended: true
    })),
    fileExists(locations.generic).then(exists => ({
      path: locations.generic,
      tool: 'generic' as const,
      exists,
      recommended: false
    }))
  ]);
}

/**
 * Check if file or directory exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get friendly name for tool
 */
export function getToolDisplayName(tool: MCPConfigLocation['tool']): string {
  const names = {
    'claude-code': 'Claude Code (CLI)',
    'claude-desktop': 'Claude Desktop (GUI)',
    'cursor': 'Cursor',
    'windsurf': 'Windsurf',
    'generic': 'Generic MCP Client'
  };
  return names[tool];
}

/**
 * Ensure directory exists for config file
 */
export async function ensureConfigDirectory(configPath: string): Promise<void> {
  const dir = path.dirname(configPath);
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Read existing MCP config or return empty structure
 */
export async function readOrCreateMCPConfig(configPath: string): Promise<{
  mcpServers: Record<string, unknown>;
}> {
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);

    // Ensure mcpServers object exists
    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
      config.mcpServers = {};
    }

    return config;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // File doesn't exist - return empty config
      return { mcpServers: {} };
    }
    throw error; // Re-throw other errors (invalid JSON, etc.)
  }
}

/**
 * Write MCP config with backup
 */
export async function writeMCPConfig(
  configPath: string,
  config: { mcpServers: Record<string, unknown> },
  options: { createBackup?: boolean } = {}
): Promise<void> {
  const { createBackup = true } = options;

  // Ensure directory exists
  await ensureConfigDirectory(configPath);

  // Create backup if file exists
  if (createBackup && await fileExists(configPath)) {
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const backupPath = `${configPath}.backup.${timestamp}`;
    await fs.copyFile(configPath, backupPath);
    console.log(`📁 Backup created: ${backupPath}`);
  }

  // Write new config
  await fs.writeFile(
    configPath,
    JSON.stringify(config, null, 2),
    'utf-8'
  );
}
