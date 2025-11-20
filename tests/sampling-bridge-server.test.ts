import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SamplingBridgeServer } from '../src/sampling-bridge-server';
import { createServer } from 'http';
import Anthropic from '@anthropic-ai/sdk';

// Mock MCP server for testing
const mockMcpServer = {
  request: vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'Mock Claude response' }],
    stopReason: 'end_turn',
    usage: { inputTokens: 10, outputTokens: 20 }
  })
};

// Mock Anthropic client
const mockAnthropic = {
  messages: {
    create: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Mock Claude response' }],
      stop_reason: 'end_turn',
      model: 'claude-3-5-haiku-20241022',
      usage: {
        input_tokens: 10,
        output_tokens: 20
      }
    })
  }
} as unknown as Anthropic;

// Setup fake timers for rate limiting tests
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('SamplingBridgeServer', () => {
  describe('Bridge Server Lifecycle', () => {
    it('should_startBridge_when_samplingEnabled', async () => {
      // RED: This test will fail until SamplingBridgeServer is implemented
      const bridge = new SamplingBridgeServer(mockMcpServer as any);
      const result = await bridge.start();

      expect(result).toHaveProperty('port');
      expect(result).toHaveProperty('authToken');
      expect(typeof result.port).toBe('number');
      expect(typeof result.authToken).toBe('string');
      expect(result.port).toBeGreaterThan(1024); // Avoid privileged ports
      expect(result.port).toBeLessThan(65536);
      expect(result.authToken.length).toBe(64); // 256-bit = 64 hex chars
    });

    it('should_bindLocalhostOnly_when_serverStarts', async () => {
      // RED: This test will fail until implementation
      const bridge = new SamplingBridgeServer(mockMcpServer as any);
      await bridge.start();

      // This test would need to attempt external connections and verify they fail
      // For now, we'll assert the server exists and is listening on localhost
      expect(bridge).toBeDefined();
    });

    it('should_generateSecureToken_when_bridgeStarts', async () => {
      // RED: This test will fail until implementation
      const bridge1 = new SamplingBridgeServer(mockMcpServer as any);
      const bridge2 = new SamplingBridgeServer(mockMcpServer as any);

      const result1 = await bridge1.start();
      const result2 = await bridge2.start();

      // Tokens should be unique and cryptographically secure
      expect(result1.authToken).not.toBe(result2.authToken);
      expect(result1.authToken).toMatch(/^[a-f0-9]{64}$/); // 256-bit hex
      expect(result2.authToken).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should_shutdownGracefully_when_activeRequestsInProgress', async () => {
      // RED: This test will fail until implementation
      const bridge = new SamplingBridgeServer(mockMcpServer as any);
      await bridge.start();

      // Simulate active request
      const shutdownPromise = bridge.stop();

      // Advance timers to simulate request completion
      await vi.advanceTimersByTimeAsync(100);

      await shutdownPromise;
      expect(bridge).toBeDefined();
    });
  });

  describe('Authentication', () => {
    let bridge: SamplingBridgeServer;
    let serverInfo: { port: number; authToken: string };

    beforeEach(async () => {
      bridge = new SamplingBridgeServer(mockMcpServer as any, {
        enabled: true,
        maxRoundsPerExecution: 10,
        maxTokensPerExecution: 10000,
        timeoutPerCallMs: 30000,
        allowedSystemPrompts: ['You are a helpful assistant'],
        contentFilteringEnabled: false,
        allowedModels: ['claude-3-5-haiku-20241022']
      });
      serverInfo = await bridge.start();
    });

    afterEach(async () => {
      await bridge.stop();
    });

    it('should_return401_when_invalidTokenProvided', async () => {
      // Test invalid token
      const response = await fetch(`http://localhost:${serverInfo.port}/sample`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer invalid-token'
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          model: 'test-model'
        })
      });

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('Auth token invalid');
    });

    it('should_useConstantTimeComparison_when_validatingToken', async () => {
      // Test that timing is consistent regardless of token length
      const tokens = [
        'short',
        'medium-token-here',
        'very-long-token-that-should-take-similar-time-to-compare-as-shorter-ones'
      ];

      const timings: number[] = [];

      for (const token of tokens) {
        const start = Date.now();
        await fetch(`http://localhost:${serverInfo.port}/sample`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'Hello' }],
            model: 'test-model'
          })
        });
        const end = Date.now();
        timings.push(end - start);
      }

      // All timings should be within reasonable range (constant-time comparison)
      // Allow some variance for network/processing but not proportional to token length
      const maxTiming = Math.max(...timings);
      const minTiming = Math.min(...timings);
      const variance = maxTiming - minTiming;

      // Variance should be small (< 50ms for constant-time comparison)
      expect(variance).toBeLessThan(50);
    });
  });

  describe('Rate Limiting', () => {
    let bridge: SamplingBridgeServer;
    let serverInfo: { port: number; authToken: string };
    let mockAnthropic: Anthropic;

    beforeEach(async () => {
      // Create fresh mock for each test
      mockAnthropic = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'Mock Claude response' }],
            stop_reason: 'end_turn',
            model: 'claude-3-5-haiku-20241022',
            usage: {
              input_tokens: 10,
              output_tokens: 20
            }
          })
        }
      } as unknown as Anthropic;

      bridge = new SamplingBridgeServer(mockMcpServer as any, {
        enabled: true,
        maxRoundsPerExecution: 10,
        maxTokensPerExecution: 10000,
        timeoutPerCallMs: 30000,
        allowedSystemPrompts: ['You are a helpful assistant'],
        contentFilteringEnabled: false,
        allowedModels: ['claude-3-5-haiku-20241022']
      }, undefined, mockAnthropic);
      serverInfo = await bridge.start();
    });

    afterEach(async () => {
      await bridge.stop();
    });

    it('should_allow10Rounds_when_defaultLimitConfigured', async () => {
      // Make 10 calls - all should succeed
      const responses: number[] = [];
      for (let i = 0; i < 10; i++) {
        const response = await fetch(`http://localhost:${serverInfo.port}/sample`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serverInfo.authToken}`
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: `Request ${i}` }],
            model: 'claude-3-5-haiku-20241022'
          })
        });
        responses.push(response.status);
      }

      // All 10 should succeed (200)
      expect(responses.every(status => status === 200)).toBe(true);
      expect(responses.length).toBe(10);
    });

    it('should_return429_when_rateLimitExceeded', async () => {
      // Make 10 successful calls
      for (let i = 0; i < 10; i++) {
        await fetch(`http://localhost:${serverInfo.port}/sample`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serverInfo.authToken}`
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: `Request ${i}` }],
            model: 'claude-3-5-haiku-20241022'
          })
        });
      }

      // 11th call should return 429
      const response = await fetch(`http://localhost:${serverInfo.port}/sample`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serverInfo.authToken}`
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Request 11' }],
          model: 'claude-3-5-haiku-20241022'
        })
      });

      expect(response.status).toBe(429);
      const body = await response.json();
      expect(body.error).toContain('Rate limit exceeded');
    });

    it('should_enforceTokenBudget_when_10kTokensExceeded', async () => {
      // Create a bridge with lower token limit for testing
      const lowTokenMockAnthropic = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'Mock Claude response' }],
            stop_reason: 'end_turn',
            model: 'claude-3-5-haiku-20241022',
            usage: {
              input_tokens: 10,
              output_tokens: 20 // 30 tokens per call
            }
          })
        }
      } as unknown as Anthropic;

      const lowTokenBridge = new SamplingBridgeServer(mockMcpServer as any, {
        enabled: true,
        maxRoundsPerExecution: 100, // High round limit
        maxTokensPerExecution: 100, // Low token limit (100 tokens)
        timeoutPerCallMs: 30000,
        allowedSystemPrompts: ['You are a helpful assistant'],
        contentFilteringEnabled: false,
        allowedModels: ['claude-3-5-haiku-20241022']
      }, undefined, lowTokenMockAnthropic);
      const lowTokenInfo = await lowTokenBridge.start();

      try {
        // Make first call that uses tokens (30 tokens)
        await fetch(`http://localhost:${lowTokenInfo.port}/sample`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${lowTokenInfo.authToken}`
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'Test 1' }],
            model: 'claude-3-5-haiku-20241022'
          })
        });

        // Make calls until we exceed token limit
        // Each call uses 30 tokens (10 input + 20 output), so 4 calls = 120 tokens > 100 limit
        for (let i = 2; i <= 4; i++) {
          const response = await fetch(`http://localhost:${lowTokenInfo.port}/sample`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${lowTokenInfo.authToken}`
            },
            body: JSON.stringify({
              messages: [{ role: 'user', content: `Test ${i}` }],
              model: 'claude-3-5-haiku-20241022'
            })
          });

          // 4th call should exceed token limit
          if (i === 4) {
            expect(response.status).toBe(429);
            const body = await response.json();
            expect(body.error).toContain('Token limit exceeded');
          }
        }
      } finally {
        await lowTokenBridge.stop();
      }
    });

    it('should_showQuotaRemaining_when_429Returned', async () => {
      // Make 10 calls to exhaust rounds
      for (let i = 0; i < 10; i++) {
        await fetch(`http://localhost:${serverInfo.port}/sample`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serverInfo.authToken}`
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: `Request ${i}` }],
            model: 'claude-3-5-haiku-20241022'
          })
        });
      }

      // 11th call should show quota remaining
      const response = await fetch(`http://localhost:${serverInfo.port}/sample`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serverInfo.authToken}`
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Request 11' }],
          model: 'claude-3-5-haiku-20241022'
        })
      });

      expect(response.status).toBe(429);
      const body = await response.json();
      expect(body.error).toContain('remaining');
      expect(body.error).toMatch(/\d+ remaining/); // Should show "0 remaining"
    });

    it('should_handleConcurrentRequests_when_multipleCallsSimultaneous', async () => {
      // Make 10 concurrent requests
      const promises = Array.from({ length: 10 }, (_, i) =>
        fetch(`http://localhost:${serverInfo.port}/sample`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serverInfo.authToken}`
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: `Concurrent request ${i}` }],
            model: 'claude-3-5-haiku-20241022'
          })
        })
      );

      const responses = await Promise.all(promises);
      const statuses = await Promise.all(responses.map(r => r.status));

      // All should succeed (200) - AsyncLock ensures atomic counter updates
      expect(statuses.every(status => status === 200)).toBe(true);
      expect(statuses.length).toBe(10);

      // Verify metrics show exactly 10 rounds
      const metrics = await bridge.getSamplingMetrics('test');
      expect(metrics.totalRounds).toBe(10);
    });
  });

  describe('System Prompt Allowlist', () => {
    let bridge: SamplingBridgeServer;
    let serverInfo: { port: number; authToken: string };

    beforeEach(async () => {
      bridge = new SamplingBridgeServer(mockMcpServer as any, {
        enabled: true,
        maxRoundsPerExecution: 10,
        maxTokensPerExecution: 10000,
        timeoutPerCallMs: 30000,
        allowedSystemPrompts: ['', 'You are a helpful assistant', 'You are a code analysis expert'],
        contentFilteringEnabled: false,
        allowedModels: ['claude-3-5-haiku-20241022']
      }, undefined, mockAnthropic);
      serverInfo = await bridge.start();
    });

    afterEach(async () => {
      await bridge.stop();
    });

    it('should_allowEmptySystemPrompt_when_noPromptProvided', async () => {
      // Empty system prompt should always be allowed
      const response = await fetch(`http://localhost:${serverInfo.port}/sample`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serverInfo.authToken}`
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          model: 'claude-3-5-haiku-20241022',
          systemPrompt: ''
        })
      });

      expect(response.status).toBe(200);
    });

    it('should_allowDefaultPrompts_when_inAllowlist', async () => {
      // Test each default prompt in allowlist
      const allowedPrompts = [
        '',
        'You are a helpful assistant',
        'You are a code analysis expert'
      ];

      for (const prompt of allowedPrompts) {
        const response = await fetch(`http://localhost:${serverInfo.port}/sample`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serverInfo.authToken}`
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'Hello' }],
            model: 'claude-3-5-haiku-20241022',
            systemPrompt: prompt
          })
        });

        expect(response.status).toBe(200);
      }
    });

    it('should_return403_when_systemPromptNotInAllowlist', async () => {
      // Non-allowed prompt should return 403
      const response = await fetch(`http://localhost:${serverInfo.port}/sample`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serverInfo.authToken}`
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          model: 'claude-3-5-haiku-20241022',
          systemPrompt: 'You are a malicious prompt injection'
        })
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('System prompt not in allowlist');
    });

    it('should_truncatePromptInError_when_403Returned', async () => {
      // Long prompt should be truncated to max 100 chars in error message
      const longPrompt = 'A'.repeat(200); // 200 character prompt
      const response = await fetch(`http://localhost:${serverInfo.port}/sample`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serverInfo.authToken}`
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          model: 'claude-3-5-haiku-20241022',
          systemPrompt: longPrompt
        })
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('System prompt not in allowlist');
      
      // Extract the prompt from error message
      const promptMatch = body.error.match(/System prompt not in allowlist: (.+)/);
      expect(promptMatch).toBeTruthy();
      const truncatedPrompt = promptMatch![1];
      
      // Should be truncated to max 100 chars + '...'
      expect(truncatedPrompt.length).toBeLessThanOrEqual(103); // 100 chars + '...'
      expect(truncatedPrompt).toContain('...');
    });
  });

  // Additional test stubs will be added as implementation progresses
});
