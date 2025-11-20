import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { executeTypescriptInSandbox } from '../src/sandbox-executor.js';
import { executePythonInSandbox } from '../src/pyodide-executor.js';
import { MCPClientPool } from '../src/mcp-client-pool.js';
import { initConfig } from '../src/config.js';
import nock from 'nock';

let anthropicScope: nock.Scope;

// Initialize config before all tests
beforeAll(async () => {
  await initConfig({});
});

// Setup fake timers and HTTP mocking for integration tests
beforeEach(() => {
  vi.useFakeTimers();

  // Set ANTHROPIC_API_KEY for fallback mode
  process.env.ANTHROPIC_API_KEY = 'test-key-for-integration-tests';

  // Mock Anthropic API HTTP endpoint (for when sampling falls back to direct API)
  anthropicScope = nock('https://api.anthropic.com')
    .persist()
    .post('/v1/messages')
    .reply(200, {
      id: 'msg_integration_test',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'Mock Claude response for integration test'
        }
      ],
      model: 'claude-3-5-haiku-20241022',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 15,
        output_tokens: 25
      }
    });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();

  // Clean up nock mocks
  nock.cleanAll();
});

describe('Sampling Executor Integration', () => {
  let mcpClientPool: MCPClientPool;

  beforeEach(() => {
    mcpClientPool = new MCPClientPool();
  });

  describe('TypeScript Sampling', () => {
    it('should_throwError_when_samplingDisabledAndLlmAskCalled', async () => {
      // RED: This test will fail until TypeScript sampling integration is implemented
      const code = `
        try {
          const result = await llm.ask("Hello, world!");
          console.log(result);
        } catch (error) {
          console.error(error.message);
          throw error;
        }
      `;

      const result = await executeTypescriptInSandbox(
        {
          code,
          allowedTools: [],
          timeoutMs: 5000,
          enableSampling: false,
          permissions: { read: [], write: [], net: [] }
        },
        mcpClientPool
      );

      // Should fail because sampling is disabled
      expect(result.success).toBe(false);
      expect(result.error).toContain('Sampling not enabled');
    });

    it('should_returnClaudeResponse_when_llmAskCalled', async () => {
      const code = `
        const response = await llm.ask("What is the capital of France?");
        console.log("Response:", response);
      `;

      const result = await executeTypescriptInSandbox(
        {
          code,
          allowedTools: [],
          timeoutMs: 10000,
          enableSampling: true,
          permissions: { read: [], write: [], net: [] }
        },
        mcpClientPool
      );

      expect(result.success).toBe(true);
      expect(result).toHaveProperty('samplingCalls');
      expect(result.samplingCalls).toBeDefined();
      expect(result.samplingCalls!.length).toBeGreaterThanOrEqual(1);
      expect(result.samplingCalls![0]).toHaveProperty('response');
      expect(result.samplingCalls![0].response.content[0].text).toBe('Mock Claude response for integration test');
    });

    it('should_supportMultiTurn_when_llmThinkCalledWithMessages', async () => {
      const code = `
        const messages = [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' }
        ];
        const response = await llm.think({ messages });
        console.log("Multi-turn response:", response);
      `;

      const result = await executeTypescriptInSandbox(
        {
          code,
          allowedTools: [],
          timeoutMs: 10000,
          enableSampling: true,
          permissions: { read: [], write: [], net: [] }
        },
        mcpClientPool
      );

      expect(result.success).toBe(true);
      expect(result.samplingCalls).toBeDefined();
      expect(result.samplingCalls!.length).toBeGreaterThanOrEqual(1);
      expect(result.samplingCalls![0].messages).toHaveLength(3);
      expect(result.samplingCalls![0].response.content[0].text).toBe('Mock Claude response for integration test');
    });

    it('should_enforceRateLimits_when_multipleCallsMade', async () => {
      const code = `
        try {
          for (let i = 0; i < 12; i++) {
            const response = await llm.ask(\`Question \${i}\`);
            console.log(\`Call \${i}:\`, response);
          }
        } catch (error) {
          console.error(error.message);
          throw error;
        }
      `;

      const result = await executeTypescriptInSandbox(
        {
          code,
          allowedTools: [],
          timeoutMs: 30000,
          enableSampling: true,
          maxSamplingRounds: 10,
          permissions: { read: [], write: [], net: [] }
        },
        mcpClientPool
      );

      // Should fail due to rate limit exceeded
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Rate limit exceeded/);
    });
  });

  describe('Python Sampling', () => {
    // Python tests need real timers (Pyodide async operations don't work with fake timers)
    beforeEach(() => {
      vi.useRealTimers();
    });

    afterEach(() => {
      vi.useFakeTimers(); // Restore fake timers for other tests
    });

    it('should_throwError_when_samplingDisabledAndLlmAskCalled', async () => {
      const code = `
try:
    result = await llm.ask("Hello, world!")
    print(result)
except Exception as error:
    print(f"Error: {error}")
    raise error
      `;

      const result = await executePythonInSandbox(
        {
          code,
          allowedTools: [],
          timeoutMs: 5000,
          enableSampling: false,
          permissions: { read: [], write: [], net: [] }
        },
        mcpClientPool
      );

      // Should fail because sampling is disabled
      expect(result.success).toBe(false);
      expect(result.error).toContain('Sampling not enabled');
    });

    it('should_returnClaudeResponse_when_llmAskCalled', async () => {
      const code = `
response = await llm.ask("What is the capital of France?")
print(f"Response: {response}")
      `;

      const result = await executePythonInSandbox(
        {
          code,
          allowedTools: [],
          timeoutMs: 10000,
          enableSampling: true,
          permissions: { read: [], write: [], net: [] }
        },
        mcpClientPool
      );

      expect(result.success).toBe(true);
      expect(result).toHaveProperty('samplingCalls');
      expect(result.samplingCalls).toBeDefined();
      expect(result.samplingCalls!.length).toBeGreaterThanOrEqual(1);
      expect(result.samplingCalls![0]).toHaveProperty('response');
      expect(result.samplingCalls![0].response.content[0].text).toBe('Mock Claude response for integration test');
    });

    it('should_supportMultiTurn_when_llmThinkCalledWithMessages', async () => {
      const code = `
messages = [
    {"role": "user", "content": "Hello"},
    {"role": "assistant", "content": "Hi there!"},
    {"role": "user", "content": "How are you?"}
]
response = await llm.think(messages=messages)
print(f"Multi-turn response: {response}")
      `;

      const result = await executePythonInSandbox(
        {
          code,
          allowedTools: [],
          timeoutMs: 10000,
          enableSampling: true,
          permissions: { read: [], write: [], net: [] }
        },
        mcpClientPool
      );

      expect(result.success).toBe(true);
      expect(result.samplingCalls).toBeDefined();
      expect(result.samplingCalls!.length).toBeGreaterThanOrEqual(1);
      expect(result.samplingCalls![0].messages).toHaveLength(3);
      expect(result.samplingCalls![0].response.content[0].text).toBe('Mock Claude response for integration test');
    });
  });

  describe('Sampling Metadata', () => {
    it('should_returnSamplingMetrics_when_executionCompletes', async () => {
      const code = `
        const response1 = await llm.ask("First question");
        const response2 = await llm.ask("Second question");
        console.log("Completed 2 sampling calls");
      `;

      const result = await executeTypescriptInSandbox(
        {
          code,
          allowedTools: [],
          timeoutMs: 10000,
          enableSampling: true,
          permissions: { read: [], write: [], net: [] }
        },
        mcpClientPool
      );

      expect(result.success).toBe(true);
      expect(result).toHaveProperty('samplingMetrics');
      expect(result.samplingMetrics).toBeDefined();
      expect(result.samplingMetrics!.totalRounds).toBe(2);
      expect(result.samplingMetrics!.totalTokens).toBeGreaterThan(0);
      expect(result.samplingMetrics!.averageTokensPerRound).toBeGreaterThan(0);
    });

    it('should_streamChunks_when_streamingEnabled', async () => {
      // Note: Streaming support will be added in T061
      const code = `
        const response = await llm.ask("Test streaming");
        console.log(response);
      `;

      const result = await executeTypescriptInSandbox(
        {
          code,
          allowedTools: [],
          timeoutMs: 10000,
          enableSampling: true,
          streaming: true,
          permissions: { read: [], write: [], net: [] }
        },
        mcpClientPool
      );

      // For now, verify basic functionality works
      // Streaming test will be enhanced when SSE is implemented
      expect(result.success).toBe(true);
      expect(result.samplingCalls).toBeDefined();
    });
  });

  // Additional integration test stubs will be added as implementation progresses
});

