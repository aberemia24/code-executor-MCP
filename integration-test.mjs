#!/usr/bin/env node

/**
 * Integration Test for code-executor-mcp Phase 7 & 8
 *
 * Tests:
 * 1. MCP server starts and responds
 * 2. executeTypescript basic functionality
 * 3. Discovery functions (discoverMCPTools, getToolSchema, searchTools)
 * 4. AJV error formatter with invalid params
 * 5. callMCPTool integration
 */

import { spawn } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const TESTS = [];
const RESULTS = { passed: 0, failed: 0, errors: [] };

function test(name, fn) {
  TESTS.push({ name, fn });
}

async function runTests() {
  console.log('🚀 Starting code-executor-mcp Integration Tests\n');

  // Start MCP server
  console.log('📡 Starting MCP server...');
  const serverProcess = spawn('node', ['dist/index.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MCP_CONFIG_PATH: '/tmp/test-mcp-config.json',
      NODE_ENV: 'test'
    }
  });

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: {
      MCP_CONFIG_PATH: '/tmp/test-mcp-config.json',
      NODE_ENV: 'test'
    }
  });

  const client = new Client({
    name: 'integration-test-client',
    version: '1.0.0'
  }, {
    capabilities: {}
  });

  try {
    await client.connect(transport);
    console.log('✅ MCP server connected\n');

    // Run all tests
    for (const { name, fn } of TESTS) {
      try {
        console.log(`🧪 Test: ${name}`);
        await fn(client);
        console.log(`✅ PASS: ${name}\n`);
        RESULTS.passed++;
      } catch (error) {
        console.log(`❌ FAIL: ${name}`);
        console.log(`   Error: ${error.message}\n`);
        RESULTS.failed++;
        RESULTS.errors.push({ test: name, error: error.message });
      }
    }

  } catch (error) {
    console.error('❌ Failed to connect to MCP server:', error);
    process.exit(1);
  } finally {
    await client.close();
    serverProcess.kill();
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Results Summary');
  console.log('='.repeat(60));
  console.log(`✅ Passed: ${RESULTS.passed}`);
  console.log(`❌ Failed: ${RESULTS.failed}`);
  console.log(`📈 Total:  ${RESULTS.passed + RESULTS.failed}`);
  console.log(`🎯 Success Rate: ${Math.round(RESULTS.passed / (RESULTS.passed + RESULTS.failed) * 100)}%`);

  if (RESULTS.failed > 0) {
    console.log('\n❌ Failed Tests:');
    RESULTS.errors.forEach(({ test, error }) => {
      console.log(`  - ${test}: ${error}`);
    });
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  }
}

// Test 1: List tools
test('MCP server exposes 3 tools', async (client) => {
  const { tools } = await client.listTools();
  if (tools.length !== 3) {
    throw new Error(`Expected 3 tools, got ${tools.length}`);
  }
  const toolNames = tools.map(t => t.name);
  const expected = ['executeTypescript', 'executePython', 'health'];
  for (const name of expected) {
    if (!toolNames.includes(name)) {
      throw new Error(`Missing tool: ${name}`);
    }
  }
});

// Test 2: Basic executeTypescript
test('executeTypescript executes simple code', async (client) => {
  const result = await client.callTool({
    name: 'executeTypescript',
    arguments: {
      code: 'console.log("Hello from integration test!"); return { success: true };',
      allowedTools: [],
      timeoutMs: 5000
    }
  });

  if (!result.content || result.content.length === 0) {
    throw new Error('No result content');
  }

  const output = JSON.parse(result.content[0].text);
  if (!output.success) {
    throw new Error('Execution failed');
  }
  if (!output.output.includes('Hello from integration test!')) {
    throw new Error('Missing console output');
  }
});

// Test 3: Discovery functions - discoverMCPTools
test('discoverMCPTools returns tool list', async (client) => {
  const result = await client.callTool({
    name: 'executeTypescript',
    arguments: {
      code: `
        const tools = await discoverMCPTools();
        console.log('Found tools:', tools.length);
        return { toolCount: tools.length, tools };
      `,
      allowedTools: [],
      timeoutMs: 10000
    }
  });

  const output = JSON.parse(result.content[0].text);
  if (!output.success) {
    throw new Error(`Execution failed: ${output.error}`);
  }

  const data = JSON.parse(output.output.match(/return value: (.*)/)[1]);
  if (!data.toolCount || data.toolCount === 0) {
    throw new Error('No tools discovered');
  }
  console.log(`   📋 Discovered ${data.toolCount} MCP tools`);
});

