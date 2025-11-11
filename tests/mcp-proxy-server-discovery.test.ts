/**
 * Tests for MCP Proxy Server Discovery Endpoint
 *
 * Tests the GET /mcp/tools endpoint for tool discovery functionality.
 * Validates authentication, rate limiting, search filtering, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MCPProxyServer } from '../src/mcp-proxy-server.js';
import { MCPClientPool } from '../src/mcp-client-pool.js';
import type { ToolSchema } from '../src/types/discovery.js';
import * as http from 'http';

describe('MCP Proxy Server Discovery Endpoint', () => {
  let proxyServer: MCPProxyServer;
  let mcpClientPool: MCPClientPool;
  let port: number;
  let authToken: string;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Create MCP Client Pool
    mcpClientPool = new MCPClientPool();

    // Mock the initialized property to bypass initialization check
    Object.defineProperty(mcpClientPool, 'initialized', {
      get: () => true,
      configurable: true,
    });

    // Create proxy server with empty allowlist (discovery bypasses allowlist)
    proxyServer = new MCPProxyServer(mcpClientPool, []);

    // Start server
    const serverInfo = await proxyServer.start();
    port = serverInfo.port;
    authToken = serverInfo.authToken;
  });

  afterEach(async () => {
    await proxyServer.stop();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  /**
   * Helper to make GET request to discovery endpoint
   */
  async function makeDiscoveryRequest(
    queryParams: string = '',
    token: string | null = authToken
  ): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
        port,
        path: `/mcp/tools${queryParams}`,
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode || 500, body });
        });
      });

      req.on('error', reject);
      req.end();
    });
  }

  describe('Happy Path', () => {
    it('should_returnAllTools_when_noSearchProvided', async () => {
      // Setup: Mock listAllToolSchemas to return sample tools
      const mockTools: ToolSchema[] = [
        {
          name: 'mcp__server1__tool1',
          description: 'Test tool 1',
          parameters: { type: 'object', properties: {} },
        },
        {
          name: 'mcp__server1__tool2',
          description: 'Test tool 2',
          parameters: { type: 'object', properties: {} },
        },
      ];

      vi.spyOn(mcpClientPool, 'listAllToolSchemas').mockResolvedValue(mockTools);

      // Execute: GET /mcp/tools with no search query
      const response = await makeDiscoveryRequest();

      // Verify: 200 OK with all tools returned
      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.tools).toHaveLength(2);
      expect(data.tools[0].name).toBe('mcp__server1__tool1');
      expect(data.tools[1].name).toBe('mcp__server1__tool2');
    });

    it('should_returnFilteredTools_when_singleKeywordProvided', async () => {
      // Setup: Mock tools with different descriptions
      const mockTools: ToolSchema[] = [
        {
          name: 'mcp__server1__code_review',
          description: 'Review code for quality',
          parameters: { type: 'object', properties: {} },
        },
        {
          name: 'mcp__server1__file_read',
          description: 'Read file contents',
          parameters: { type: 'object', properties: {} },
        },
      ];

      vi.spyOn(mcpClientPool, 'listAllToolSchemas').mockResolvedValue(mockTools);

      // Execute: GET /mcp/tools?q=code
      const response = await makeDiscoveryRequest('?q=code');

      // Verify: Only tools matching "code" returned
      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.tools).toHaveLength(1);
      expect(data.tools[0].name).toBe('mcp__server1__code_review');
    });

    it('should_returnFilteredTools_when_multipleKeywordsProvided', async () => {
      // Setup: Mock tools with varied descriptions
      const mockTools: ToolSchema[] = [
        {
          name: 'mcp__server1__code_review',
          description: 'Review code for quality',
          parameters: { type: 'object', properties: {} },
        },
        {
          name: 'mcp__server1__file_read',
          description: 'Read file contents',
          parameters: { type: 'object', properties: {} },
        },
        {
          name: 'mcp__server1__test_runner',
          description: 'Run automated tests',
          parameters: { type: 'object', properties: {} },
        },
      ];

      vi.spyOn(mcpClientPool, 'listAllToolSchemas').mockResolvedValue(mockTools);

      // Execute: GET /mcp/tools?q=code&q=test (OR logic)
      const response = await makeDiscoveryRequest('?q=code&q=test');

      // Verify: Tools matching "code" OR "test" returned
      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.tools).toHaveLength(2);
      expect(data.tools.map((t: ToolSchema) => t.name)).toEqual([
        'mcp__server1__code_review',
        'mcp__server1__test_runner',
      ]);
    });
  });

  describe('Authentication', () => {
    it('should_return401_when_bearerTokenMissing', async () => {
      // Execute: GET /mcp/tools without Authorization header
      const response = await makeDiscoveryRequest('', null);

      // Verify: 401 Unauthorized
      expect(response.statusCode).toBe(401);
      const data = JSON.parse(response.body);
      expect(data.error).toContain('Unauthorized');
    });

    it('should_return401_when_bearerTokenInvalid', async () => {
      // Execute: GET /mcp/tools with invalid token
      const response = await makeDiscoveryRequest('', 'invalid-token-xyz');

      // Verify: 401 Unauthorized
      expect(response.statusCode).toBe(401);
      const data = JSON.parse(response.body);
      expect(data.error).toContain('Unauthorized');
    });
  });

  describe('Rate Limiting', () => {
    it('should_return429_when_rateLimitExceeded', async () => {
      // Setup: Mock empty tool list to speed up test
      vi.spyOn(mcpClientPool, 'listAllToolSchemas').mockResolvedValue([]);

      // Execute: Make 31 requests rapidly (rate limit is 30 req/60s)
      const requests: Promise<{ statusCode: number; body: string }>[] = [];
      for (let i = 0; i < 31; i++) {
        requests.push(makeDiscoveryRequest());
      }

      const responses = await Promise.all(requests);

      // Verify: Last request should be rate limited
      const statusCodes = responses.map((r) => r.statusCode);
      expect(statusCodes.filter((code) => code === 429).length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should_returnEmptyArray_when_noMCPServersConnected', async () => {
      // Setup: Mock empty tool list
      vi.spyOn(mcpClientPool, 'listAllToolSchemas').mockResolvedValue([]);

      // Execute: GET /mcp/tools
      const response = await makeDiscoveryRequest();

      // Verify: 200 OK with empty array
      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.tools).toEqual([]);
    });

    it('should_returnEmptyArray_when_noToolsMatchSearch', async () => {
      // Setup: Mock tools that don't match search
      const mockTools: ToolSchema[] = [
        {
          name: 'mcp__server1__tool1',
          description: 'Test tool 1',
          parameters: { type: 'object', properties: {} },
        },
      ];

      vi.spyOn(mcpClientPool, 'listAllToolSchemas').mockResolvedValue(mockTools);

      // Execute: GET /mcp/tools?q=nonexistent
      const response = await makeDiscoveryRequest('?q=nonexistent');

      // Verify: 200 OK with empty array
      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.tools).toEqual([]);
    });

    it('should_return400_when_searchQueryTooLong', async () => {
      // Execute: GET /mcp/tools?q=<101 chars>
      const longQuery = 'a'.repeat(101);
      const response = await makeDiscoveryRequest(`?q=${longQuery}`);

      // Verify: 400 Bad Request
      expect(response.statusCode).toBe(400);
      const data = JSON.parse(response.body);
      expect(data.error).toContain('too long');
    });

    it('should_return400_when_searchQueryHasInvalidCharacters', async () => {
      // Execute: GET /mcp/tools?q=<script>alert('xss')</script>
      const response = await makeDiscoveryRequest('?q=%3Cscript%3Ealert%28%27xss%27%29%3C%2Fscript%3E');

      // Verify: 400 Bad Request
      expect(response.statusCode).toBe(400);
      const data = JSON.parse(response.body);
      expect(data.error).toContain('Invalid characters');
    });

    it('should_return500_when_mcpClientPoolTimesOut', async () => {
      // Setup: Mock timeout error
      vi.spyOn(mcpClientPool, 'listAllToolSchemas').mockRejectedValue(
        new Error('Request timeout after 500ms')
      );

      // Execute: GET /mcp/tools
      const response = await makeDiscoveryRequest();

      // Verify: 500 Internal Server Error
      expect(response.statusCode).toBe(500);
      const data = JSON.parse(response.body);
      expect(data.error).toContain('timeout');
    });
  });

  describe('Audit Logging', () => {
    it('should_logDiscoveryRequest_when_successfulQuery', async () => {
      // Setup: Mock tools and spy on audit log
      const mockTools: ToolSchema[] = [
        {
          name: 'mcp__server1__tool1',
          description: 'Test tool',
          parameters: { type: 'object', properties: {} },
        },
      ];

      vi.spyOn(mcpClientPool, 'listAllToolSchemas').mockResolvedValue(mockTools);

      // Spy on console.error to capture audit log
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Execute: GET /mcp/tools?q=test
      const response = await makeDiscoveryRequest('?q=test');

      // Verify: Success response
      expect(response.statusCode).toBe(200);

      // Verify: Audit log contains discovery action (logged as JSON string)
      expect(consoleSpy).toHaveBeenCalled();
      const logCalls = consoleSpy.mock.calls;
      const discoveryLog = logCalls.find(call => {
        const logStr = call[0];
        return typeof logStr === 'string' && logStr.includes('action') && logStr.includes('discovery');
      });
      expect(discoveryLog).toBeDefined();

      // Parse and verify log structure
      if (discoveryLog) {
        const logData = JSON.parse(discoveryLog[0]);
        expect(logData.action).toBe('discovery');
        expect(logData.endpoint).toBe('/mcp/tools');
        expect(logData.searchTerms).toContain('test');
        expect(logData.resultsCount).toBeGreaterThanOrEqual(0);
      }

      consoleSpy.mockRestore();
    });
  });
});
