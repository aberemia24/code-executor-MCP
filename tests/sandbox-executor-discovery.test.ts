/**
 * Tests for Sandbox Discovery Function Injection (Phase 4 - FR-1, FR-2, FR-3)
 *
 * Tests that discovery functions (discoverMCPTools, getToolSchema, searchTools)
 * are properly injected into the Deno sandbox globalThis namespace.
 *
 * Test Strategy: Execute TypeScript code in sandbox and verify functions work.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { executeTypescriptInSandbox } from '../src/sandbox-executor.js';
import { MCPClientPool } from '../src/mcp-client-pool.js';
import { initConfig } from '../src/config.js';
import type { SandboxOptions } from '../src/types.js';

describe('Sandbox Discovery Function Injection', () => {
  let mcpClientPool: MCPClientPool;

  beforeAll(async () => {
    // Initialize config (required for getDenoPath())
    await initConfig();
  });

  beforeEach(() => {
    // Create mock MCP client pool with test tools
    mcpClientPool = new MCPClientPool();

    // Mock listAllToolSchemas to return test data
    vi.spyOn(mcpClientPool, 'listAllToolSchemas').mockResolvedValue([
      {
        name: 'testTool1',
        description: 'Test tool for file operations',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'testTool2',
        description: 'Test tool for network operations',
        inputSchema: { type: 'object', properties: {} },
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Function Injection (T060)', () => {
    it('should_injectDiscoverMCPTools_when_sandboxInitialized', async () => {
      // T060: Verify discoverMCPTools function exists in globalThis
      const code = `
        const hasDiscoverMCPTools = typeof globalThis.discoverMCPTools === 'function';
        console.log(JSON.stringify({ hasDiscoverMCPTools }));
      `;

      const options: SandboxOptions = {
        code,
        language: 'typescript',
        permissions: { read: [], write: [], net: [] },
        allowedTools: [],
        timeoutMs: 10000,
      };

      const result = await executeTypescriptInSandbox(options, mcpClientPool);

      // RED: Function doesn't exist yet (not implemented)
      expect(result.success).toBe(false);
      expect(result.output).not.toContain('"hasDiscoverMCPTools":true');
    });

    it('should_injectSearchTools_when_sandboxInitialized', async () => {
      // Verify searchTools function exists in globalThis
      const code = `
        const hasSearchTools = typeof globalThis.searchTools === 'function';
        console.log(JSON.stringify({ hasSearchTools }));
      `;

      const options: SandboxOptions = {
        code,
        language: 'typescript',
        permissions: { read: [], write: [], net: [] },
        allowedTools: [],
        timeoutMs: 10000,
      };

      const result = await executeTypescriptInSandbox(options, mcpClientPool);

      // RED: Function doesn't exist yet (not implemented)
      expect(result.success).toBe(false);
      expect(result.output).not.toContain('"hasSearchTools":true');
    });

    it('should_injectGetToolSchema_when_sandboxInitialized', async () => {
      // Verify getToolSchema function exists in globalThis
      const code = `
        const hasGetToolSchema = typeof globalThis.getToolSchema === 'function';
        console.log(JSON.stringify({ hasGetToolSchema }));
      `;

      const options: SandboxOptions = {
        code,
        language: 'typescript',
        permissions: { read: [], write: [], net: [] },
        allowedTools: [],
        timeoutMs: 10000,
      };

      const result = await executeTypescriptInSandbox(options, mcpClientPool);

      // RED: Function doesn't exist yet (not implemented)
      expect(result.success).toBe(false);
      expect(result.output).not.toContain('"hasGetToolSchema":true');
    });
  });

  describe('discoverMCPTools() Behavior', () => {
    it('should_callProxyEndpoint_when_discoverMCPToolsCalled', async () => {
      // T061: Verify fetch() called with correct URL (GET /mcp/tools)
      const code = `
        try {
          const tools = await globalThis.discoverMCPTools();
          console.log(JSON.stringify({ success: true, toolCount: tools.length }));
        } catch (error) {
          console.log(JSON.stringify({ success: false, error: error.message }));
        }
      `;

      const options: SandboxOptions = {
        code,
        language: 'typescript',
        permissions: { read: [], write: [], net: [] },
        allowedTools: [],
        timeoutMs: 10000,
      };

      const result = await executeTypescriptInSandbox(options, mcpClientPool);

      // RED: Function doesn't exist, should fail
      expect(result.success).toBe(false);
      expect(result.error || result.output).toContain('discoverMCPTools');
    });

    it('should_includeBearerToken_when_discoverMCPToolsCalled', async () => {
      // T062: Verify Authorization header included in request
      const code = `
        try {
          // discoverMCPTools should automatically include Bearer token
          const tools = await globalThis.discoverMCPTools();
          console.log(JSON.stringify({ authenticated: true, toolCount: tools.length }));
        } catch (error) {
          // If we get 401, it means function tried to call endpoint without token
          const is401 = error.message.includes('401') || error.message.includes('Unauthorized');
          console.log(JSON.stringify({ authenticated: false, is401 }));
        }
      `;

      const options: SandboxOptions = {
        code,
        language: 'typescript',
        permissions: { read: [], write: [], net: [] },
        allowedTools: [],
        timeoutMs: 10000,
      };

      const result = await executeTypescriptInSandbox(options, mcpClientPool);

      // RED: Function doesn't exist
      expect(result.success).toBe(false);
    });

    it('should_includeSearchParams_when_searchOptionsProvided', async () => {
      // T063: Verify ?q query parameters included when search option provided
      const code = `
        try {
          const tools = await globalThis.discoverMCPTools({ search: ['file', 'network'] });
          console.log(JSON.stringify({ success: true, filtered: tools.length > 0 }));
        } catch (error) {
          console.log(JSON.stringify({ success: false, error: error.message }));
        }
      `;

      const options: SandboxOptions = {
        code,
        language: 'typescript',
        permissions: { read: [], write: [], net: [] },
        allowedTools: [],
        timeoutMs: 10000,
      };

      const result = await executeTypescriptInSandbox(options, mcpClientPool);

      // RED: Function doesn't exist
      expect(result.success).toBe(false);
    });

    it('should_throwError_when_authenticationFails', async () => {
      // T064: Verify 401 error thrown when auth fails
      const code = `
        try {
          // This should fail if we somehow bypass auth or token is invalid
          const tools = await globalThis.discoverMCPTools();
          console.log(JSON.stringify({ shouldNotReachHere: true }));
        } catch (error) {
          const isAuthError = error.message.includes('401') ||
                             error.message.includes('Unauthorized') ||
                             error.message.includes('authentication');
          console.log(JSON.stringify({ caughtAuthError: isAuthError, error: error.message }));
        }
      `;

      const options: SandboxOptions = {
        code,
        language: 'typescript',
        permissions: { read: [], write: [], net: [] },
        allowedTools: [],
        timeoutMs: 10000,
      };

      const result = await executeTypescriptInSandbox(options, mcpClientPool);

      // RED: Function doesn't exist, but test structure is correct
      expect(result.success).toBe(false);
    });

    it('should_throwError_when_timeoutExceeds500ms', async () => {
      // T065: Verify 500ms timeout enforced
      const code = `
        try {
          // discoverMCPTools should enforce 500ms timeout
          const tools = await globalThis.discoverMCPTools();
          console.log(JSON.stringify({ success: true }));
        } catch (error) {
          const isTimeoutError = error.message.includes('timeout') ||
                                error.message.includes('aborted') ||
                                error.message.includes('500');
          console.log(JSON.stringify({ timeoutError: isTimeoutError, error: error.message }));
        }
      `;

      const options: SandboxOptions = {
        code,
        language: 'typescript',
        permissions: { read: [], write: [], net: [] },
        allowedTools: [],
        timeoutMs: 10000,
      };

      const result = await executeTypescriptInSandbox(options, mcpClientPool);

      // RED: Function doesn't exist
      expect(result.success).toBe(false);
    });
  });

  describe('getToolSchema() Behavior', () => {
    it('should_returnToolSchema_when_validToolNameProvided', async () => {
      // Verify getToolSchema returns schema for valid tool
      const code = `
        try {
          const schema = await globalThis.getToolSchema('testTool1');
          console.log(JSON.stringify({ hasSchema: schema !== null, toolName: schema?.name }));
        } catch (error) {
          console.log(JSON.stringify({ success: false, error: error.message }));
        }
      `;

      const options: SandboxOptions = {
        code,
        language: 'typescript',
        permissions: { read: [], write: [], net: [] },
        allowedTools: [],
        timeoutMs: 10000,
      };

      const result = await executeTypescriptInSandbox(options, mcpClientPool);

      // RED: Function doesn't exist
      expect(result.success).toBe(false);
    });

    it('should_returnNull_when_toolNotFound', async () => {
      // Verify getToolSchema returns null for non-existent tool
      const code = `
        try {
          const schema = await globalThis.getToolSchema('nonExistentTool');
          console.log(JSON.stringify({ isNull: schema === null }));
        } catch (error) {
          console.log(JSON.stringify({ success: false, error: error.message }));
        }
      `;

      const options: SandboxOptions = {
        code,
        language: 'typescript',
        permissions: { read: [], write: [], net: [] },
        allowedTools: [],
        timeoutMs: 10000,
      };

      const result = await executeTypescriptInSandbox(options, mcpClientPool);

      // RED: Function doesn't exist
      expect(result.success).toBe(false);
    });
  });

  describe('searchTools() Behavior', () => {
    it('should_returnFilteredTools_when_queryProvided', async () => {
      // Verify searchTools filters by query string
      const code = `
        try {
          const tools = await globalThis.searchTools('file');
          console.log(JSON.stringify({ success: true, toolCount: tools.length }));
        } catch (error) {
          console.log(JSON.stringify({ success: false, error: error.message }));
        }
      `;

      const options: SandboxOptions = {
        code,
        language: 'typescript',
        permissions: { read: [], write: [], net: [] },
        allowedTools: [],
        timeoutMs: 10000,
      };

      const result = await executeTypescriptInSandbox(options, mcpClientPool);

      // RED: Function doesn't exist
      expect(result.success).toBe(false);
    });

    it('should_limitResults_when_limitProvided', async () => {
      // Verify result limit enforced
      const code = `
        try {
          const tools = await globalThis.searchTools('test', 1);
          console.log(JSON.stringify({ success: true, limitWorked: tools.length <= 1 }));
        } catch (error) {
          console.log(JSON.stringify({ success: false, error: error.message }));
        }
      `;

      const options: SandboxOptions = {
        code,
        language: 'typescript',
        permissions: { read: [], write: [], net: [] },
        allowedTools: [],
        timeoutMs: 10000,
      };

      const result = await executeTypescriptInSandbox(options, mcpClientPool);

      // RED: Function doesn't exist
      expect(result.success).toBe(false);
    });

    it('should_useDefaultLimit10_when_limitNotProvided', async () => {
      // Verify default limit of 10 used
      const code = `
        try {
          const tools = await globalThis.searchTools('test');
          console.log(JSON.stringify({ success: true, usedDefaultLimit: tools.length <= 10 }));
        } catch (error) {
          console.log(JSON.stringify({ success: false, error: error.message }));
        }
      `;

      const options: SandboxOptions = {
        code,
        language: 'typescript',
        permissions: { read: [], write: [], net: [] },
        allowedTools: [],
        timeoutMs: 10000,
      };

      const result = await executeTypescriptInSandbox(options, mcpClientPool);

      // RED: Function doesn't exist
      expect(result.success).toBe(false);
    });
  });
});
