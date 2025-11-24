
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { WrapperGenerator } from '../src/cli/wrapper-generator.js';
import { executeTypescriptInSandbox } from '../src/executors/sandbox-executor.js';
import { MCPClientPool } from '../src/mcp/client-pool.js';
import { ToolSchema } from '../src/cli/types.js';

describe('Sandbox Wrapper Integration', () => {
    const testDir = path.join(os.tmpdir(), 'sandbox-test-' + Date.now());
    const wrappersDir = path.join(testDir, 'wrappers');
    const sandboxWrappersDir = path.join(wrappersDir, 'sandbox');

    // Mock MCP Client Pool
    const mockClientPool = {
        getTool: vi.fn(),
        callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'success' }] }),
        listTools: vi.fn().mockResolvedValue([]),
        getConnections: vi.fn().mockReturnValue([]),
    } as unknown as MCPClientPool;

    beforeAll(async () => {
        await fs.mkdir(testDir, { recursive: true });

        // Mock os.homedir to point to testDir for this test suite
        // This is tricky because os.homedir is used in many places.
        // Instead, we'll rely on the fact that we can pass outputDir to WrapperGenerator
        // BUT SandboxExecutor uses os.homedir() to find wrappers.
        // So we must mock os.homedir() or modify SandboxExecutor to accept a wrapper path override.
        // Given the constraints, mocking os.homedir() via vi.spyOn is best if possible, 
        // but os is a native module.
        // Alternatively, we can just use the real homedir but use a unique subdirectory? 
        // No, that pollutes the user's system.

        // Let's use the fact that we modified SandboxExecutor to look at ~/.code-executor/wrappers/sandbox
        // We can't easily change that path in the test without DI or config.
        // However, for this test, we can try to mock fs.access/readFile to return our test content
        // when it tries to read from the real homedir path.
    });

    afterAll(async () => {
        await fs.rm(testDir, { recursive: true, force: true });
    });

    it('should generate sandbox wrapper and import map', async () => {
        const generator = new WrapperGenerator({
            outputDir: wrappersDir,
            templateDir: path.join(process.cwd(), 'templates'),
        });

        const mockTools: ToolSchema[] = [{
            name: 'test_tool',
            description: 'A test tool',
            inputSchema: {
                type: 'object',
                properties: {
                    arg: { type: 'string' }
                },
                required: ['arg']
            }
        }];

        const result = await generator.generateSandboxWrapper({
            name: 'test-server',
            tools: mockTools,
            type: 'STDIO',
            status: 'online',
            sourceConfig: ''
        });

        expect(result.success).toBe(true);

        // Verify wrapper file exists
        const wrapperPath = path.join(sandboxWrappersDir, 'mcp-test-server.ts');
        const wrapperContent = await fs.readFile(wrapperPath, 'utf-8');
        expect(wrapperContent).toContain('export async function testTool');
        expect(wrapperContent).toContain("return await callMCPTool('test_tool', params);");

        // Generate import map
        await generator.generateImportMap(['test-server']);

        // Verify import map
        const importMapPath = path.join(sandboxWrappersDir, 'import_map.json');
        const importMap = JSON.parse(await fs.readFile(importMapPath, 'utf-8'));
        expect(importMap.imports['mcp/']).toBe('./');
    });
});
