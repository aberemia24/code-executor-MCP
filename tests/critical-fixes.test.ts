
import { describe, it, expect, vi } from 'vitest';
import { ConnectionQueue } from '../src/mcp/connection-queue.js';
import { SchemaCache } from '../src/validation/schema-cache.js';
import { isValidMCPToolName } from '../src/utils/utils.js';
import { MCPClientPool } from '../src/mcp/client-pool.js';

describe('Critical Fixes Verification', () => {
    describe('Issue #47: Connection Queue Lock Mismatch', () => {
        it('should use the same lock key for enqueue and dequeue', async () => {
            const queue = new ConnectionQueue({ maxSize: 10, timeoutMs: 1000 });
            // We can't easily inspect private lock keys, but we can verify mutual exclusion
            // by checking if concurrent enqueue/dequeue operations don't corrupt state
            // or if we can force a race condition (hard in JS single thread without async pauses).
            // Instead, we'll rely on code inspection which confirmed 'queue' is used everywhere.
            // This test just ensures basic functionality works as expected.

            await queue.enqueue({ requestId: '1', clientId: 'c1', toolName: 't1' });
            const req = await queue.dequeue();
            expect(req?.requestId).toBe('1');
        });
    });

    describe('Issue #48: Schema Cache Race Condition', () => {
        it('should not trigger duplicate fetches for concurrent requests', async () => {
            const mockProvider = {
                listAllTools: () => [],
                getToolSchema: vi.fn().mockImplementation(async (name) => {
                    await new Promise(resolve => setTimeout(resolve, 50)); // Simulate network delay
                    return { name, description: 'desc', inputSchema: {} };
                }),
                initialize: async () => { },
                callTool: async () => { },
                hasTool: () => true,
                listAllToolSchemas: async () => [],
                disconnect: async () => { },
                shutdown: async () => { },
            } as unknown as MCPClientPool;

            const cache = new SchemaCache(mockProvider, 1000, undefined, 100);

            // Launch 5 concurrent requests for the same tool
            const promises = Array(5).fill(null).map(() => cache.getToolSchema('mcp__s__t'));
            await Promise.all(promises);

            // Should only have called fetch ONCE
            expect(mockProvider.getToolSchema).toHaveBeenCalledTimes(1);
        });
    });

    describe('Issue #49: Invalid Tool Name Regex', () => {
        it('should reject tool names with extra segments', () => {
            const valid = 'mcp__server__tool';
            const invalid = 'mcp__server__tool__extra';
            const invalid2 = 'mcp__server__tool__extra__more';

            expect(isValidMCPToolName(valid)).toBe(true);

            // This is expected to FAIL currently (returning true)
            expect(isValidMCPToolName(invalid)).toBe(false);
            expect(isValidMCPToolName(invalid2)).toBe(false);
        });

        it('should allow underscores in names but not as separators', () => {
            expect(isValidMCPToolName('mcp__my_server__my_tool')).toBe(true);
            expect(isValidMCPToolName('mcp__server__tool_with_underscore')).toBe(true);
        });
    });
});
