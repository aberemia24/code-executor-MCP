/**
 * Mock MCP Client for testing
 * Provides fake MCP server responses without network calls
 *
 * Type Safety: Uses explicit MockMCPClient interface instead of Partial<Client>
 * to prevent runtime errors from accessing non-mocked methods.
 */

import { vi } from 'vitest';

export interface MockMCPClientOptions {
  name?: string;
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  shouldFail?: boolean;
  responseDelay?: number;
}

/**
 * Type-safe mock MCP client interface
 *
 * Only exposes methods that are actually mocked, preventing
 * runtime errors if test code calls non-existent methods.
 */
export interface MockMCPClient {
  listTools: ReturnType<typeof vi.fn<[], Promise<{ tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> }>>>;
  callTool: ReturnType<typeof vi.fn<[{ name: string; arguments?: Record<string, unknown> }], Promise<{ content: Array<{ type: string; text: string }> }>>>;
}

/**
 * Creates a type-safe mock MCP client for testing
 *
 * @param options - Configuration options for the mock client
 * @returns Mock client instance with stubbed methods (type-safe, no Partial<Client>)
 *
 * @example
 * ```typescript
 * const client = createMockMCPClient({ shouldFail: true });
 * await expect(client.listTools()).rejects.toThrow();
 * ```
 */
export function createMockMCPClient(options: MockMCPClientOptions = {}): MockMCPClient {
  const {
    name = 'test-server',
    tools = [],
    shouldFail = false,
    responseDelay = 0,
  } = options;

  const listTools = vi.fn(async () => {
    if (responseDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, responseDelay));
    }

    if (shouldFail) {
      throw new Error(`MCP server ${name} connection failed`);
    }

    return { tools };
  });

  const callTool = vi.fn(async (request: { name: string; arguments?: Record<string, unknown> }) => {
    if (responseDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, responseDelay));
    }

    if (shouldFail) {
      throw new Error(`Tool execution failed: ${request.name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Mock response for ${request.name}`,
        },
      ],
    };
  });

  return {
    listTools,
    callTool,
  };
}
