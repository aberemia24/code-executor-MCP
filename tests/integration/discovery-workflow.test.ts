/**
 * Integration Tests for Discovery + Execution Workflow
 *
 * US6 (FR-5): Discovery Function Timeout Fix
 * Tests verify that discovery functions can be used in a single sandbox call
 * to discover tools, inspect schemas, and execute tool calls.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { executeTypescriptInSandbox } from '../../src/sandbox-executor.js';
import { initConfig } from '../../src/config.js';
import type { MCPClientPool } from '../../src/mcp-client-pool.js';
import type { SandboxOptions } from '../../src/types.js';

describe('Discovery + Execution Workflow Integration (US6)', () => {
  let mockMCPClientPool: MCPClientPool;

  beforeAll(async () => {
    // Initialize configuration for sandbox execution
    await initConfig({});
  });

  beforeEach(() => {
    // Mock MCP Client Pool with realistic tool schemas and execution
    const toolSchemas = [
      {
        name: 'mcp__filesystem__read_file',
        description: 'Read file contents from disk',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to read' }
          },
          required: ['path'],
          additionalProperties: false
        }
      },
      {
        name: 'mcp__filesystem__write_file',
        description: 'Write file contents to disk',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to write' },
            content: { type: 'string', description: 'Content to write' }
          },
          required: ['path', 'content'],
          additionalProperties: false
        }
      },
      {
        name: 'mcp__zen__codereview',
        description: 'Perform code review analysis',
        inputSchema: {
          type: 'object',
          properties: {
            step: { type: 'string', description: 'Review step name' },
            step_number: { type: 'number', description: 'Step number' }
          },
          required: ['step', 'step_number'],
          additionalProperties: false
        }
      }
    ];

    mockMCPClientPool = {
      listAllTools: vi.fn().mockReturnValue(toolSchemas),
      listAllToolSchemas: vi.fn().mockResolvedValue(
        toolSchemas.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.inputSchema
        }))
      ),
      getToolSchema: vi.fn().mockImplementation((toolName) => {
        // Mock getToolSchema for SchemaCache.fetchAndCacheSchema()
        const tool = toolSchemas.find(t => t.name === toolName);
        if (!tool) return Promise.resolve(null);

        return Promise.resolve({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        });
      }),
      callTool: vi.fn().mockImplementation((toolName, params) => {
        // Mock tool execution based on tool name
        if (toolName === 'mcp__filesystem__read_file') {
          return Promise.resolve({
            content: `File contents from ${params.path}`
          });
        }
        if (toolName === 'mcp__filesystem__write_file') {
          return Promise.resolve({
            success: true,
            bytesWritten: params.content.length
          });
        }
        if (toolName === 'mcp__zen__codereview') {
          return Promise.resolve({
            analysis: `Review step "${params.step}" completed`
          });
        }
        return Promise.reject(new Error(`Unknown tool: ${toolName}`));
      }),
      getClient: vi.fn(),
      close: vi.fn()
    } as unknown as MCPClientPool;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * T065: Test discovery + execution workflow in single sandbox call
   *
   * ACCEPTANCE CRITERIA:
   * - Discover tools with discoverMCPTools()
   * - Inspect schema with getToolSchema()
   * - Execute tool with callMCPTool()
   * - All operations complete within single sandbox execution
   * - Variables persist across steps (no context switching)
   *
   * This tests the PRIMARY use case for discovery functions:
   * AI agents can explore, inspect, and execute tools without
   * manual documentation lookup.
   */
  it('should_discoverAndExecute_when_fullWorkflowRuns', async () => {
    const code = `
      // Step 1: Discover all available tools
      console.log('Step 1: Discovering tools...');
      const allTools = await discoverMCPTools();
      console.log(\`Found \${allTools.length} tools\`);

      // Verify we got tools
      if (allTools.length === 0) {
        throw new Error('Expected at least one tool from discovery');
      }

      // Step 2: Search for specific tools (file-related)
      console.log('Step 2: Searching for file tools...');
      const fileTools = await searchTools('file read write', 10);
      console.log(\`Found \${fileTools.length} file-related tools\`);

      // Verify search returned results
      if (fileTools.length === 0) {
        throw new Error('Expected file-related tools from search');
      }

      // Step 3: Inspect schema for specific tool
      console.log('Step 3: Inspecting read_file schema...');
      const readFileSchema = await getToolSchema('mcp__filesystem__read_file');

      if (!readFileSchema) {
        throw new Error('Expected schema for mcp__filesystem__read_file');
      }

      console.log(\`Tool: \${readFileSchema.name}\`);
      console.log(\`Description: \${readFileSchema.description}\`);

      // Verify schema has required properties
      if (!readFileSchema.parameters?.properties?.path) {
        throw new Error('Expected path parameter in schema');
      }

      // Step 4: Execute tool call using discovered schema
      console.log('Step 4: Executing tool call...');
      const result = await callMCPTool('mcp__filesystem__read_file', {
        path: '/test/file.txt'
      });

      console.log(\`Tool execution result: \${JSON.stringify(result)}\`);

      // Verify execution succeeded
      if (!result || typeof result !== 'object') {
        throw new Error('Expected object result from tool execution');
      }

      console.log('✓ Full workflow completed successfully');
    `;

    const options: SandboxOptions = {
      code,
      allowedTools: ['mcp__filesystem__read_file'], // Allow execution
      timeoutMs: 10000,
      permissions: { read: [], write: [], net: [] }
    };

    const result = await executeTypescriptInSandbox(options, mockMCPClientPool);

    // Verify execution succeeded
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify all workflow steps completed
    expect(result.output).toContain('Step 1: Discovering tools');
    expect(result.output).toContain('Step 2: Searching for file tools');
    expect(result.output).toContain('Step 3: Inspecting read_file schema');
    expect(result.output).toContain('Step 4: Executing tool call');
    expect(result.output).toContain('✓ Full workflow completed successfully');

    // Verify tool calls were made
    expect(mockMCPClientPool.listAllToolSchemas).toHaveBeenCalled();
    expect(mockMCPClientPool.callTool).toHaveBeenCalledWith(
      'mcp__filesystem__read_file',
      { path: '/test/file.txt' }
    );
  });

  /**
   * T065 (Edge Case): Test discovery without execution (allowlist bypass)
   *
   * ACCEPTANCE CRITERIA:
   * - Discovery functions bypass allowedTools allowlist (read-only metadata)
   * - Execution still enforces allowlist (two-tier security model)
   * - Agent can discover all tools, execute only allowed ones
   *
   * CONSTITUTIONAL ALIGNMENT (Principle 2: Security Zero Tolerance):
   * This intentional allowlist bypass for discovery is documented in
   * spec.md Section 2 (Constitutional Exceptions) as BY DESIGN.
   */
  it('should_allowDiscovery_when_toolNotInAllowlist', async () => {
    const code = `
      // Discovery should work even with empty allowlist
      console.log('Discovering tools with empty allowlist...');
      const allTools = await discoverMCPTools();
      console.log(\`Found \${allTools.length} tools (discovery bypasses allowlist)\`);

      // Verify we got tools despite empty allowlist
      if (allTools.length === 0) {
        throw new Error('Expected tools from discovery (allowlist bypass)');
      }

      // Try to execute non-allowed tool (should fail)
      console.log('Attempting to execute non-allowed tool...');
      try {
        await callMCPTool('mcp__zen__codereview', {
          step: 'Analysis',
          step_number: 1
        });
        throw new Error('Expected execution to fail (tool not in allowlist)');
      } catch (error) {
        console.log(\`✓ Execution blocked as expected: \${error.message}\`);
      }

      console.log('✓ Discovery bypass verified, execution allowlist enforced');
    `;

    const options: SandboxOptions = {
      code,
      allowedTools: [], // Empty allowlist
      timeoutMs: 10000,
      permissions: { read: [], write: [], net: [] }
    };

    const result = await executeTypescriptInSandbox(options, mockMCPClientPool);

    // Verify discovery succeeded but execution blocked
    expect(result.success).toBe(true);
    expect(result.output).toContain('discovery bypasses allowlist');
    expect(result.output).toContain('Execution blocked as expected');
    expect(result.output).toContain('✓ Discovery bypass verified');

    // Verify listAllToolSchemas was called (discovery)
    expect(mockMCPClientPool.listAllToolSchemas).toHaveBeenCalled();

    // Verify callTool was NOT called (execution blocked)
    expect(mockMCPClientPool.callTool).not.toHaveBeenCalled();
  });

  /**
   * T065 (Performance): Test discovery + execution completes fast
   *
   * ACCEPTANCE CRITERIA (NFR-2):
   * - Discovery: <500ms (per discovery timeout)
   * - Execution: <1000ms (typical tool call)
   * - Total workflow: <2000ms (acceptable for AI agent workflow)
   *
   * This verifies the performance benefit of progressive disclosure:
   * - No upfront context exhaustion (98% token reduction)
   * - Fast on-demand discovery (cached after first call)
   * - Acceptable latency for AI agent workflow
   */
  it('should_completeWithin2000ms_when_fullWorkflowRuns', async () => {
    const code = `
      const startTime = Date.now();

      // Full workflow: discover → search → inspect → execute
      const allTools = await discoverMCPTools();
      const fileTools = await searchTools('file', 5);
      const schema = await getToolSchema('mcp__filesystem__read_file');
      const result = await callMCPTool('mcp__filesystem__read_file', {
        path: '/test/file.txt'
      });

      const duration = Date.now() - startTime;
      console.log(\`Total workflow duration: \${duration}ms\`);

      if (duration > 2000) {
        throw new Error(\`Workflow too slow: \${duration}ms > 2000ms\`);
      }

      console.log('✓ Performance target met (<2000ms)');
    `;

    const options: SandboxOptions = {
      code,
      allowedTools: ['mcp__filesystem__read_file'],
      timeoutMs: 5000,
      permissions: { read: [], write: [], net: [] }
    };

    const result = await executeTypescriptInSandbox(options, mockMCPClientPool);

    // Verify performance target met
    expect(result.success).toBe(true);
    expect(result.output).toContain('Performance target met');

    // Extract duration from output
    const match = result.output?.match(/Total workflow duration: (\d+)ms/);
    if (match) {
      const duration = parseInt(match[1], 10);
      expect(duration).toBeLessThan(2000);
    }
  });

  /**
   * T065 (Error Handling): Test discovery errors are clear and actionable
   *
   * ACCEPTANCE CRITERIA:
   * - Discovery timeout shows clear error message
   * - Authentication failures show 401 with hint
   * - Rate limit errors show 429 with retry-after
   * - All errors include correlation context (what operation failed)
   *
   * FAIL-FAST (Constitutional Principle 7):
   * Errors must be descriptive and actionable, not silent failures.
   */
  it('should_showClearError_when_discoveryFails', async () => {
    // Mock discovery failure (simulate MCP proxy error)
    mockMCPClientPool.listAllToolSchemas = vi.fn().mockRejectedValue(
      new Error('MCP proxy unavailable')
    );

    const code = `
      try {
        await discoverMCPTools();
        throw new Error('Expected discovery to fail');
      } catch (error) {
        const errorMessage = error.message || String(error);
        console.log(\`Error caught: \${errorMessage}\`);

        // Verify error is descriptive
        if (!errorMessage.includes('MCP') && !errorMessage.includes('proxy')) {
          throw new Error(\`Expected descriptive error, got: \${errorMessage}\`);
        }

        console.log('✓ Error message is clear and actionable');
      }
    `;

    const options: SandboxOptions = {
      code,
      allowedTools: [],
      timeoutMs: 5000,
      permissions: { read: [], write: [], net: [] }
    };

    const result = await executeTypescriptInSandbox(options, mockMCPClientPool);

    // Verify error was caught and message is descriptive
    expect(result.success).toBe(true);
    expect(result.output).toContain('Error caught');
    expect(result.output).toContain('✓ Error message is clear and actionable');
  });
});
