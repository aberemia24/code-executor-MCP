import { vi } from 'vitest';

/**
 * Mock MCP Server for Sampling Tests
 *
 * Simulates Claude API responses for testing sampling functionality.
 * Provides consistent, deterministic responses for test reliability.
 */
export class MockClaudeSamplingServer {
  private callCount = 0;
  private responses: Array<{
    content: Array<{ type: 'text'; text: string }>;
    stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence';
    usage: { inputTokens: number; outputTokens: number };
  }> = [
    // Response 1: Simple greeting
    {
      content: [{ type: 'text', text: 'Hello! How can I help you today?' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 5, outputTokens: 8 }
    },
    // Response 2: Code analysis
    {
      content: [{ type: 'text', text: 'This appears to be a well-structured function with proper error handling and type safety.' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 25, outputTokens: 15 }
    },
    // Response 3: Technical explanation
    {
      content: [{ type: 'text', text: 'The sampling bridge server acts as a proxy between the sandbox environment and the Claude API, implementing security controls like rate limiting and content filtering.' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 20, outputTokens: 28 }
    },
    // Response 4: JSON response
    {
      content: [{ type: 'text', text: '{"analysis": "The code follows SOLID principles", "score": 9, "recommendations": ["Consider adding more unit tests"]}' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 15, outputTokens: 22 }
    },
    // Response 5: Long response for token testing
    {
      content: [{ type: 'text', text: 'This is a longer response designed to test token consumption. '.repeat(50) }],
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 150 }
    },
    // Response 6: Error simulation
    {
      content: [{ type: 'text', text: 'I apologize, but I encountered an error processing your request.' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 8, outputTokens: 12 }
    },
    // Response 7: Multi-part response
    {
      content: [
        { type: 'text', text: 'Let me break this down into steps:' },
        { type: 'text', text: '1. First, understand the requirements' },
        { type: 'text', text: '2. Design the solution architecture' },
        { type: 'text', text: '3. Implement the core functionality' }
      ],
      stopReason: 'end_turn',
      usage: { inputTokens: 12, outputTokens: 35 }
    },
    // Response 8: Secret-containing response (for testing content filter)
    {
      content: [{ type: 'text', text: 'Here\'s an example API key for documentation: sk-abc123def456ghi789jkl012mn' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 18, outputTokens: 14 }
    },
    // Response 9: PII-containing response (for testing content filter)
    {
      content: [{ type: 'text', text: 'Contact information: user@example.com, SSN: 123-45-6789' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 16, outputTokens: 13 }
    },
    // Response 10: Max tokens response
    {
      content: [{ type: 'text', text: 'This response is truncated because it reached the maximum token limit. The model would continue if given more tokens...' }],
      stopReason: 'max_tokens',
      usage: { inputTokens: 30, outputTokens: 100 }
    }
  ];

  /**
   * Mock request method that simulates MCP SDK behavior
   */
  async request(params: any) {
    this.callCount++;

    // Simulate network delay (50-100ms)
    await new Promise(resolve => setTimeout(resolve, Math.random() * 50 + 50));

    // Cycle through responses or return last one
    const responseIndex = Math.min(this.callCount - 1, this.responses.length - 1);
    const response = this.responses[responseIndex];

    // Add some randomness to token counts for realism
    const inputVariation = Math.floor(Math.random() * 10) - 5;
    const outputVariation = Math.floor(Math.random() * 20) - 10;

    return {
      ...response,
      usage: {
        inputTokens: Math.max(1, response.usage.inputTokens + inputVariation),
        outputTokens: Math.max(1, response.usage.outputTokens + outputVariation)
      }
    };
  }

  /**
   * Reset call count for test isolation
   */
  reset() {
    this.callCount = 0;
  }

  /**
   * Get current call count
   */
  getCallCount() {
    return this.callCount;
  }

  /**
   * Mock error responses for testing error handling
   */
  async simulateError(errorType: 'network' | 'api' | 'timeout' | 'rate_limit') {
    await new Promise(resolve => setTimeout(resolve, 50));

    switch (errorType) {
      case 'network':
        throw new Error('Network connection failed');
      case 'api':
        throw new Error('Claude API returned an error: Invalid request parameters');
      case 'timeout':
        throw new Error('Request timeout: Sampling call exceeded 30s timeout');
      case 'rate_limit':
        throw new Error('Rate limit exceeded: Too many requests');
      default:
        throw new Error('Unknown error');
    }
  }
}

/**
 * Factory function to create mock MCP server
 */
export function createMockMcpServer() {
  return new MockClaudeSamplingServer();
}

/**
 * Vitest mock utilities for MCP SDK
 */
export const mockMcpSdk = {
  Server: vi.fn().mockImplementation(() => ({
    setRequestHandler: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined)
  })),

  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    request: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined)
  }))
};