// Test 4: Discovery functions - searchTools
test('searchTools filters by keyword', async (client) => {
  const result = await client.callTool({
    name: 'executeTypescript',
    arguments: {
      code: `
        const allTools = await discoverMCPTools();
        const fileTools = await searchTools('file', 5);
        console.log('All tools:', allTools.length);
        console.log('File tools:', fileTools.length);
        return { total: allTools.length, filtered: fileTools.length };
      `,
      allowedTools: [],
      timeoutMs: 10000
    }
  });

  const output = JSON.parse(result.content[0].text);
  if (!output.success) {
    throw new Error(`Execution failed: ${output.error}`);
  }

  const data = JSON.parse(output.output.match(/return value: (.*)/)[1]);
  console.log(`   🔍 Total: ${data.total}, Filtered: ${data.filtered}`);
  if (data.filtered > data.total) {
    throw new Error('Filtered count exceeds total');
  }
});

// Test 5: Discovery functions - getToolSchema
test('getToolSchema returns schema for specific tool', async (client) => {
  const result = await client.callTool({
    name: 'executeTypescript',
    arguments: {
      code: `
        const schema = await getToolSchema('mcp__filesystem__read_file');
        console.log('Schema found:', schema ? 'yes' : 'no');
        return { hasSchema: !!schema, toolName: schema?.name };
      `,
      allowedTools: ['mcp__filesystem__read_file'],
      timeoutMs: 10000
    }
  });

  const output = JSON.parse(result.content[0].text);
  if (!output.success) {
    throw new Error(`Execution failed: ${output.error}`);
  }

  const data = JSON.parse(output.output.match(/return value: (.*)/)[1]);
  if (!data.hasSchema) {
    throw new Error('Schema not found');
  }
  console.log(`   📄 Schema retrieved for: ${data.toolName}`);
});

// Test 6: AJV Error Formatter - Invalid params should give user-friendly error
test('AJV error formatter provides user-friendly errors', async (client) => {
  try {
    await client.callTool({
      name: 'executeTypescript',
      arguments: {
        code: 'return 42;',
        allowedTools: [],
        timeoutMs: 'invalid'  // Should be number, not string
      }
    });
    throw new Error('Should have thrown validation error');
  } catch (error) {
    // Expected to fail with validation error
    if (!error.message.includes('timeoutMs') || !error.message.includes('number')) {
      throw new Error(`Expected user-friendly error, got: ${error.message}`);
    }
    console.log(`   💬 User-friendly error received`);
  }
});

// Test 7: callMCPTool integration (if filesystem tool available)
test('callMCPTool executes allowed tools', async (client) => {
  const result = await client.callTool({
    name: 'executeTypescript',
    arguments: {
      code: `
        // List files in /tmp
        const result = await callMCPTool('mcp__filesystem__list_directory', {
          path: '/tmp'
        });
        console.log('Tool call result:', result ? 'success' : 'failed');
        return { executed: true, hasResult: !!result };
      `,
      allowedTools: ['mcp__filesystem__list_directory'],
      timeoutMs: 10000
    }
  });

  const output = JSON.parse(result.content[0].text);
  if (!output.success) {
    throw new Error(`Execution failed: ${output.error}`);
  }

  const data = JSON.parse(output.output.match(/return value: (.*)/)[1]);
  if (!data.executed || !data.hasResult) {
    throw new Error('callMCPTool did not execute successfully');
  }
  console.log(`   🔧 MCP tool executed successfully`);
});

// Test 8: Health check tool
test('health tool returns system info', async (client) => {
  const result = await client.callTool({
    name: 'health',
    arguments: {}
  });

  if (!result.content || result.content.length === 0) {
    throw new Error('No health check result');
  }

  const health = JSON.parse(result.content[0].text);
  if (!health.healthy) {
    throw new Error('Server reports unhealthy');
  }
  console.log(`   ❤️  Server healthy, uptime: ${health.uptime}s`);
});

// Run all tests
runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
