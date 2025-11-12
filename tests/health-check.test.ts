/**
 * Unit tests for Health Check Server
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HealthCheckServer } from '../src/health-check.js';
import { MCPClientPool } from '../src/mcp-client-pool.js';
import { ConnectionPool } from '../src/connection-pool.js';

describe('HealthCheckServer', () => {
  let healthCheckServer: HealthCheckServer;
  let mcpClientPool: MCPClientPool;
  let connectionPool: ConnectionPool;
  let testPort: number;

  beforeEach(() => {
    // Use a random port for each test to avoid conflicts
    testPort = 10000 + Math.floor(Math.random() * 10000);

    mcpClientPool = new MCPClientPool();
    connectionPool = new ConnectionPool(10);

    healthCheckServer = new HealthCheckServer({
      port: testPort,
      host: 'localhost',
      mcpClientPool,
      connectionPool,
      version: '1.0.0-test',
    });
  });

  afterEach(async () => {
    if (healthCheckServer.isRunning()) {
      await healthCheckServer.stop();
    }
  });

  describe('server lifecycle', () => {
    it('should_start_and_stop_server', async () => {
      await healthCheckServer.start();
      expect(healthCheckServer.isRunning()).toBe(true);
      expect(healthCheckServer.getPort()).toBe(testPort);

      await healthCheckServer.stop();
      expect(healthCheckServer.isRunning()).toBe(false);
    });

    it('should_not_be_running_initially', () => {
      expect(healthCheckServer.isRunning()).toBe(false);
    });

    it('should_return_configured_port', () => {
      expect(healthCheckServer.getPort()).toBe(testPort);
    });
  });

  describe('GET /health', () => {
    beforeEach(async () => {
      await healthCheckServer.start();
    });

    it('should_return_200_with_health_status', async () => {
      const response = await fetch(`http://localhost:${testPort}/health`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json');

      const data = await response.json();
      expect(data).toHaveProperty('status', 'ok');
      expect(data).toHaveProperty('uptime');
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('version', '1.0.0-test');
      expect(typeof data.uptime).toBe('number');
      expect(data.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should_include_cache_control_header', async () => {
      const response = await fetch(`http://localhost:${testPort}/health`);

      expect(response.headers.get('cache-control')).toBe('no-cache, no-store, must-revalidate');
    });

    it('should_track_uptime_correctly', async () => {
      const response1 = await fetch(`http://localhost:${testPort}/health`);
      const data1 = await response1.json();

      // Wait 1 second
      await new Promise(resolve => setTimeout(resolve, 1000));

      const response2 = await fetch(`http://localhost:${testPort}/health`);
      const data2 = await response2.json();

      expect(data2.uptime).toBeGreaterThanOrEqual(data1.uptime);
    });
  });

  describe('GET /ready', () => {
    beforeEach(async () => {
      await healthCheckServer.start();
    });

    it('should_return_503_when_no_mcp_clients_connected', async () => {
      // Mock listAllTools to return empty array (no clients)
      vi.spyOn(mcpClientPool, 'listAllTools').mockReturnValue([]);

      const response = await fetch(`http://localhost:${testPort}/ready`);

      expect(response.status).toBe(503);

      const data = await response.json();
      expect(data).toHaveProperty('ready', false);
      expect(data).toHaveProperty('checks');
      expect(data.checks.mcpClients.connected).toBe(0);
      expect(data.checks.mcpClients.ready).toBe(false);
    });

    it('should_return_503_when_connection_pool_at_capacity', async () => {
      // Mock listAllTools to return some tools
      vi.spyOn(mcpClientPool, 'listAllTools').mockReturnValue([
        { name: 'test-tool', description: 'Test tool', inputSchema: {} }
      ]);

      // Mock getStats to return pool at 90%+ capacity (9/10 = 90%)
      vi.spyOn(connectionPool, 'getStats').mockReturnValue({
        active: 9,
        waiting: 0,
        max: 10,
      });

      const response = await fetch(`http://localhost:${testPort}/ready`);

      expect(response.status).toBe(503);

      const data = await response.json();
      expect(data).toHaveProperty('ready', false);
      expect(data.checks.connectionPool.ready).toBe(false);
    });

    it('should_return_503_when_requests_waiting', async () => {
      // Mock listAllTools to return some tools
      vi.spyOn(mcpClientPool, 'listAllTools').mockReturnValue([
        { name: 'test-tool', description: 'Test tool', inputSchema: {} }
      ]);

      // Mock getStats to return pool with waiting requests
      vi.spyOn(connectionPool, 'getStats').mockReturnValue({
        active: 5,
        waiting: 2,
        max: 10,
      });

      const response = await fetch(`http://localhost:${testPort}/ready`);

      expect(response.status).toBe(503);

      const data = await response.json();
      expect(data).toHaveProperty('ready', false);
      expect(data.checks.connectionPool.ready).toBe(false);
      expect(data.checks.connectionPool.waiting).toBe(2);
    });

    it('should_return_200_when_ready_to_serve', async () => {
      // Mock listAllTools to return some tools
      vi.spyOn(mcpClientPool, 'listAllTools').mockReturnValue([
        { name: 'test-tool-1', description: 'Test tool 1', inputSchema: {} },
        { name: 'test-tool-2', description: 'Test tool 2', inputSchema: {} }
      ]);

      // Mock getStats to return pool with capacity (< 90% full)
      vi.spyOn(connectionPool, 'getStats').mockReturnValue({
        active: 5,
        waiting: 0,
        max: 10,
      });

      const response = await fetch(`http://localhost:${testPort}/ready`);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('ready', true);
      expect(data.checks.mcpClients.connected).toBe(2);
      expect(data.checks.mcpClients.ready).toBe(true);
      expect(data.checks.connectionPool.ready).toBe(true);
    });

    it('should_include_connection_pool_stats', async () => {
      vi.spyOn(mcpClientPool, 'listAllTools').mockReturnValue([
        { name: 'test-tool', description: 'Test tool', inputSchema: {} }
      ]);

      const response = await fetch(`http://localhost:${testPort}/ready`);
      const data = await response.json();

      expect(data.checks.connectionPool).toHaveProperty('active');
      expect(data.checks.connectionPool).toHaveProperty('waiting');
      expect(data.checks.connectionPool).toHaveProperty('max');
      expect(data.checks.connectionPool).toHaveProperty('ready');
    });

    it('should_handle_errors_gracefully', async () => {
      // Mock listAllTools to throw an error
      vi.spyOn(mcpClientPool, 'listAllTools').mockImplementation(() => {
        throw new Error('Test error');
      });

      const response = await fetch(`http://localhost:${testPort}/ready`);

      expect(response.status).toBe(503);

      const data = await response.json();
      expect(data).toHaveProperty('ready', false);
    });
  });

  describe('GET /live', () => {
    beforeEach(async () => {
      await healthCheckServer.start();
    });

    it('should_return_200_with_alive_status', async () => {
      const response = await fetch(`http://localhost:${testPort}/live`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json');

      const data = await response.json();
      expect(data).toHaveProperty('alive', true);
      expect(data).toHaveProperty('timestamp');
    });

    it('should_respond_quickly', async () => {
      const startTime = Date.now();
      await fetch(`http://localhost:${testPort}/live`);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(100); // Should respond in < 100ms
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      await healthCheckServer.start();
    });

    it('should_return_404_for_unknown_endpoint', async () => {
      const response = await fetch(`http://localhost:${testPort}/unknown`);

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data).toHaveProperty('error', 'Not Found');
      expect(data).toHaveProperty('message');
    });

    it('should_return_405_for_non_GET_requests', async () => {
      const response = await fetch(`http://localhost:${testPort}/health`, {
        method: 'POST',
      });

      expect(response.status).toBe(405);

      const data = await response.json();
      expect(data).toHaveProperty('error', 'Method Not Allowed');
    });

    it('should_reject_PUT_requests', async () => {
      const response = await fetch(`http://localhost:${testPort}/health`, {
        method: 'PUT',
      });

      expect(response.status).toBe(405);
    });

    it('should_reject_DELETE_requests', async () => {
      const response = await fetch(`http://localhost:${testPort}/ready`, {
        method: 'DELETE',
      });

      expect(response.status).toBe(405);
    });
  });

  describe('environment variables', () => {
    it('should_use_default_port_if_not_specified', () => {
      const server = new HealthCheckServer({
        mcpClientPool,
        connectionPool,
      });

      // Default port should be 3000
      expect(server.getPort()).toBe(3000);
    });

    it('should_respect_custom_port', () => {
      const customPort = 8888;
      const server = new HealthCheckServer({
        port: customPort,
        mcpClientPool,
        connectionPool,
      });

      expect(server.getPort()).toBe(customPort);
    });
  });

  describe('kubernetes compatibility', () => {
    beforeEach(async () => {
      await healthCheckServer.start();
    });

    it('should_provide_readiness_probe_compatible_response', async () => {
      vi.spyOn(mcpClientPool, 'listAllTools').mockReturnValue([
        { name: 'test-tool', description: 'Test tool', inputSchema: {} }
      ]);

      const response = await fetch(`http://localhost:${testPort}/ready`);

      // K8s expects 200-399 for success, 400+ for failure
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(400);
    });

    it('should_provide_liveness_probe_compatible_response', async () => {
      const response = await fetch(`http://localhost:${testPort}/live`);

      // K8s expects 200-399 for success
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(400);
    });

    it('should_return_json_response_format', async () => {
      const endpoints = ['/health', '/ready', '/live'];

      for (const endpoint of endpoints) {
        const response = await fetch(`http://localhost:${testPort}${endpoint}`);
        const contentType = response.headers.get('content-type');

        expect(contentType).toBe('application/json');

        // Should be valid JSON
        const data = await response.json();
        expect(data).toBeTruthy();
      }
    });
  });

  describe('concurrent requests', () => {
    beforeEach(async () => {
      await healthCheckServer.start();
    });

    it('should_handle_multiple_simultaneous_requests', async () => {
      vi.spyOn(mcpClientPool, 'listAllTools').mockReturnValue([
        { name: 'test-tool', description: 'Test tool', inputSchema: {} }
      ]);

      // Send 10 simultaneous requests
      const promises = Array(10).fill(null).map(() =>
        fetch(`http://localhost:${testPort}/health`)
      );

      const responses = await Promise.all(promises);

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(200);
      }
    });

    it('should_handle_mixed_endpoint_requests', async () => {
      vi.spyOn(mcpClientPool, 'listAllTools').mockReturnValue([
        { name: 'test-tool', description: 'Test tool', inputSchema: {} }
      ]);

      const promises = [
        fetch(`http://localhost:${testPort}/health`),
        fetch(`http://localhost:${testPort}/ready`),
        fetch(`http://localhost:${testPort}/live`),
        fetch(`http://localhost:${testPort}/health`),
        fetch(`http://localhost:${testPort}/ready`),
      ];

      const responses = await Promise.all(promises);

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBeGreaterThanOrEqual(200);
        expect(response.status).toBeLessThan(500);
      }
    });
  });
});
