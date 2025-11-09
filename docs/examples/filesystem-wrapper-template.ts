/**
 * Filesystem MCP Wrapper Template
 *
 * ⚠️ COPY THIS FILE TO YOUR PROJECT - DO NOT IMPORT FROM THIS PACKAGE
 *
 * Why? MCP servers update independently. Copy this template and maintain
 * it when @modelcontextprotocol/server-filesystem updates.
 *
 * Usage:
 * 1. Copy this file to your project (e.g., src/lib/mcp/filesystem.ts)
 * 2. Install filesystem MCP in your .mcp.json
 * 3. Adapt parameters to match YOUR installed version
 * 4. Maintain it when the filesystem server updates
 *
 * Last verified: 2025-01-09 with @modelcontextprotocol/server-filesystem
 */

/**
 * Read file contents
 */
export async function readFile(path: string): Promise<string> {
  const result = await (globalThis as any).callMCPTool('mcp__filesystem__read_file', {
    path
  });
  return typeof result === 'string' ? result : result.content;
}

/**
 * Read multiple files
 */
export async function readMultipleFiles(paths: string[]): Promise<string[]> {
  const result = await (globalThis as any).callMCPTool('mcp__filesystem__read_multiple_files', {
    paths
  });
  return typeof result === 'string' ? JSON.parse(result) : result;
}

/**
 * Write file contents
 */
export async function writeFile(path: string, content: string): Promise<void> {
  await (globalThis as any).callMCPTool('mcp__filesystem__write_file', {
    path,
    content
  });
}

/**
 * Create directory
 */
export async function createDirectory(path: string): Promise<void> {
  await (globalThis as any).callMCPTool('mcp__filesystem__create_directory', {
    path
  });
}

/**
 * List directory contents
 */
export async function listDirectory(path: string): Promise<string[]> {
  const result = await (globalThis as any).callMCPTool('mcp__filesystem__list_directory', {
    path
  });
  return typeof result === 'string' ? JSON.parse(result) : result;
}

/**
 * Search for files by pattern
 */
export async function searchFiles(
  pattern: string,
  path?: string
): Promise<string[]> {
  const result = await (globalThis as any).callMCPTool('mcp__filesystem__search_files', {
    pattern,
    ...(path && { path })
  });
  return typeof result === 'string' ? JSON.parse(result) : result;
}

/**
 * Get file info
 */
export async function getFileInfo(path: string): Promise<{
  size: number;
  created: Date;
  modified: Date;
  isDirectory: boolean;
  isFile: boolean;
}> {
  const result = await (globalThis as any).callMCPTool('mcp__filesystem__get_file_info', {
    path
  });
  return typeof result === 'string' ? JSON.parse(result) : result;
}

/**
 * Move/rename file
 */
export async function moveFile(source: string, destination: string): Promise<void> {
  await (globalThis as any).callMCPTool('mcp__filesystem__move_file', {
    source,
    destination
  });
}

/**
 * Get directory tree
 */
export async function directoryTree(
  path: string,
  maxDepth?: number
): Promise<any> {
  const result = await (globalThis as any).callMCPTool('mcp__filesystem__directory_tree', {
    path,
    ...(maxDepth && { maxDepth })
  });
  return typeof result === 'string' ? JSON.parse(result) : result;
}

// Add more filesystem tool wrappers as needed...
