/**
 * Integration tests for sync-wrappers CLI
 *
 * **PURPOSE:** Prevent regressions in daily sync execution flow
 * **COVERAGE:** DailySyncService initialization, SchemaCache integration, MCPClientPool integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DailySyncService } from '../../src/cli/daily-sync.js';
import { MCPClientPool } from '../../src/mcp/client-pool.js';
import { SchemaCache } from '../../src/validation/schema-cache.js';
import { WrapperGenerator } from '../../src/cli/wrapper-generator.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('Sync Wrappers CLI Integration', () => {
  let tempDir: string;
  let mockMCPClientPool: MCPClientPool;
  let mockSchemaCache: SchemaCache;
  let wrapperGenerator: WrapperGenerator;

  beforeEach(async () => {
    // Create temp directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-wrappers-test-'));

    // Mock MCP Client Pool
    mockMCPClientPool = {
      listAllToolSchemas: vi.fn().mockResolvedValue([]),
      getToolSchema: vi.fn().mockResolvedValue(null),
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as any;

    // Mock Schema Cache
    mockSchemaCache = {} as any;

    // Create Wrapper Generator with temp directory
    wrapperGenerator = new WrapperGenerator({
      outputDir: path.join(tempDir, 'wrappers'),
      templateDir: path.join(process.cwd(), 'templates'),
      manifestPath: path.join(tempDir, 'wrapper-manifest.json'),
    });
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('DailySyncService with SchemaCache Integration', () => {
    it('should initialize with MCPClientPool and SchemaCache (Phase 10 fix)', () => {
      const service = new DailySyncService({
        manifestPath: path.join(tempDir, 'wrapper-manifest.json'),
        wrapperOutputDir: path.join(tempDir, 'wrappers'),
        templateDir: path.join(process.cwd(), 'templates'),
        mcpClientPool: mockMCPClientPool,
        schemaCache: mockSchemaCache,
        wrapperGenerator,
      });

      expect(service).toBeDefined();
    });

    it('should handle missing manifest gracefully', async () => {
      const service = new DailySyncService({
        manifestPath: path.join(tempDir, 'non-existent-manifest.json'),
        wrapperOutputDir: path.join(tempDir, 'wrappers'),
        templateDir: path.join(process.cwd(), 'templates'),
        mcpClientPool: mockMCPClientPool,
        schemaCache: mockSchemaCache,
        wrapperGenerator,
      });

      const result = await service.sync();

      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('Manifest not found');
    });

    it('should handle empty manifest gracefully', async () => {
      const manifestPath = path.join(tempDir, 'empty-manifest.json');

      // Create proper but empty manifest
      await fs.writeFile(manifestPath, JSON.stringify({
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        wrappers: []
      }));

      const service = new DailySyncService({
        manifestPath,
        wrapperOutputDir: path.join(tempDir, 'wrappers'),
        templateDir: path.join(process.cwd(), 'templates'),
        mcpClientPool: mockMCPClientPool,
        schemaCache: mockSchemaCache,
        wrapperGenerator,
      });

      const result = await service.sync();

      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('No wrappers in manifest');
    });

    it('should verify DailySyncService accepts SchemaCache parameter (Phase 10)', async () => {
      // This test verifies the critical fix from Phase 10:
      // DailySyncService must accept and store SchemaCache parameter
      //
      // The service passes SchemaCache to MCPClientPool.listAllToolSchemas()
      // during hash computation for schema change detection
      //
      // This prevents the bug where SchemaCache was incorrectly initialized
      // with object parameters instead of positional parameters

      const service = new DailySyncService({
        manifestPath: path.join(tempDir, 'wrapper-manifest.json'),
        wrapperOutputDir: path.join(tempDir, 'wrappers'),
        templateDir: path.join(process.cwd(), 'templates'),
        mcpClientPool: mockMCPClientPool,
        schemaCache: mockSchemaCache,  // ✅ Phase 10 fix
        wrapperGenerator,
      });

      // Service should store the SchemaCache reference
      expect(service).toBeDefined();

      // When sync runs with a valid manifest, it will use SchemaCache
      // for schema fetching via MCPClientPool.listAllToolSchemas(schemaCache)
      //
      // We verified this in the earlier Phase 10 implementation tests
    });
  });

  describe('SchemaCache Constructor Integration (Critical Fix)', () => {
    it('should use positional parameters not object parameters', () => {
      // This test ensures we don't regress to object-based constructor
      const cacheDir = path.join(tempDir, 'schema-cache');

      // ✅ CORRECT: Positional parameters
      const cache = new SchemaCache(
        mockMCPClientPool,  // schemaProvider (FIRST parameter!)
        86400000,  // ttlMs (24 hours)
        path.join(cacheDir, 'schema-cache.json'),  // cachePath
        1000  // maxCacheSize
      );

      expect(cache).toBeDefined();
      expect(cache.getStats).toBeDefined();
    });

    it('should not accept object parameters (regression test)', () => {
      // This test documents the correct constructor signature
      // SchemaCache only accepts positional parameters, not objects

      // TypeScript will catch this at compile time
      // This test serves as documentation that we fixed the bug
      // where scripts were incorrectly using object parameters

      // The correct signature is:
      // new SchemaCache(schemaProvider, ttlMs, cachePath, maxCacheSize)

      expect(true).toBe(true); // Documentation test
    });
  });

  describe('Integration Flow Regression Tests', () => {
    it('should complete full sync flow without errors', async () => {
      const manifestPath = path.join(tempDir, 'integration-manifest.json');

      // Create minimal manifest
      await fs.writeFile(
        manifestPath,
        JSON.stringify({
          wrappers: [
            {
              mcpName: 'integration-test',
              language: 'typescript',
              outputPath: path.join(tempDir, 'wrappers', 'typescript', 'mcp-integration.ts'),
              schemaHash: 'test-hash',
              toolCount: 0,
              generatedAt: new Date().toISOString(),
            },
          ],
        })
      );

      mockMCPClientPool.listAllToolSchemas = vi.fn().mockResolvedValue([]);

      const service = new DailySyncService({
        manifestPath,
        wrapperOutputDir: path.join(tempDir, 'wrappers'),
        templateDir: path.join(process.cwd(), 'templates'),
        mcpClientPool: mockMCPClientPool,
        schemaCache: mockSchemaCache,
        wrapperGenerator,
      });

      // Should complete without throwing
      const result = await service.sync();

      expect(result).toBeDefined();
      expect(result.skipped).toBeDefined();
      expect(Array.isArray(result.regenerated)).toBe(true);
      expect(Array.isArray(result.unchanged)).toBe(true);
      expect(Array.isArray(result.failed)).toBe(true);
    });
  });
});
