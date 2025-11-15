#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

console.log('🧪 Testing outputSchema exposure with MCP SDK v1.22.0\n');

const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
});

const client = new Client({
  name: 'test-client-v122',
  version: '1.0.0',
}, {
  capabilities: {}
});

try {
  await client.connect(transport);
  console.log('✅ Connected to code-executor MCP server\n');

  // List all tools
  const toolsResponse = await client.listTools();
  console.log(`📋 Total tools exposed: ${toolsResponse.tools.length}\n`);

  // Check each tool for outputSchema
  console.log('=== OUTPUT SCHEMA VERIFICATION ===\n');

  for (const tool of toolsResponse.tools) {
    console.log(`📦 ${tool.name}`);
    console.log(`   Has inputSchema: ${tool.inputSchema ? '✅' : '❌'}`);
    console.log(`   Has outputSchema: ${tool.outputSchema ? '✅ YES! 🎉' : '❌ NO'}`);

    if (tool.outputSchema) {
      console.log(`   Output Schema:`);
      console.log(`      Type: ${tool.outputSchema.type || 'object'}`);
      if (tool.outputSchema.properties) {
        const fields = Object.keys(tool.outputSchema.properties);
        console.log(`      Fields (${fields.length}): ${fields.join(', ')}`);
      }
    }
    console.log('');
  }

  console.log('=== RESULT ===');
  const toolsWithOutputSchema = toolsResponse.tools.filter(t => t.outputSchema);
  console.log(`✅ Tools with outputSchema: ${toolsWithOutputSchema.length}/${toolsResponse.tools.length}`);

  if (toolsWithOutputSchema.length === toolsResponse.tools.length) {
    console.log('🎉 SUCCESS! All tools have outputSchema exposed in protocol!');
  } else {
    console.log('⚠️  Some tools missing outputSchema in protocol');
  }

  await client.close();
  process.exit(0);
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
