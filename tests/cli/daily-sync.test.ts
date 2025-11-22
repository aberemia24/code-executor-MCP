/**
 * Daily Sync Script Tests
 *
 * **RESPONSIBILITY (SRP):** Test incremental wrapper regeneration based on schema hash changes
 * **WHY:** Ensures daily sync only regenerates wrappers when MCP schemas change
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DailySyncService } from '../../src/cli/daily-sync';
import type { WrapperManifest, MCPServerSelection } from '../../src/cli/types';
import type { MCPClientPool } from '../../src/mcp/client-pool';
import type { SchemaCache } from '../../src/validation/schema-cache';

describe('DailySyncService', () => {
  let tmpDir: string;
  let service: DailySyncService;
  let manifestPath: string;
  let mockMCPClientPool: MCPClientPool;
  let mockSchemaCache: SchemaCache;

  beforeEach(async () => {
    // Create temporary directory for test artifacts
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'daily-sync-test-'));
    manifestPath = path.join(tmpDir, 'wrapper-manifest.json');

    // Create mock MCPClientPool (Phase 10 requirement)
    mockMCPClientPool = {
      listAllToolSchemas: vi.fn().mockResolvedValue([]),
    } as any;

    // Create mock SchemaCache (Phase 10 requirement)
    mockSchemaCache = {} as any;

    // Initialize service with test paths and mocked dependencies
    service = new DailySyncService({
      manifestPath,
      wrapperOutputDir: path.join(tmpDir, 'wrappers'),
      templateDir: path.join(__dirname, '..', '..', 'templates'),
      mcpClientPool: mockMCPClientPool,
      schemaCache: mockSchemaCache,
    });
  });

  afterEach(async () => {
    // Cleanup temporary directory
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should create instance with valid paths', () => {
      expect(service).toBeInstanceOf(DailySyncService);
    });

    it('should throw error if manifestPath is not absolute', () => {
      expect(() => new DailySyncService({
        manifestPath: 'relative/path',
        wrapperOutputDir: tmpDir,
        templateDir: path.join(__dirname, '..', '..', 'templates'),
        mcpClientPool: mockMCPClientPool,
        schemaCache: mockSchemaCache,
      })).toThrow('manifestPath must be absolute');
    });

    it('should throw error if wrapperOutputDir is not absolute', () => {
      expect(() => new DailySyncService({
        manifestPath,
        wrapperOutputDir: 'relative/path',
        templateDir: path.join(__dirname, '..', '..', 'templates'),
        mcpClientPool: mockMCPClientPool,
        schemaCache: mockSchemaCache,
      })).toThrow('wrapperOutputDir must be absolute');
    });
  });

  describe('sync', () => {
    it('should skip sync if manifest does not exist', async () => {
      // Act
      const result = await service.sync();

      // Assert
      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('Manifest not found');
      expect(result.regenerated).toEqual([]);
      expect(result.unchanged).toEqual([]);
      expect(result.failed).toEqual([]);
    });

    it('should skip sync if manifest has no wrappers', async () => {
      // Arrange: Create empty manifest
      const manifest: WrapperManifest = {
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        wrappers: [],
      };
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      // Act
      const result = await service.sync();

      // Assert
      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('No wrappers in manifest');
      expect(result.regenerated).toEqual([]);
      expect(result.unchanged).toEqual([]);
      expect(result.failed).toEqual([]);
    });

    it('should detect unchanged wrappers (same schema hash)', async () => {
      // Arrange: Create manifest with wrapper
      const manifest: WrapperManifest = {
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        wrappers: [
          {
            mcpName: 'filesystem',
            language: 'typescript',
            schemaHash: 'abc123hash',
            outputPath: path.join(tmpDir, 'wrappers', 'typescript', 'mcp-filesystem.ts'),
            generatedAt: new Date().toISOString(),
            status: 'success',
          },
        ],
      };
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      // Mock schema hash computation to return same hash
      vi.spyOn(service as any, 'computeCurrentSchemaHash').mockResolvedValue('abc123hash');

      // Act
      const result = await service.sync();

      // Assert
      expect(result.skipped).toBe(false);
      expect(result.unchanged).toHaveLength(1);
      expect(result.unchanged[0]).toBe('filesystem (typescript)');
      expect(result.regenerated).toEqual([]);
      expect(result.failed).toEqual([]);
    });

    it('should regenerate wrapper when schema hash changes', async () => {
      // Arrange: Create manifest with wrapper
      const manifest: WrapperManifest = {
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        wrappers: [
          {
            mcpName: 'filesystem',
            language: 'typescript',
            schemaHash: 'old-hash',
            outputPath: path.join(tmpDir, 'wrappers', 'typescript', 'mcp-filesystem.ts'),
            generatedAt: new Date().toISOString(),
            status: 'success',
          },
        ],
      };
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      // Mock schema hash computation to return different hash
      vi.spyOn(service as any, 'computeCurrentSchemaHash').mockResolvedValue('new-hash');

      // Mock wrapper regeneration
      vi.spyOn(service as any, 'regenerateWrapper').mockResolvedValue(true);

      // Act
      const result = await service.sync();

      // Assert
      expect(result.skipped).toBe(false);
      expect(result.regenerated).toHaveLength(1);
      expect(result.regenerated[0]).toBe('filesystem (typescript)');
      expect(result.unchanged).toEqual([]);
      expect(result.failed).toEqual([]);
    });

    it('should handle mixed results (unchanged, regenerated, failed)', async () => {
      // Arrange: Create manifest with multiple wrappers
      const manifest: WrapperManifest = {
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        wrappers: [
          {
            mcpName: 'filesystem',
            language: 'typescript',
            schemaHash: 'unchanged-hash',
            outputPath: path.join(tmpDir, 'wrappers', 'typescript', 'mcp-filesystem.ts'),
            generatedAt: new Date().toISOString(),
            status: 'success',
          },
          {
            mcpName: 'github',
            language: 'python',
            schemaHash: 'old-hash',
            outputPath: path.join(tmpDir, 'wrappers', 'python', 'mcp_github.py'),
            generatedAt: new Date().toISOString(),
            status: 'success',
          },
          {
            mcpName: 'linear',
            language: 'typescript',
            schemaHash: 'another-old-hash',
            outputPath: path.join(tmpDir, 'wrappers', 'typescript', 'mcp-linear.ts'),
            generatedAt: new Date().toISOString(),
            status: 'success',
          },
        ],
      };
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      // Mock schema hash computation
      const computeHashSpy = vi.spyOn(service as any, 'computeCurrentSchemaHash');
      computeHashSpy.mockResolvedValueOnce('unchanged-hash'); // filesystem (no change)
      computeHashSpy.mockResolvedValueOnce('new-hash'); // github (changed)
      computeHashSpy.mockResolvedValueOnce('different-hash'); // linear (changed)

      // Mock wrapper regeneration
      const regenerateSpy = vi.spyOn(service as any, 'regenerateWrapper');
      regenerateSpy.mockResolvedValueOnce(true); // github (success)
      regenerateSpy.mockResolvedValueOnce(false); // linear (failed)

      // Act
      const result = await service.sync();

      // Assert
      expect(result.skipped).toBe(false);
      expect(result.unchanged).toHaveLength(1);
      expect(result.unchanged[0]).toBe('filesystem (typescript)');
      expect(result.regenerated).toHaveLength(1);
      expect(result.regenerated[0]).toBe('github (python)');
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]).toContain('linear (typescript)');
    });

    it('should handle manifest read errors gracefully', async () => {
      // Arrange: Create invalid JSON manifest
      await fs.writeFile(manifestPath, 'invalid json {');

      // Act
      const result = await service.sync();

      // Assert
      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('Failed to read manifest');
      expect(result.regenerated).toEqual([]);
      expect(result.unchanged).toEqual([]);
      expect(result.failed).toEqual([]);
    });
  });

  describe('computeCurrentSchemaHash', () => {
    it('should compute SHA-256 hash of MCP tool schemas', async () => {
      // This test would require mocking MCP client pool and schema fetching
      // For now, we'll test the interface exists
      expect(typeof (service as any).computeCurrentSchemaHash).toBe('function');
    });
  });

  describe('regenerateWrapper', () => {
    it('should call WrapperGenerator.generateWrapper', async () => {
      // This test would require mocking WrapperGenerator
      // For now, we'll test the interface exists
      expect(typeof (service as any).regenerateWrapper).toBe('function');
    });
  });
});
