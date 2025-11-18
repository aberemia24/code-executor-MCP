import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { WrapperGenerator } from '../../src/cli/wrapper-generator';
import type { MCPServerSelection, WrapperManifest } from '../../src/cli/types';

describe('WrapperGenerator', () => {
  let generator: WrapperGenerator;
  let testOutputDir: string;
  let testTemplateDir: string;

  beforeEach(async () => {
    // Create temp directories for testing
    testOutputDir = path.join(__dirname, '..', '..', '.test-output', 'wrappers');
    testTemplateDir = path.join(__dirname, '..', '..', 'templates');

    await fs.mkdir(testOutputDir, { recursive: true });

    generator = new WrapperGenerator({
      outputDir: testOutputDir,
      templateDir: testTemplateDir,
    });
  });

  afterEach(async () => {
    // Clean up test files
    await fs.rm(testOutputDir, { recursive: true, force: true });
  });

  describe('Security Tests (CVE-2021-23369)', () => {
    it('should_blockTemplateInjection_when_maliciousMCPName', async () => {
      // Arrange: MCP with malicious name containing template injection
      const maliciousMCP: MCPServerSelection = {
        name: '{{process.exit()}}', // Template injection attempt in MCP name
        description: 'Test MCP',
        type: 'STDIO',
        status: 'online',
        toolCount: 1,
        sourceConfig: '/test/config.json',
        tools: [
          {
            name: 'safe_tool',
            description: 'Safe tool',
            parameters: {
              type: 'object',
              properties: {},
            },
          },
        ],
      };

      // Act & Assert: Should reject during validation (path traversal prevention)
      await expect(
        generator.generateWrapper(maliciousMCP, 'typescript', 'esm')
      ).rejects.toThrow(/invalid.*name|path.*traversal/i);
    });

    it('should_escapeHandlebarsCode_when_maliciousCodeInDescription', async () => {
      const maliciousMCP: MCPServerSelection = {
        name: 'test',
        description: '{{#with process}}{{exit}}{{/with}}', // Helper injection attempt
        type: 'STDIO',
        status: 'online',
        toolCount: 1,
        sourceConfig: '/test/config.json',
        tools: [
          {
            name: 'test_tool',
            description: 'Safe description',
            parameters: {
              type: 'object',
              properties: {},
            },
          },
        ],
      };

      // Should not execute injected helpers (Handlebars auto-escaping)
      const result = await generator.generateWrapper(maliciousMCP, 'typescript', 'esm');

      expect(result.success).toBe(true);

      const content = await fs.readFile(result.outputPath, 'utf-8');

      // Verify Handlebars helpers are escaped as literal text
      expect(content).toContain('{{#with process}}{{exit}}{{/with}}'); // Should be escaped
      expect(content).not.toMatch(/process\.exit/); // Should not execute
    });

    it('should_useHandlebarsVersion_greaterThan_4.7.7', async () => {
      // Verify Handlebars version is patched
      const handlebars = require('handlebars');
      const version = handlebars.VERSION;
      const [major, minor, patch] = version.split('.').map(Number);

      // Must be >= 4.7.7 to fix CVE-2021-23369
      expect(major).toBeGreaterThanOrEqual(4);
      if (major === 4) {
        expect(minor).toBeGreaterThanOrEqual(7);
        if (minor === 7) {
          expect(patch).toBeGreaterThanOrEqual(7);
        }
      }
    });

    it('should_enableAutoEscaping_when_compilingTemplates', async () => {
      // Verify Handlebars is configured with auto-escaping enabled
      const handlebars = require('handlebars');

      // Create test template with HTML
      const template = handlebars.compile('<div>{{userInput}}</div>');
      const result = template({ userInput: '<script>alert("XSS")</script>' });

      // Should escape HTML by default
      expect(result).toBe('<div>&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;</div>');
    });

    it('should_preventPathTraversal_when_generatingOutputPath', async () => {
      const maliciousMCP: MCPServerSelection = {
        name: '../../../etc/passwd', // Path traversal attempt
        description: 'Test',
        type: 'STDIO',
        status: 'online',
        toolCount: 0,
        sourceConfig: '/test/config.json',
        tools: [],
      };

      // Should sanitize MCP name before creating file path
      await expect(
        generator.generateWrapper(maliciousMCP, 'typescript', 'esm')
      ).rejects.toThrow(/invalid.*name|path.*traversal/i);
    });
  });

  describe('Happy Path - TypeScript Wrapper Generation', () => {
    it('should_generateValidTypeScript_when_validMCPProvided', async () => {
      // Arrange
      const validMCP: MCPServerSelection = {
        name: 'filesystem',
        description: 'File system operations',
        type: 'STDIO',
        status: 'online',
        toolCount: 2,
        sourceConfig: '/test/config.json',
        tools: [
          {
            name: 'mcp__filesystem__read_file',
            description: 'Read file contents',
            parameters: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'File path to read',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'mcp__filesystem__write_file',
            description: 'Write file contents',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path to write' },
                content: { type: 'string', description: 'File content' },
              },
              required: ['path', 'content'],
            },
          },
        ],
      };

      // Act
      const result = await generator.generateWrapper(validMCP, 'typescript', 'esm');

      // Assert
      expect(result.success).toBe(true);
      expect(result.outputPath).toContain('mcp-filesystem.ts');
      expect(result.language).toBe('typescript');

      // Verify file exists
      const fileExists = await fs.access(result.outputPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      // Verify content structure
      const content = await fs.readFile(result.outputPath, 'utf-8');
      expect(content).toContain('Generated MCP Wrapper: filesystem');
      expect(content).toContain('export async function filesystem_readFile');
      expect(content).toContain('export async function filesystem_writeFile');
      expect(content).toContain('ExecutionResult');
    });

    it('should_generateESMSyntax_when_moduleFormatESM', async () => {
      const mcp: MCPServerSelection = {
        name: 'test',
        type: 'STDIO',
        status: 'online',
        toolCount: 1,
        sourceConfig: '/test/config.json',
        tools: [
          {
            name: 'test_tool',
            description: 'Test',
            parameters: { type: 'object', properties: {} },
          },
        ],
      };

      const result = await generator.generateWrapper(mcp, 'typescript', 'esm');
      const content = await fs.readFile(result.outputPath, 'utf-8');

      expect(content).toContain('import type');
      expect(content).not.toContain('require(');
    });

    it('should_generateCommonJSSyntax_when_moduleFormatCommonJS', async () => {
      const mcp: MCPServerSelection = {
        name: 'test',
        type: 'STDIO',
        status: 'online',
        toolCount: 1,
        sourceConfig: '/test/config.json',
        tools: [
          {
            name: 'test_tool',
            description: 'Test',
            parameters: { type: 'object', properties: {} },
          },
        ],
      };

      const result = await generator.generateWrapper(mcp, 'typescript', 'commonjs');
      const content = await fs.readFile(result.outputPath, 'utf-8');

      expect(content).toContain('require(');
      expect(content).toContain('module.exports');
    });
  });

  describe('Happy Path - Python Wrapper Generation', () => {
    it('should_generateValidPython_when_validMCPProvided', async () => {
      const validMCP: MCPServerSelection = {
        name: 'filesystem',
        description: 'File system operations',
        type: 'STDIO',
        status: 'online',
        toolCount: 1,
        sourceConfig: '/test/config.json',
        tools: [
          {
            name: 'mcp__filesystem__read_file',
            description: 'Read file contents',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path' },
              },
              required: ['path'],
            },
          },
        ],
      };

      const result = await generator.generateWrapper(validMCP, 'python', 'esm');

      expect(result.success).toBe(true);
      expect(result.outputPath).toContain('mcp_filesystem.py');
      expect(result.language).toBe('python');

      const content = await fs.readFile(result.outputPath, 'utf-8');
      expect(content).toContain('Generated MCP Wrapper: filesystem');
      expect(content).toContain('class FilesystemClient');
      expect(content).toContain('def read_file(');
      expect(content).toContain('ExecutionResult');
    });
  });

  describe('Edge Cases', () => {
    it('should_handleEmptyToolList_when_MCPHasNoTools', async () => {
      const emptyMCP: MCPServerSelection = {
        name: 'empty',
        type: 'STDIO',
        status: 'online',
        toolCount: 0,
        sourceConfig: '/test/config.json',
        tools: [],
      };

      const result = await generator.generateWrapper(emptyMCP, 'typescript', 'esm');

      expect(result.success).toBe(true);
      const content = await fs.readFile(result.outputPath, 'utf-8');
      expect(content).toContain('Available Tools: 0');
    });

    it('should_handleNestedParameters_when_complexSchema', async () => {
      const complexMCP: MCPServerSelection = {
        name: 'complex',
        type: 'STDIO',
        status: 'online',
        toolCount: 1,
        sourceConfig: '/test/config.json',
        tools: [
          {
            name: 'complex_tool',
            description: 'Complex tool',
            parameters: {
              type: 'object',
              properties: {
                config: {
                  type: 'object',
                  properties: {
                    nested: { type: 'string' },
                  },
                },
              },
            },
          },
        ],
      };

      const result = await generator.generateWrapper(complexMCP, 'typescript', 'esm');
      expect(result.success).toBe(true);
    });
  });

  describe('Schema Hash Calculation', () => {
    it('should_generateConsistentHash_when_sameSchemaProvided', async () => {
      const mcp: MCPServerSelection = {
        name: 'test',
        type: 'STDIO',
        status: 'online',
        toolCount: 1,
        sourceConfig: '/test/config.json',
        tools: [
          {
            name: 'test_tool',
            description: 'Test',
            parameters: { type: 'object', properties: {} },
          },
        ],
      };

      const result1 = await generator.generateWrapper(mcp, 'typescript', 'esm');
      const result2 = await generator.generateWrapper(mcp, 'typescript', 'esm');

      expect(result1.schemaHash).toBe(result2.schemaHash);
    });

    it('should_generateDifferentHash_when_schemaChanges', async () => {
      const mcp1: MCPServerSelection = {
        name: 'test',
        type: 'STDIO',
        status: 'online',
        toolCount: 1,
        sourceConfig: '/test/config.json',
        tools: [
          {
            name: 'test_tool',
            description: 'Test 1',
            parameters: { type: 'object', properties: {} },
          },
        ],
      };

      const mcp2: MCPServerSelection = {
        ...mcp1,
        tools: [
          {
            name: 'test_tool',
            description: 'Test 2', // Different description
            parameters: { type: 'object', properties: {} },
          },
        ],
      };

      const result1 = await generator.generateWrapper(mcp1, 'typescript', 'esm');
      const result2 = await generator.generateWrapper(mcp2, 'typescript', 'esm');

      expect(result1.schemaHash).not.toBe(result2.schemaHash);
    });
  });

  describe('Handlebars Helper Functions', () => {
    it('should_convertCamelCase_when_helperUsed', async () => {
      const mcp: MCPServerSelection = {
        name: 'test',
        type: 'STDIO',
        status: 'online',
        toolCount: 1,
        sourceConfig: '/test/config.json',
        tools: [
          {
            name: 'mcp__test__some_long_name',
            description: 'Test',
            parameters: { type: 'object', properties: {} },
          },
        ],
      };

      const result = await generator.generateWrapper(mcp, 'typescript', 'esm');
      const content = await fs.readFile(result.outputPath, 'utf-8');

      expect(content).toContain('test_someLongName'); // camelCase conversion
    });

    it('should_convertPascalCase_when_helperUsed', async () => {
      const mcp: MCPServerSelection = {
        name: 'filesystem',
        type: 'STDIO',
        status: 'online',
        toolCount: 0,
        sourceConfig: '/test/config.json',
        tools: [],
      };

      const result = await generator.generateWrapper(mcp, 'typescript', 'esm');
      const content = await fs.readFile(result.outputPath, 'utf-8');

      expect(content).toContain('namespace Filesystem'); // PascalCase conversion
    });

    it('should_convertSnakeCase_when_pythonGeneration', async () => {
      const mcp: MCPServerSelection = {
        name: 'test',
        type: 'STDIO',
        status: 'online',
        toolCount: 1,
        sourceConfig: '/test/config.json',
        tools: [
          {
            name: 'testLongName',
            description: 'Test',
            parameters: { type: 'object', properties: {} },
          },
        ],
      };

      const result = await generator.generateWrapper(mcp, 'python', 'esm');
      const content = await fs.readFile(result.outputPath, 'utf-8');

      expect(content).toContain('test_long_name'); // snake_case conversion
    });
  });

  describe('Error Handling', () => {
    it('should_throwError_when_invalidLanguageProvided', async () => {
      const mcp: MCPServerSelection = {
        name: 'test',
        type: 'STDIO',
        status: 'online',
        toolCount: 0,
        sourceConfig: '/test/config.json',
        tools: [],
      };

      await expect(
        generator.generateWrapper(mcp, 'java' as any, 'esm')
      ).rejects.toThrow(/invalid.*language|unsupported.*language/i);
    });

    it('should_returnFailureResult_when_templateFileMissing', async () => {
      // Create generator with non-existent template directory
      const badGenerator = new WrapperGenerator({
        outputDir: testOutputDir,
        templateDir: '/non/existent/path',
      });

      const mcp: MCPServerSelection = {
        name: 'test',
        type: 'STDIO',
        status: 'online',
        toolCount: 0,
        sourceConfig: '/test/config.json',
        tools: [],
      };

      // Should return error result, not throw (resilient generation pattern)
      const result = await badGenerator.generateWrapper(mcp, 'typescript', 'esm');

      expect(result.success).toBe(false);
      expect(result.errorMessage).toMatch(/template.*not.*found|ENOENT/i);
    });
  });
});
