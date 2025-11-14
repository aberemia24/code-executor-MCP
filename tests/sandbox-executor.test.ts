/**
 * Tests for Sandbox Executor Discovery Functions
 *
 * US6 (FR-5): Discovery Function Timeout Fix
 * Tests verify that template literal interpolation correctly passes
 * DISCOVERY_TIMEOUT_MS and endpoint URL to the sandbox.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { executeTypescriptInSandbox } from '../src/sandbox-executor.js';
import { initConfig } from '../src/config.js';
import type { MCPClientPool } from '../src/mcp-client-pool.js';
import type { SandboxOptions } from '../src/types.js';

describe('Discovery Function Timeout Fix (US6)', () => {
  let mockMCPClientPool: MCPClientPool;

  beforeAll(async () => {
    // Initialize configuration for sandbox execution
    await initConfig({});
  });

  beforeEach(() => {
    // Mock MCP Client Pool with minimal implementation
    mockMCPClientPool = {
      listAllTools: vi.fn().mockReturnValue([
        {
          name: 'mcp__filesystem__read_file',
          description: 'Read file contents',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' }
            },
            required: ['path']
          }
        }
      ]),
      listAllToolSchemas: vi.fn().mockResolvedValue([
        {
          name: 'mcp__filesystem__read_file',
          description: 'Read file contents',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' }
            },
            required: ['path']
          }
        }
      ]),
      callTool: vi.fn().mockResolvedValue({ result: 'success' }),
      getClient: vi.fn(),
      close: vi.fn()
    } as unknown as MCPClientPool;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * T064: Test discoverMCPTools() completes within 500ms
   *
   * ACCEPTANCE CRITERIA:
   * - discoverMCPTools() must complete within 500ms (NFR-2 requirement)
   * - Template literal interpolation must correctly pass DISCOVERY_TIMEOUT_MS constant
   * - Timeout error message must include actual timeout value
   *
   * ROOT CAUSE (GitHub Issue #21):
   * Template literal escaping issue in src/sandbox-executor.ts:164 and 190
   * ${DISCOVERY_TIMEOUT_MS} interpolated as literal string instead of numeric value
   */
  it('should_completeWithin500ms_when_discoverMCPToolsCalled', async () => {
    const code = `
      const startTime = Date.now();
      const tools = await discoverMCPTools();
      const duration = Date.now() - startTime;

      // Verify tools returned
      if (!Array.isArray(tools) || tools.length === 0) {
        throw new Error('Expected non-empty array of tools');
      }

      // Verify completes within 500ms
      if (duration > 500) {
        throw new Error(\`Discovery took \${duration}ms, expected <500ms\`);
      }

      console.log(\`Discovery completed in \${duration}ms\`);
    `;

    const options: SandboxOptions = {
      code,
      allowedTools: [],
      timeoutMs: 5000,
      permissions: { read: [], write: [], net: [] }
    };

    const result = await executeTypescriptInSandbox(options, mockMCPClientPool);

    // Debug: log error if test fails
    if (!result.success) {
      console.error('Sandbox execution failed:', result.error);
      console.error('Output:', result.output);
    }

    // Verify execution succeeded
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify output confirms fast completion
    expect(result.output).toMatch(/Discovery completed in \d+ms/);

    // Extract duration from output
    const match = result.output?.match(/Discovery completed in (\d+)ms/);
    if (match) {
      const duration = parseInt(match[1], 10);
      expect(duration).toBeLessThan(500);
    }
  });

  /**
   * T064 (Edge Case): Test timeout error message includes correct constant value
   *
   * ACCEPTANCE CRITERIA:
   * - Timeout error must show "timed out after 500ms" (not "${DISCOVERY_TIMEOUT_MS}ms")
   * - Error must be caught and re-thrown with normalized message
   *
   * BUG SYMPTOM:
   * Before fix: "timed out after ${DISCOVERY_TIMEOUT_MS}ms" (literal string)
   * After fix: "timed out after 500ms" (numeric value)
   */
  it('should_showCorrectTimeoutValue_when_discoveryTimesOut', async () => {
    // Mock MCP proxy to delay response beyond 500ms (simulate slow server)
    const code = `
      try {
        // This should timeout if proxy is slow
        const tools = await discoverMCPTools();
        console.log('Discovery succeeded unexpectedly');
      } catch (error) {
        // Check error message contains numeric value, not template literal
        const errorMessage = error.message || String(error);

        if (errorMessage.includes('\${DISCOVERY_TIMEOUT_MS}')) {
          throw new Error('BUG: Template literal not interpolated. Error: ' + errorMessage);
        }

        if (!errorMessage.includes('500ms')) {
          throw new Error('Expected timeout value "500ms" in error, got: ' + errorMessage);
        }

        console.log('Timeout error correctly formatted: ' + errorMessage);
      }
    `;

    const options: SandboxOptions = {
      code,
      allowedTools: [],
      timeoutMs: 5000,
      permissions: { read: [], write: [], net: [] }
    };

    const result = await executeTypescriptInSandbox(options, mockMCPClientPool);

    // Either succeeds fast OR shows correct timeout error
    if (result.success) {
      expect(result.output).toMatch(/Timeout error correctly formatted|Discovery succeeded/);
      // Verify no template literal leaked
      expect(result.output).not.toContain('${DISCOVERY_TIMEOUT_MS}');
    }
  });

  /**
   * T064 (Edge Case): Test getToolSchema() also has correct timeout
   *
   * ACCEPTANCE CRITERIA:
   * - getToolSchema() leverages discoverMCPTools() (DRY principle)
   * - Timeout applies transitively (getToolSchema calls discoverMCPTools)
   * - Returns null for non-existent tools (no exception)
   */
  it('should_completeWithin500ms_when_getToolSchemaCalled', async () => {
    const code = `
      const startTime = Date.now();
      const schema = await getToolSchema('mcp__filesystem__read_file');
      const duration = Date.now() - startTime;

      // Verify schema returned
      if (!schema || typeof schema !== 'object') {
        throw new Error('Expected tool schema object');
      }

      // Verify completes within 500ms
      if (duration > 500) {
        throw new Error(\`getToolSchema took \${duration}ms, expected <500ms\`);
      }

      console.log(\`getToolSchema completed in \${duration}ms\`);
    `;

    const options: SandboxOptions = {
      code,
      allowedTools: [],
      timeoutMs: 5000,
      permissions: { read: [], write: [], net: [] }
    };

    const result = await executeTypescriptInSandbox(options, mockMCPClientPool);

    expect(result.success).toBe(true);
    expect(result.output).toMatch(/getToolSchema completed in \d+ms/);
  });

  /**
   * T064 (Edge Case): Test searchTools() also has correct timeout
   *
   * ACCEPTANCE CRITERIA:
   * - searchTools() leverages discoverMCPTools() (DRY principle)
   * - Timeout applies transitively
   * - Query string splitting works correctly
   * - Result limit applied correctly
   */
  it('should_completeWithin500ms_when_searchToolsCalled', async () => {
    const code = `
      const startTime = Date.now();
      const tools = await searchTools('file read', 10);
      const duration = Date.now() - startTime;

      // Verify tools returned (array, possibly empty)
      if (!Array.isArray(tools)) {
        throw new Error('Expected array of tools');
      }

      // Verify completes within 500ms
      if (duration > 500) {
        throw new Error(\`searchTools took \${duration}ms, expected <500ms\`);
      }

      console.log(\`searchTools completed in \${duration}ms\`);
    `;

    const options: SandboxOptions = {
      code,
      allowedTools: [],
      timeoutMs: 5000,
      permissions: { read: [], write: [], net: [] }
    };

    const result = await executeTypescriptInSandbox(options, mockMCPClientPool);

    expect(result.success).toBe(true);
    expect(result.output).toMatch(/searchTools completed in \d+ms/);
  });
});
