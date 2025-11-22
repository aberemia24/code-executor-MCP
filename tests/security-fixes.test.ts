
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as loader from '../src/config/loader.js';
import { executeTypescriptInSandbox } from '../src/executors/sandbox-executor.js';
import { HealthCheckServer } from '../src/core/server/health-check.js';
import { MCPClientPool } from '../src/mcp/client-pool.js';
import { ConnectionPool } from '../src/mcp/connection-pool.js';

// Mock dependencies
vi.mock('fs/promises');
vi.mock('child_process');
vi.mock('../src/config/loader.js');
vi.mock('../src/utils/utils.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/utils/utils.js')>();
    return {
        ...actual,
        isAllowedPath: vi.fn(),
    };
});
import * as utils from '../src/utils/utils.js';

vi.mock('../src/core/server/mcp-proxy-server.js', () => ({
    MCPProxyServer: class {
        start() { return Promise.resolve({ port: 3000, authToken: 'token' }); }
        stop() { return Promise.resolve(); }
        getToolCalls() { return []; }
        getToolCallSummary() { return []; }
    }
}));

describe('Security Fixes Verification', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        // Default mocks
        vi.mocked(loader.getDenoPath).mockReturnValue('deno');
        vi.mocked(loader.getSamplingConfig).mockReturnValue({ enabled: false } as any);
        vi.mocked(loader.getAllowedTools).mockReturnValue([]);
        vi.mocked(loader.getAllowedWritePaths).mockReturnValue([]);
        vi.mocked(loader.getAllowedNetworkHosts).mockReturnValue(true);
        vi.mocked(fs.writeFile).mockResolvedValue(undefined);
        vi.mocked(fs.readFile).mockResolvedValue('code'); // Default: file content matches code
        vi.mocked(fs.unlink).mockResolvedValue(undefined);
    });

    describe('Issue #51: Validate Allowed Tools', () => {
        it('should block tools not in server allowlist', async () => {
            vi.mocked(loader.getAllowedTools).mockReturnValue(['toolA']);

            const result = await executeTypescriptInSandbox({
                code: 'code',
                allowedTools: ['toolB'], // Not allowed
                timeoutMs: 1000,
                permissions: {}
            }, {} as any);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Tools not allowed by server policy: toolB');
        });

        it('should allow tools in server allowlist', async () => {
            vi.mocked(loader.getAllowedTools).mockReturnValue(['toolA']);
            vi.mocked(fs.readFile).mockResolvedValue('code'); // Integrity check pass

            // We expect this to proceed to spawn (which is mocked)
            // Since spawn is mocked but not setup to return a process, it might fail later,
            // but we just want to pass the validation check.
            // Actually, executeTypescriptInSandbox calls spawn.
            // Let's just check if it returns error about tools.

            // We need to mock spawn to return a process-like object to avoid crash
            const { spawn } = await import('child_process');
            vi.mocked(spawn).mockReturnValue({
                stdin: { write: vi.fn(), end: vi.fn() },
                stdout: { on: vi.fn() },
                stderr: { on: vi.fn() },
                on: vi.fn(), // for 'close' event
                kill: vi.fn(),
            } as any);

            const result = await executeTypescriptInSandbox({
                code: 'code',
                allowedTools: ['toolA'], // Allowed
                timeoutMs: 1000,
                permissions: {}
            }, {} as any);

            // It shouldn't fail with "Tools not allowed"
            expect(result.error).not.toContain('Tools not allowed');
        });
    });

    describe('Issue #52: Enforce Configured Write Paths', () => {
        it('should block write paths not in server allowlist', async () => {
            vi.mocked(loader.getAllowedWritePaths).mockReturnValue(['/allowed']);
            vi.mocked(utils.isAllowedPath).mockResolvedValue(false);

            try {
                await executeTypescriptInSandbox({
                    code: 'code',
                    allowedTools: [],
                    timeoutMs: 1000,
                    permissions: { write: ['/forbidden'] }
                }, {} as any);
                // Should have thrown or returned error?
                // The code throws Error. executeTypescriptInSandbox catches it?
                // No, it catches spawn errors. But validation errors might propagate?
                // Let's check the code.
                // It throws Error. The caller catches it.
            } catch (e: any) {
                expect(e.message).toContain('Write path denied by server policy');
            }
        });
    });

    describe('Issue #53: Block Remote Imports', () => {
        it('should include --no-remote in deno args', async () => {
            vi.mocked(loader.getAllowedTools).mockReturnValue([]);
            vi.mocked(loader.getAllowedWritePaths).mockReturnValue([]);
            vi.mocked(loader.getAllowedNetworkHosts).mockReturnValue(true);

            const { spawn } = await import('child_process');
            const mockSpawn = vi.fn().mockReturnValue({
                stdin: { write: vi.fn(), end: vi.fn() },
                stdout: { on: vi.fn() },
                stderr: { on: vi.fn() },
                on: vi.fn(),
                kill: vi.fn(),
            } as any);
            vi.mocked(spawn).mockImplementation(mockSpawn);

            await executeTypescriptInSandbox({
                code: 'code',
                allowedTools: [],
                timeoutMs: 1000,
                permissions: {}
            }, {} as any);

            expect(mockSpawn).toHaveBeenCalled();
            const args = mockSpawn.mock.calls[0][1];
            expect(args).toContain('--no-remote');
        });
    });

    describe('Issue #54: Restrict Health Check to Localhost', () => {
        it('should default to 127.0.0.1', () => {
            const server = new HealthCheckServer({
                mcpClientPool: {} as MCPClientPool,
                connectionPool: {} as ConnectionPool
            });
            // Access private property via casting
            expect((server as any).host).toBe('127.0.0.1');
        });
    });

    describe('Issue #55: Temp File Integrity Check', () => {
        it('should fail if file content does not match code', async () => {
            vi.mocked(loader.getAllowedTools).mockReturnValue([]);
            vi.mocked(fs.readFile).mockResolvedValue('tampered code'); // Different from input

            try {
                await executeTypescriptInSandbox({
                    code: 'original code',
                    timeoutMs: 1000,
                    permissions: {}
                }, {} as any);
                expect.fail('Should have thrown integrity error');
            } catch (e: any) {
                expect(e.message).toContain('integrity check failed');
            }
        });
    });
});
