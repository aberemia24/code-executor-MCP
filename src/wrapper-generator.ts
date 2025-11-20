/**
 * Wrapper Generator
 *
 * Auto-generates TypeScript wrappers for MCP tools by querying server schemas.
 * Wrappers provide ergonomic APIs with sensible defaults and state management.
 *
 * Output: ~/.code-executor/wrappers/<server>.ts (gitignored)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getMCPConfigPath } from './config.js';
import { Ajv, type ErrorObject } from 'ajv';

const WRAPPERS_DIR = path.join(homedir(), '.code-executor', 'wrappers');

// AJV schema for validating MCP tool schemas (Type Safety: Deep recursive validation)
const MCP_TOOL_SCHEMA_VALIDATOR = {
  type: 'array',
  items: {
    type: 'object',
    required: ['name', 'inputSchema'],
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      inputSchema: {
        type: 'object',
        required: ['type'],
        properties: {
          type: {
            type: 'string',
            enum: ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']
          },
          properties: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              properties: {
                type: {
                  oneOf: [
                    { type: 'string' },
                    { type: 'array', items: { type: 'string' } }
                  ]
                },
                description: { type: 'string' },
                enum: { type: 'array' },
                items: { type: 'object' },
                properties: { type: 'object' }
              }
            }
          },
          required: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      }
    }
  }
} as const;

interface MCPToolSchema {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

interface ServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Generate wrapper function code for a single MCP tool
 */
function generateWrapperFunction(serverName: string, tool: MCPToolSchema): string {
  const toolName = tool.name;
  const fullToolName = `mcp__${serverName}__${toolName}`;
  const functionName = toCamelCase(toolName);

  const properties = tool.inputSchema.properties || {};
  const required = tool.inputSchema.required || [];
  const optional = Object.keys(properties).filter(k => !required.includes(k));

  // Generate function signature
  const params: string[] = [];
  const paramDocs: string[] = [];

  // Required params as function arguments
  for (const param of required) {
    const prop = properties[param];
    const type = inferTypeScriptType(prop);
    params.push(`${param}: ${type}`);
    paramDocs.push(`   * @param ${param} ${prop.description || ''}`);
  }

  // Optional params in options object
  if (optional.length > 0) {
    params.push(`options: Partial<{${optional.map(p => `${p}: ${inferTypeScriptType(properties[p])}`).join(', ')}}> = {}`);
    paramDocs.push(`   * @param options Optional parameters: ${optional.join(', ')}`);
  }


  // Only spread options if there are optional parameters
  const optionsSpread = optional.length > 0 ? '\n    ...options' : '';

  return `
/**
 * ${tool.description || toolName}
${paramDocs.join('\n')}
 */
export async function ${functionName}(${params.join(', ')}): Promise<any> {
  const params = {
    ${required.map(p => `${p},`).join('\n    ')}${optionsSpread}
  };

  return await callMCPTool('${fullToolName}', params);
}
`;
}

/**
 * Infer TypeScript type from JSON Schema property
 */
function inferTypeScriptType(prop: any): string {
  if (!prop) return 'any';

  const type = prop.type;

  if (Array.isArray(type)) {
    return type.map((t: string) => inferTypeFromString(t)).join(' | ');
  }

  if (type === 'array') {
    const items = prop.items;
    if (items) {
      return `${inferTypeScriptType(items)}[]`;
    }
    return 'any[]';
  }

  if (type === 'object') {
    return 'Record<string, any>';
  }

  return inferTypeFromString(type);
}

function inferTypeFromString(type: string): string {
  switch (type) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'integer': return 'number';
    case 'boolean': return 'boolean';
    case 'null': return 'null';
    default: return 'any';
  }
}

/**
 * Convert tool name to camelCase function name
 */
function toCamelCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((word, index) => {
      if (index === 0) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join('');
}

/**
 * Connect to MCP server and fetch tool schemas
 */
async function fetchToolSchemas(serverName: string, config: ServerConfig): Promise<MCPToolSchema[]> {
  const client = new Client({
    name: 'code-executor-wrapper-generator',
    version: '1.0.0',
  }, {
    capabilities: {},
  });

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args || [],
    env: config.env ? {
      ...(process.env as Record<string, string>),
      ...config.env,
    } : process.env as Record<string, string>,
  });

  try {
    await client.connect(transport);
    const response = await client.listTools();

    // AJV validation: Ensure tool schemas match expected structure
    const ajv = new Ajv({ strict: false }); // strict: false to allow additionalProperties
    const validate = ajv.compile(MCP_TOOL_SCHEMA_VALIDATOR);

    if (!validate(response.tools)) {
      const errors = validate.errors || [];
      const errorDetails = errors.map((e: ErrorObject) => `${e.instancePath} ${e.message}`).join(', ');
      throw new Error(`Invalid tool schemas from ${serverName}: ${errorDetails}`);
    }

    return response.tools as MCPToolSchema[];
  } catch (error) {
    console.error(`Failed to fetch schemas from ${serverName}:`, error);
    return [];
  } finally {
    await client.close();
  }
}

/**
 * Generate wrapper file for a single MCP server
 */
async function generateServerWrapper(serverName: string, config: ServerConfig): Promise<void> {
  console.log(`Generating wrappers for ${serverName}...`);

  const tools = await fetchToolSchemas(serverName, config);

  if (tools.length === 0) {
    console.log(`  No tools found for ${serverName}, skipping`);
    return;
  }

  // Generate wrapper code
  const wrappers = tools.map(tool => generateWrapperFunction(serverName, tool));

  const fileContent = `/**
 * Auto-generated wrappers for ${serverName} MCP server
 * Generated: ${new Date().toISOString()}
 *
 * DO NOT EDIT - Regenerate with: code-executor-mcp generate-wrappers
 */

// These functions are injected into the sandbox when ${serverName} tools are allowed
// They provide ergonomic APIs with state management and sensible defaults

declare global {
  function callMCPTool(toolName: string, params: any): Promise<any>;
}

${wrappers.join('\n')}

// Export all wrappers
export default {
  ${tools.map(t => toCamelCase(t.name)).join(',\n  ')}
};
`;

  // Write to file
  const filePath = path.join(WRAPPERS_DIR, `${serverName}.ts`);
  await fs.writeFile(filePath, fileContent, 'utf-8');

  console.log(`  ✓ Generated ${tools.length} wrappers → ${filePath}`);
}

/**
 * Generate wrappers for all MCP servers in config
 */
export async function generateAllWrappers(configPath?: string): Promise<void> {
  console.log('🔧 Generating MCP tool wrappers...\n');

  // Create wrappers directory
  await fs.mkdir(WRAPPERS_DIR, { recursive: true });

  // Load MCP config
  const mcpConfigPath = configPath || await getMCPConfigPath();
  const configContent = await fs.readFile(mcpConfigPath, 'utf-8');
  const config = JSON.parse(configContent) as {
    mcpServers?: Record<string, any>;
  };

  if (!config?.mcpServers) {
    console.error('No MCP servers found in config');
    return;
  }

  // Generate wrappers for each server
  const servers = Object.entries(config.mcpServers);

  for (const [serverName, serverConfig] of servers) {
    // Skip HTTP-based servers (no stdio connection)
    if (typeof serverConfig === 'object' && serverConfig !== null &&
        'type' in serverConfig && serverConfig.type === 'http') {
      console.log(`Skipping ${serverName} (HTTP server)`);
      continue;
    }

    try {
      await generateServerWrapper(serverName, serverConfig as ServerConfig);
    } catch (error) {
      console.error(`Failed to generate wrappers for ${serverName}:`, error);
    }
  }

  // Generate index file
  const indexContent = `/**
 * Auto-generated wrapper index
 * Generated: ${new Date().toISOString()}
 */

${servers
  .filter(([_, cfg]) => {
    return typeof cfg === 'object' && cfg !== null &&
           (!('type' in cfg) || cfg.type !== 'http');
  })
  .map(([name]) => `export * from './${name}.js';`)
  .join('\n')}
`;

  await fs.writeFile(path.join(WRAPPERS_DIR, 'index.ts'), indexContent, 'utf-8');

  console.log('\n✅ Wrapper generation complete!');
  console.log(`📁 Wrappers saved to: ${WRAPPERS_DIR}`);
  console.log('💡 These will be auto-injected based on allowedTools parameter');
}

/**
 * CLI entry point
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  generateAllWrappers(process.argv[2])
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}
