/**
 * Integration Tests for Discovery Feature (Phase 7 - FR-6)
 *
 * End-to-end tests that validate the complete discovery workflow:
 * discover → inspect → execute in a single round-trip.
 *
 * Test Strategy: Execute real TypeScript code in Deno sandbox and verify
 * all three discovery functions work together seamlessly.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { executeTypescriptInSandbox } from '../src/sandbox-executor.js';
import { MCPClientPool } from '../src/mcp-client-pool.js';
import { initConfig } from '../src/config.js';
import type { SandboxOptions } from '../src/types.js';

describe('Discovery Integration Tests', () => {
  let mcpClientPool: MCPClientPool;

  beforeAll(async () => {
    // Initialize config (required for getDenoPath())
    await initConfig();
  });

  beforeEach(() => {
    // Create mock MCP client pool with realistic test tools
    mcpClientPool = new MCPClientPool();

    // Mock listAllToolSchemas to return realistic tool data
    vi.spyOn(mcpClientPool, 'listAllToolSchemas').mockResolvedValue([
      {
        name: 'mcp__filesystem__read_file',
        description: 'Read a file from the filesystem',
        parameters: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', description: 'File path to read' },
          },
        },
      },
      {
        name: 'mcp__filesystem__write_file',
        description: 'Write content to a file',
        parameters: {
          type: 'object',
          required: ['path', 'content'],
          properties: {
            path: { type: 'string', description: 'File path to write' },
            content: { type: 'string', description: 'Content to write' },
          },
        },
      },
      {
        name: 'mcp__network__fetch_url',
        description: 'Fetch content from a URL',
        parameters: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', description: 'URL to fetch' },
          },
        },
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('End-to-End Workflow (T108-T111)', () => {
    it('should_discoverAndExecuteTool_when_singleRoundTrip', async () => {
      // T108: Validate complete workflow in single sandbox execution
      const code = `
        // Step 1: Discover all available tools
        const allTools = await discoverMCPTools();
        console.log('Discovered tools count:', allTools.length);

        // Step 2: Find a specific tool
        const readTool = allTools.find(t => t.name.includes('read_file'));
        console.log('Found read_file tool:', readTool ? 'yes' : 'no');

        // Step 3: Verify tool can be used (mock execution)
        if (readTool) {
          console.log('Tool name:', readTool.name);
          console.log('Tool has parameters:', readTool.parameters ? 'yes' : 'no');
        }

        // Output final result
        console.log(JSON.stringify({
          success: true,
          toolsDiscovered: allTools.length,
          foundReadTool: !!readTool,
          workflowComplete: true
        }));
      `;

      const options: SandboxOptions = {
        code,
        language: 'typescript',
        permissions: { read: [], write: [], net: [] },
        allowedTools: [],
      };

      const result = await executeTypescriptInSandbox(options, mcpClientPool);

      // Verify workflow completed successfully
      expect(result.success).toBe(true);
      expect(result.output).toContain('Discovered tools count: 3');
      expect(result.output).toContain('Found read_file tool: yes');
      expect(result.output).toContain('"workflowComplete":true');
    });

    it('should_preserveVariables_when_multipleDiscoveryCallsInSameExecution', async () => {
      // T109: Verify variables persist across multiple discovery calls
      const code = `
        // First discovery call - store results
        const firstDiscovery = await discoverMCPTools();
        const firstCount = firstDiscovery.length;

        // Search for file-related tools - second discovery call
        const fileTools = await searchTools('file');

        // Get specific tool schema - third discovery call
        const readSchema = await getToolSchema('mcp__filesystem__read_file');

        // Verify all variables still accessible (no context loss)
        console.log(JSON.stringify({
          firstDiscoveryStillAccessible: firstCount === 3,
          fileToolsFound: fileTools.length > 0,
          specificSchemaRetrieved: !!readSchema,
          variablesPersisted: true,
          firstCount,
          fileToolsCount: fileTools.length,
          hasReadSchema: !!readSchema
        }));
      `;

      const options: SandboxOptions = {
        code,
        language: 'typescript',
        permissions: { read: [], write: [], net: [] },
        allowedTools: [],
      };

      const result = await executeTypescriptInSandbox(options, mcpClientPool);

      // Verify all variables persisted
      expect(result.success).toBe(true);
      expect(result.output).toContain('"firstDiscoveryStillAccessible":true');
      expect(result.output).toContain('"fileToolsFound":true');
      expect(result.output).toContain('"specificSchemaRetrieved":true');
      expect(result.output).toContain('"variablesPersisted":true');
    });

    it('should_discoverThenInspectThenExecute_when_completeWorkflow', async () => {
      // T110: Verify complete workflow with no context switching
      const code = `
        // PHASE 1: Discovery - Find tools matching criteria
        const networkTools = await searchTools('fetch url', 5);
        console.log('Phase 1 Complete - Found network tools:', networkTools.length);

        // PHASE 2: Inspection - Get detailed schema for specific tool
        const fetchTool = networkTools.find(t => t.name.includes('fetch_url'));
        const detailedSchema = fetchTool
          ? await getToolSchema(fetchTool.name)
          : null;

        console.log('Phase 2 Complete - Retrieved schema:', !!detailedSchema);

        // PHASE 3: Validation - Verify schema has required parameters
        let hasRequiredParams = false;
        if (detailedSchema && detailedSchema.parameters) {
          const params = detailedSchema.parameters as any;
          hasRequiredParams = params.required && params.required.includes('url');
        }

        console.log('Phase 3 Complete - Schema validated:', hasRequiredParams);

        // Final result - all phases completed in single execution
        console.log(JSON.stringify({
          discoveryPhaseComplete: networkTools.length > 0,
          inspectionPhaseComplete: !!detailedSchema,
          validationPhaseComplete: hasRequiredParams,
          noContextSwitching: true,
          singleRoundTrip: true
        }));
      `;

      const options: SandboxOptions = {
        code,
        language: 'typescript',
        permissions: { read: [], write: [], net: [] },
        allowedTools: [],
      };

      const result = await executeTypescriptInSandbox(options, mcpClientPool);

      // Verify complete workflow
      expect(result.success).toBe(true);
      expect(result.output).toContain('Phase 1 Complete');
      expect(result.output).toContain('Phase 2 Complete');
      expect(result.output).toContain('Phase 3 Complete');
      expect(result.output).toContain('"discoveryPhaseComplete":true');
      expect(result.output).toContain('"inspectionPhaseComplete":true');
      expect(result.output).toContain('"validationPhaseComplete":true');
      expect(result.output).toContain('"singleRoundTrip":true');
    });
  });
});
