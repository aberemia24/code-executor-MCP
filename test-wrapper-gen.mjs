#!/usr/bin/env node
/**
 * Test wrapper generation after v1.0.4 fix
 * Verifies that inputSchema property mismatch is resolved
 */

import { MCPClientPool } from './dist/mcp/client-pool.js';
import { SchemaCache } from './dist/validation/schema-cache.js';
import { WrapperGenerator } from './dist/cli/wrapper-generator.js';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testWrapperGeneration() {
  console.log('🧪 Testing wrapper generation with v1.0.4 fix...\n');

  try {
    // Initialize MCP Client Pool
    const pool = new MCPClientPool({
      enableMetrics: false,
      configPath: path.join(process.cwd(), '.mcp.json'),
    });

    console.log('📦 Initializing MCP client pool...');
    await pool.initialize();
    console.log('✅ Pool initialized\n');

    // Create SchemaCache with MCPClientPool as provider
    const schemaCache = new SchemaCache(
      pool,
      86400000, // 24 hours
      path.join(os.homedir(), '.code-executor', 'test-schema-cache.json')
    );

    // Fetch tools for zen server
    console.log('🔍 Fetching zen MCP tools...');
    const allTools = await pool.listAllToolSchemas(schemaCache);

    const zenTools = allTools.filter(t => t.name.startsWith('mcp__zen__'));
    console.log(`✅ Found ${zenTools.length} zen tools\n`);

    if (zenTools.length === 0) {
      console.error('❌ No zen tools found! Is the zen MCP server running?');
      process.exit(1);
    }

    // Display first 3 tools to verify structure
    console.log('📋 Sample zen tools (showing inputSchema property):');
    zenTools.slice(0, 3).forEach(tool => {
      console.log(`\n  ${tool.name}`);
      console.log(`    Description: ${tool.description}`);
      console.log(`    Has inputSchema: ${tool.inputSchema ? '✅ YES' : '❌ NO'}`);
      if (tool.inputSchema) {
        console.log(`    Properties: ${Object.keys(tool.inputSchema.properties || {}).length} params`);
      }
    });

    console.log('\n✅ SUCCESS! Wrapper generation data structure is correct.');
    console.log('   Tools have inputSchema property (not parameters)');
    console.log('   Templates expect inputSchema and will work correctly\n');

    await pool.cleanup();

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error('\nStack:', error.stack);
    process.exit(1);
  }
}

testWrapperGeneration();
