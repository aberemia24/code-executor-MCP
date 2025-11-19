/**
 * AI Tool Registry - Platform-specific configuration paths for AI development tools
 *
 * **RESPONSIBILITY (SRP):** Maintain catalog of AI tool metadata (pure data, no logic)
 * **WHY:** Centralized registry enables easy addition of new tools without modifying detection logic
 * **DESIGN:** Path resolution moved to ToolDetector (SRP separation)
 */

/**
 * AI development tool metadata
 */
export interface AIToolMetadata {
  /** Unique tool identifier */
  id: string;
  /** Display name */
  name: string;
  /** Brief description */
  description: string;
  /** Platform-specific config file paths (absolute) */
  configPaths: {
    linux?: string;
    darwin?: string;
    win32?: string;
  };
  /** Official website URL */
  website: string;
}

/**
 * NOTE: Path resolution moved to ToolDetector (SRP - registry is pure data)
 * See: src/cli/tool-detector.ts::resolveConfigPath()
 */

/**
 * AI Tool Registry - Comprehensive list of supported AI development tools
 *
 * **MAINTAINABILITY:** Add new tools here without modifying detection logic
 */
export const AI_TOOL_REGISTRY: readonly AIToolMetadata[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Anthropic\'s official CLI for Claude',
    configPaths: {
      linux: '~/.claude.json',
      darwin: '~/.claude.json',
      win32: '%USERPROFILE%\\.claude.json',
    },
    website: 'https://code.claude.com',
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    description: 'OpenAI\'s code generation tool',
    configPaths: {
      linux: '~/.codex/config.json',
      darwin: '~/Library/Application Support/Codex/config.json',
      win32: '%APPDATA%\\Codex\\config.json',
    },
    website: 'https://openai.com/codex',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    description: 'AI-powered development assistant',
    configPaths: {
      linux: '~/.windsurf/config.json',
      darwin: '~/Library/Application Support/Windsurf/config.json',
      win32: '%APPDATA%\\Windsurf\\config.json',
    },
    website: 'https://windsurf.ai',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    description: 'AI-first code editor',
    configPaths: {
      linux: '~/.cursor/mcp.json',
      darwin: '~/.cursor/mcp.json',
      win32: '%USERPROFILE%\\.cursor\\mcp.json',
    },
    website: 'https://cursor.sh',
  },
  {
    id: 'kilo-code',
    name: 'Kilo Code',
    description: 'Lightweight AI coding assistant',
    configPaths: {
      linux: '~/.kilocode/config.json',
      darwin: '~/Library/Application Support/KiloCode/config.json',
      win32: '%APPDATA%\\KiloCode\\config.json',
    },
    website: 'https://kilocode.dev',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description: 'Open-source AI code completion',
    configPaths: {
      linux: '~/.opencode/config.json',
      darwin: '~/Library/Application Support/OpenCode/config.json',
      win32: '%APPDATA%\\OpenCode\\config.json',
    },
    website: 'https://opencode.dev',
  },
] as const;

/**
 * Get tool metadata by ID
 * @param toolId Tool identifier
 * @returns Tool metadata or undefined if not found
 */
export function getToolById(toolId: string): AIToolMetadata | undefined {
  return AI_TOOL_REGISTRY.find(tool => tool.id === toolId);
}

/**
 * Get all supported tools for current platform
 * @returns Array of tools with config paths defined for current platform
 */
export function getSupportedToolsForPlatform(): readonly AIToolMetadata[] {
  const platform = process.platform as 'linux' | 'darwin' | 'win32';
  return AI_TOOL_REGISTRY.filter(tool => tool.configPaths[platform] !== undefined);
}
