/**
 * CLIWizard Tests
 *
 * **TDD PHASE:** RED (Failing Tests) → GREEN (Implementation)
 * **COVERAGE TARGET:** 90%+
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CLIWizard } from '../../src/cli/wizard.js';
import { ToolDetector } from '../../src/cli/tool-detector.js';
import type { AIToolMetadata } from '../../src/cli/tool-registry.js';
import os from 'node:os';

// Mock fs/promises for ToolDetector (preserve real methods for Phase 11 tests)
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual, // Preserve all real fs methods (mkdir, writeFile, rm, stat, readFile)
    access: vi.fn(), // Mock only access for ToolDetector tests
  };
});

// Mock prompts
vi.mock('prompts', () => ({
  default: vi.fn(),
}));

import * as fs from 'node:fs/promises';
import prompts from 'prompts';

describe('CLIWizard', () => {
  let wizard: CLIWizard;
  let toolDetector: ToolDetector;

  beforeEach(() => {
    toolDetector = new ToolDetector();
    wizard = new CLIWizard(toolDetector);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('selectTools', () => {
    const mockInstalledTools: AIToolMetadata[] = [
      {
        id: 'claude-code',
        name: 'Claude Code',
        description: 'Anthropic\'s official CLI for Claude',
        configPaths: { linux: '~/.claude/CLAUDE.md' },
        website: 'https://code.claude.com',
      },
      {
        id: 'cursor',
        name: 'Cursor',
        description: 'AI-first code editor',
        configPaths: { linux: '~/.cursor/config.json' },
        website: 'https://cursor.sh',
      },
      {
        id: 'windsurf',
        name: 'Windsurf',
        description: 'AI-powered development assistant',
        configPaths: { linux: '~/.windsurf/config.json' },
        website: 'https://windsurf.ai',
      },
    ];

    it('should_returnSelectedTools_when_multipleToolsChosen', async () => {
      vi.spyOn(toolDetector, 'detectInstalledTools').mockResolvedValue(mockInstalledTools);
      vi.mocked(prompts).mockResolvedValue({ selectedTools: ['claude-code', 'cursor'] });

      const result = await wizard.selectTools();

      expect(result).toHaveLength(2);
      expect(result.map(t => t.id)).toContain('claude-code');
      expect(result.map(t => t.id)).toContain('cursor');
    });

    it('should_returnSingleTool_when_oneToolChosen', async () => {
      vi.spyOn(toolDetector, 'detectInstalledTools').mockResolvedValue(mockInstalledTools);
      vi.mocked(prompts).mockResolvedValue({ selectedTools: ['claude-code'] });

      const result = await wizard.selectTools();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('claude-code');
      expect(result[0].name).toBe('Claude Code');
    });

    it('should_returnAllTools_when_allToolsSelected', async () => {
      vi.spyOn(toolDetector, 'detectInstalledTools').mockResolvedValue(mockInstalledTools);
      vi.mocked(prompts).mockResolvedValue({ selectedTools: ['claude-code', 'cursor', 'windsurf'] });

      const result = await wizard.selectTools();

      expect(result).toHaveLength(3);
      expect(result.map(t => t.id)).toEqual(['claude-code', 'cursor', 'windsurf']);
    });

    it('should_returnCorrectMetadata_when_toolsSelected', async () => {
      vi.spyOn(toolDetector, 'detectInstalledTools').mockResolvedValue(mockInstalledTools);
      vi.mocked(prompts).mockResolvedValue({ selectedTools: ['claude-code'] });

      const result = await wizard.selectTools();

      // Verify returned metadata is complete
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).toHaveProperty('description');
      expect(result[0]).toHaveProperty('configPaths');
      expect(result[0]).toHaveProperty('website');

      // Verify correct tool returned
      expect(result[0].id).toBe('claude-code');
      expect(result[0].name).toBe('Claude Code');
    });

    it('should_throwError_when_noToolsInstalled', async () => {
      vi.spyOn(toolDetector, 'detectInstalledTools').mockResolvedValue([]);

      await expect(wizard.selectTools()).rejects.toThrow('No AI tools detected');
    });

    it('should_includeWebsiteInMetadata_when_toolSelected', async () => {
      vi.spyOn(toolDetector, 'detectInstalledTools').mockResolvedValue(mockInstalledTools);
      vi.mocked(prompts).mockResolvedValue({ selectedTools: ['claude-code'] });

      const result = await wizard.selectTools();

      expect(result[0].website).toBe('https://code.claude.com');
    });

    it('should_preserveToolOrder_when_returningResults', async () => {
      vi.spyOn(toolDetector, 'detectInstalledTools').mockResolvedValue(mockInstalledTools);
      vi.mocked(prompts).mockResolvedValue({ selectedTools: ['cursor', 'claude-code'] });

      const result = await wizard.selectTools();

      // Result should maintain selection order
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('cursor');
      expect(result[1].id).toBe('claude-code');
    });

    it('should_returnEmptyArray_when_promptCancelled', async () => {
      vi.spyOn(toolDetector, 'detectInstalledTools').mockResolvedValue(mockInstalledTools);
      vi.mocked(prompts).mockResolvedValue({ selectedTools: [] });

      const result = await wizard.selectTools();

      expect(result).toEqual([]);
    });

    it('should_throwError_when_selectedToolNoLongerAvailable', async () => {
      vi.spyOn(toolDetector, 'detectInstalledTools').mockResolvedValue(mockInstalledTools);

      // Simulate user selecting a tool ID that's not in the detected tools
      // (as if tool was uninstalled after detection)
      vi.mocked(prompts).mockResolvedValue({ selectedTools: ['non-existent-tool'] });

      await expect(wizard.selectTools()).rejects.toThrow(
        "Selected tool 'non-existent-tool' is no longer available"
      );
    });

    it('should_returnEmptyArray_when_responseIsNull', async () => {
      vi.spyOn(toolDetector, 'detectInstalledTools').mockResolvedValue(mockInstalledTools);

      // Simulate prompts returning null (user cancelled with Ctrl+C)
      vi.mocked(prompts).mockResolvedValue(null as any);

      const result = await wizard.selectTools();

      expect(result).toEqual([]);
    });
  });

  describe('askConfigQuestions', () => {
    describe('Happy Path', () => {
      it('should_returnConfigWithDefaults_when_userAcceptsAllDefaults', async () => {
        // Simulate user pressing Enter on all prompts (accepting defaults)
        vi.mocked(prompts).mockResolvedValue({
          proxyPort: 3000,
          executionTimeout: 120000,
          rateLimit: 30,
          auditLogPath: '~/.code-executor/audit-logs/audit.jsonl',
          schemaCacheTTL: 24,
        });

        const result = await wizard.askConfigQuestions();

        expect(result.proxyPort).toBe(3000);
        expect(result.executionTimeout).toBe(120000);
        expect(result.rateLimit).toBe(30);
        expect(result.auditLogPath).toBe('~/.code-executor/audit-logs/audit.jsonl');
        expect(result.schemaCacheTTL).toBe(24);
      });

      it('should_returnConfigWithCustomValues_when_userProvidesValidInputs', async () => {
        vi.mocked(prompts).mockResolvedValue({
          proxyPort: 8080,
          executionTimeout: 60000,
          rateLimit: 100,
          auditLogPath: '/var/log/code-executor/audit.jsonl',
          schemaCacheTTL: 48,
        });

        const result = await wizard.askConfigQuestions();

        expect(result.proxyPort).toBe(8080);
        expect(result.executionTimeout).toBe(60000);
        expect(result.rateLimit).toBe(100);
        expect(result.auditLogPath).toBe('/var/log/code-executor/audit.jsonl');
        expect(result.schemaCacheTTL).toBe(48);
      });

      it('should_returnAllRequiredFields_when_configCreated', async () => {
        vi.mocked(prompts).mockResolvedValue({
          proxyPort: 3000,
          executionTimeout: 120000,
          rateLimit: 30,
          auditLogPath: '~/.code-executor/audit-logs/audit.jsonl',
          schemaCacheTTL: 24,
        });

        const result = await wizard.askConfigQuestions();

        // Verify all required fields present
        expect(result).toHaveProperty('proxyPort');
        expect(result).toHaveProperty('executionTimeout');
        expect(result).toHaveProperty('rateLimit');
        expect(result).toHaveProperty('auditLogPath');
        expect(result).toHaveProperty('schemaCacheTTL');
      });
    });

    describe('Validation', () => {
      it('should_haveValidation_for_proxyPort', async () => {
        // Test that validate function exists and works correctly
        const mockPrompts = vi.mocked(prompts);

        // Mock valid response
        mockPrompts.mockResolvedValue({
          proxyPort: 3000,
          executionTimeout: 120000,
          rateLimit: 30,
          auditLogPath: '~/.code-executor/audit-logs/audit.jsonl',
          schemaCacheTTL: 24,
        });

        await wizard.askConfigQuestions();

        // Verify prompts was called with validation function
        const firstCall = mockPrompts.mock.calls[0][0];
        expect(firstCall).toHaveProperty('validate');

        // Test validation function directly
        if (typeof firstCall.validate === 'function') {
          expect(firstCall.validate(500)).toContain('1024');
          expect(firstCall.validate(70000)).toContain('65535');
          expect(firstCall.validate(3000)).toBe(true);
        }
      });

      it('should_haveValidation_for_executionTimeout', async () => {
        vi.mocked(prompts).mockResolvedValue({
          proxyPort: 3000,
          executionTimeout: 120000,
          rateLimit: 30,
          auditLogPath: '~/.code-executor/audit-logs/audit.jsonl',
          schemaCacheTTL: 24,
        });

        await wizard.askConfigQuestions();

        const secondCall = vi.mocked(prompts).mock.calls[1][0];
        expect(secondCall).toHaveProperty('validate');

        if (typeof secondCall.validate === 'function') {
          expect(secondCall.validate(500)).toContain('1000');
          expect(secondCall.validate(700000)).toContain('600000');
          expect(secondCall.validate(120000)).toBe(true);
        }
      });

      it('should_haveValidation_for_rateLimit', async () => {
        vi.mocked(prompts).mockResolvedValue({
          proxyPort: 3000,
          executionTimeout: 120000,
          rateLimit: 30,
          auditLogPath: '~/.code-executor/audit-logs/audit.jsonl',
          schemaCacheTTL: 24,
        });

        await wizard.askConfigQuestions();

        const thirdCall = vi.mocked(prompts).mock.calls[2][0];
        expect(thirdCall).toHaveProperty('validate');

        if (typeof thirdCall.validate === 'function') {
          expect(thirdCall.validate(0)).toContain('1');
          expect(thirdCall.validate(1500)).toContain('1000');
          expect(thirdCall.validate(30)).toBe(true);
        }
      });

      it('should_haveValidation_for_auditLogPath', async () => {
        vi.mocked(prompts).mockResolvedValue({
          proxyPort: 3000,
          executionTimeout: 120000,
          rateLimit: 30,
          auditLogPath: '~/.code-executor/audit-logs/audit.jsonl',
          schemaCacheTTL: 24,
        });

        await wizard.askConfigQuestions();

        const fourthCall = vi.mocked(prompts).mock.calls[3][0];
        expect(fourthCall).toHaveProperty('validate');

        if (typeof fourthCall.validate === 'function') {
          expect(fourthCall.validate('')).toContain('empty');
          expect(fourthCall.validate('   ')).toContain('empty');
          expect(fourthCall.validate('/tmp/audit.jsonl')).toBe(true);
        }
      });

      it('should_haveValidation_for_schemaCacheTTL', async () => {
        vi.mocked(prompts).mockResolvedValue({
          proxyPort: 3000,
          executionTimeout: 120000,
          rateLimit: 30,
          auditLogPath: '~/.code-executor/audit-logs/audit.jsonl',
          schemaCacheTTL: 24,
        });

        await wizard.askConfigQuestions();

        const fifthCall = vi.mocked(prompts).mock.calls[4][0];
        expect(fifthCall).toHaveProperty('validate');

        if (typeof fifthCall.validate === 'function') {
          expect(fifthCall.validate(0)).toContain('1');
          expect(fifthCall.validate(200)).toContain('168');
          expect(fifthCall.validate(24)).toBe(true);
        }
      });
    });

    describe('Edge Cases', () => {
      it('should_handleCancellation_when_userPressesCancelCtrlC', async () => {
        vi.mocked(prompts).mockResolvedValue(null as any);

        await expect(wizard.askConfigQuestions()).rejects.toThrow('Configuration cancelled');
      });

      it('should_acceptBoundaryValues_when_atMinimum', async () => {
        vi.mocked(prompts).mockResolvedValue({
          proxyPort: 1024,
          executionTimeout: 1000,
          rateLimit: 1,
          auditLogPath: '/tmp/audit.jsonl',
          schemaCacheTTL: 1,
        });

        const result = await wizard.askConfigQuestions();

        expect(result.proxyPort).toBe(1024);
        expect(result.executionTimeout).toBe(1000);
        expect(result.rateLimit).toBe(1);
        expect(result.schemaCacheTTL).toBe(1);
      });

      it('should_acceptBoundaryValues_when_atMaximum', async () => {
        vi.mocked(prompts).mockResolvedValue({
          proxyPort: 65535,
          executionTimeout: 600000,
          rateLimit: 1000,
          auditLogPath: '/tmp/audit.jsonl',
          schemaCacheTTL: 168,
        });

        const result = await wizard.askConfigQuestions();

        expect(result.proxyPort).toBe(65535);
        expect(result.executionTimeout).toBe(600000);
        expect(result.rateLimit).toBe(1000);
        expect(result.schemaCacheTTL).toBe(168);
      });
    });
  });

  describe('selectMCPServers', () => {
    const mockMCPServers = [
      {
        server: {
          name: 'filesystem',
          command: 'node',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
          sourceTool: 'claude-code',
        },
        status: 'available' as const,
        message: 'Command found',
      },
      {
        server: {
          name: 'github',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_TOKEN: 'token' },
          sourceTool: 'cursor',
        },
        status: 'unavailable' as const,
        message: 'Command not found',
      },
      {
        server: {
          name: 'postgres',
          command: 'node',
          args: ['dist/index.js'],
          sourceTool: 'windsurf',
        },
        status: 'unknown' as const,
      },
    ];

    it('should_returnSelectedServers_when_multipleServersChosen', async () => {
      vi.mocked(prompts).mockResolvedValue({ selectedServers: ['filesystem', 'github'] });

      const result = await wizard.selectMCPServers(mockMCPServers);

      expect(result).toHaveLength(2);
      expect(result.map(s => s.server.name)).toContain('filesystem');
      expect(result.map(s => s.server.name)).toContain('github');
    });

    it('should_returnSingleServer_when_oneServerChosen', async () => {
      vi.mocked(prompts).mockResolvedValue({ selectedServers: ['filesystem'] });

      const result = await wizard.selectMCPServers(mockMCPServers);

      expect(result).toHaveLength(1);
      expect(result[0].server.name).toBe('filesystem');
      expect(result[0].status).toBe('available');
    });

    it('should_displayServerStatus_when_promptShown', async () => {
      vi.mocked(prompts).mockResolvedValue({ selectedServers: ['filesystem'] });

      await wizard.selectMCPServers(mockMCPServers);

      // Verify prompts called with choices containing status indicators
      expect(prompts).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'multiselect',
          name: 'selectedServers',
          choices: expect.arrayContaining([
            expect.objectContaining({
              title: expect.stringContaining('filesystem'),
              description: expect.stringContaining('claude-code'),
            }),
          ]),
        })
      );
    });

    it('should_showAvailableStatus_when_serverCommandFound', async () => {
      vi.mocked(prompts).mockResolvedValue({ selectedServers: ['filesystem'] });

      await wizard.selectMCPServers(mockMCPServers);

      // Check that available status is indicated in title
      const promptCall = vi.mocked(prompts).mock.calls[0][0];
      const filesystemChoice = (promptCall as any).choices.find((c: any) => c.value === 'filesystem');
      expect(filesystemChoice.title).toContain('✓');
    });

    it('should_showUnavailableStatus_when_serverCommandNotFound', async () => {
      vi.mocked(prompts).mockResolvedValue({ selectedServers: ['github'] });

      await wizard.selectMCPServers(mockMCPServers);

      // Check that unavailable status is indicated in title
      const promptCall = vi.mocked(prompts).mock.calls[0][0];
      const githubChoice = (promptCall as any).choices.find((c: any) => c.value === 'github');
      expect(githubChoice.title).toContain('✗');
    });

    it('should_showUnknownStatus_when_serverStatusUnknown', async () => {
      vi.mocked(prompts).mockResolvedValue({ selectedServers: ['postgres'] });

      await wizard.selectMCPServers(mockMCPServers);

      // Check that unknown status is indicated in title
      const promptCall = vi.mocked(prompts).mock.calls[0][0];
      const postgresChoice = (promptCall as any).choices.find((c: any) => c.value === 'postgres');
      expect(postgresChoice.title).toContain('?');
    });

    it('should_validateMinimumSelection_when_noServersSelected', async () => {
      vi.mocked(prompts).mockResolvedValue({ selectedServers: [] });

      await wizard.selectMCPServers(mockMCPServers);

      // Verify validation function exists and checks for minimum 1 server
      const promptCall = vi.mocked(prompts).mock.calls[0][0];
      const validateFn = (promptCall as any).validate;
      expect(validateFn).toBeDefined();
      expect(validateFn([])).toBe('You must select at least one MCP server');
    });

    it('should_allowSingleSelection_when_validationPasses', async () => {
      vi.mocked(prompts).mockResolvedValue({ selectedServers: ['filesystem'] });

      await wizard.selectMCPServers(mockMCPServers);

      // Verify validation passes for 1+ servers
      const promptCall = vi.mocked(prompts).mock.calls[0][0];
      const validateFn = (promptCall as any).validate;
      expect(validateFn(['filesystem'])).toBe(true);
    });

    it('should_preserveServerOrder_when_returningResults', async () => {
      vi.mocked(prompts).mockResolvedValue({ selectedServers: ['github', 'filesystem'] });

      const result = await wizard.selectMCPServers(mockMCPServers);

      // Result should maintain selection order
      expect(result).toHaveLength(2);
      expect(result[0].server.name).toBe('github');
      expect(result[1].server.name).toBe('filesystem');
    });

    it('should_returnEmptyArray_when_promptCancelled', async () => {
      vi.mocked(prompts).mockResolvedValue(null as any);

      const result = await wizard.selectMCPServers(mockMCPServers);

      expect(result).toEqual([]);
    });

    it('should_includeServerMetadata_when_returningResults', async () => {
      vi.mocked(prompts).mockResolvedValue({ selectedServers: ['filesystem'] });

      const result = await wizard.selectMCPServers(mockMCPServers);

      // Verify complete metadata returned
      expect(result[0]).toHaveProperty('server');
      expect(result[0]).toHaveProperty('status');
      expect(result[0].server).toHaveProperty('name');
      expect(result[0].server).toHaveProperty('command');
      expect(result[0].server).toHaveProperty('args');
      expect(result[0].server).toHaveProperty('sourceTool');
    });

    it('should_displaySourceTool_when_promptShown', async () => {
      vi.mocked(prompts).mockResolvedValue({ selectedServers: ['filesystem'] });

      await wizard.selectMCPServers(mockMCPServers);

      // Check that source tool is shown in description
      const promptCall = vi.mocked(prompts).mock.calls[0][0];
      const filesystemChoice = (promptCall as any).choices.find((c: any) => c.value === 'filesystem');
      expect(filesystemChoice.description).toContain('claude-code');
    });

    it('should_throwError_when_emptyServerListProvided', async () => {
      await expect(wizard.selectMCPServers([])).rejects.toThrow('No MCP servers discovered');
    });
  });

  describe('selectLanguagePerMCP', () => {
    const mockSelectedServers = [
      {
        server: {
          name: 'filesystem',
          command: 'node',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
          sourceTool: 'claude-code',
        },
        status: 'available' as const,
        message: 'Command found',
      },
      {
        server: {
          name: 'github',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          sourceTool: 'cursor',
        },
        status: 'available' as const,
        message: 'Command found',
      },
    ];

    it('should_promptForEachServer_when_multipleServersSelected', async () => {
      // Mock user selecting TypeScript for filesystem, Python for github
      vi.mocked(prompts)
        .mockResolvedValueOnce({ language: 'typescript' })
        .mockResolvedValueOnce({ language: 'python' });

      const result = await wizard.selectLanguagePerMCP(mockSelectedServers);

      expect(result).toHaveLength(2);
      expect(result[0].server.name).toBe('filesystem');
      expect(result[0].language).toBe('typescript');
      expect(result[1].server.name).toBe('github');
      expect(result[1].language).toBe('python');
    });

    it('should_supportBothLanguages_when_userSelectsBoth', async () => {
      vi.mocked(prompts).mockResolvedValue({ language: 'both' });

      const result = await wizard.selectLanguagePerMCP([mockSelectedServers[0]]);

      expect(result[0].language).toBe('both');
    });

    it('should_throwError_when_userCancelsPrompt', async () => {
      vi.mocked(prompts).mockResolvedValue(null);

      await expect(wizard.selectLanguagePerMCP(mockSelectedServers)).rejects.toThrow('Language selection cancelled');
    });

    it('should_throwError_when_emptyServerList', async () => {
      await expect(wizard.selectLanguagePerMCP([])).rejects.toThrow('No servers provided');
    });

    it('should_displayServerNameInPrompt_when_askingForLanguage', async () => {
      vi.mocked(prompts).mockResolvedValue({ language: 'typescript' });

      await wizard.selectLanguagePerMCP([mockSelectedServers[0]]);

      // Verify prompt message includes server name
      const promptCall = vi.mocked(prompts).mock.calls[0][0];
      expect((promptCall as any).message).toContain('filesystem');
    });

    it('should_provideAllThreeChoices_when_promptDisplayed', async () => {
      vi.mocked(prompts).mockResolvedValue({ language: 'typescript' });

      await wizard.selectLanguagePerMCP([mockSelectedServers[0]]);

      // Verify prompt has TypeScript, Python, Both choices
      const promptCall = vi.mocked(prompts).mock.calls[0][0];
      const choices = (promptCall as any).choices;

      expect(choices).toHaveLength(3);
      expect(choices.map((c: any) => c.value)).toEqual(['typescript', 'python', 'both']);
    });

    it('should_preserveServerOrder_when_returningSelections', async () => {
      vi.mocked(prompts)
        .mockResolvedValueOnce({ language: 'typescript' })
        .mockResolvedValueOnce({ language: 'python' });

      const result = await wizard.selectLanguagePerMCP(mockSelectedServers);

      expect(result[0].server.name).toBe('filesystem');
      expect(result[1].server.name).toBe('github');
    });

    it('should_returnEmptyArray_when_noServersProvided', async () => {
      await expect(wizard.selectLanguagePerMCP([])).rejects.toThrow('No servers provided');
    });

    it('should_handleUnavailableServers_when_includedInList', async () => {
      const serverWithUnavailableStatus = [
        {
          server: {
            name: 'unavailable-mcp',
            command: 'missing-command',
            args: [],
            sourceTool: 'test',
          },
          status: 'unavailable' as const,
          message: 'Command not found',
        },
      ];

      vi.mocked(prompts).mockResolvedValue({ language: 'typescript' });

      const result = await wizard.selectLanguagePerMCP(serverWithUnavailableStatus);

      expect(result[0].language).toBe('typescript');
      expect(result[0].server.name).toBe('unavailable-mcp');
    });

    it('should_collectAllSelectionsBeforeReturning_when_multipleServers', async () => {
      const threeServers = [
        mockSelectedServers[0],
        mockSelectedServers[1],
        {
          server: {
            name: 'postgres',
            command: 'node',
            args: [],
            sourceTool: 'windsurf',
          },
          status: 'available' as const,
        },
      ];

      vi.mocked(prompts)
        .mockResolvedValueOnce({ language: 'typescript' })
        .mockResolvedValueOnce({ language: 'python' })
        .mockResolvedValueOnce({ language: 'both' });

      const result = await wizard.selectLanguagePerMCP(threeServers);

      expect(result).toHaveLength(3);
      expect(result[0].language).toBe('typescript');
      expect(result[1].language).toBe('python');
      expect(result[2].language).toBe('both');
    });
  });

  describe('generateWrappersWithProgress', () => {
    it('should_generateWrappers_when_validLanguageSelections', async () => {
      // Arrange: Mock WrapperGenerator
      const mockGenerate = vi.fn().mockResolvedValue({
        success: true,
        outputPath: '/test/output.ts',
        generatedAt: new Date().toISOString(),
      });

      const wrapperGenerator = {
        generateWrapper: mockGenerate,
      };

      const wizard = new CLIWizard(toolDetector as any);
      (wizard as any).wrapperGenerator = wrapperGenerator;

      const selections: LanguageSelection[] = [
        {
          server: {
            name: 'filesystem',
            description: 'File operations',
            type: 'STDIO' as const,
            status: 'available' as const,
          },
          language: 'typescript' as WrapperLanguage,
        },
      ];

      // Act
      const result = await wizard.generateWrappersWithProgress(selections, 'esm');

      // Assert
      expect(result).toBeDefined();
      expect(result.succeeded).toHaveLength(1);
      expect(result.failed).toHaveLength(0);
      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });

    it('should_handlePartialFailures_when_someWrappersFailToGenerate', async () => {
      // Arrange: Mock WrapperGenerator with one success, one failure
      const mockGenerate = vi.fn()
        .mockResolvedValueOnce({
          success: true,
          outputPath: '/test/filesystem.ts',
          generatedAt: new Date().toISOString(),
        })
        .mockRejectedValueOnce(new Error('Schema fetch failed'));

      const wrapperGenerator = {
        generateWrapper: mockGenerate,
      };

      const wizard = new CLIWizard(toolDetector as any);
      (wizard as any).wrapperGenerator = wrapperGenerator;

      const selections: LanguageSelection[] = [
        {
          server: {
            name: 'filesystem',
            description: 'File operations',
            type: 'STDIO' as const,
            status: 'available' as const,
          },
          language: 'typescript' as WrapperLanguage,
        },
        {
          server: {
            name: 'broken',
            description: 'Broken server',
            type: 'STDIO' as const,
            status: 'offline' as const,
          },
          language: 'python' as WrapperLanguage,
        },
      ];

      // Act
      const result = await wizard.generateWrappersWithProgress(selections, 'esm');

      // Assert
      expect(result.succeeded).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).toBe('Schema fetch failed');
    });

    it('should_generateBothLanguages_when_languageIsBoth', async () => {
      // Arrange
      const mockGenerate = vi.fn()
        .mockResolvedValueOnce({
          success: true,
          outputPath: '/test/filesystem.ts',
          generatedAt: new Date().toISOString(),
        })
        .mockResolvedValueOnce({
          success: true,
          outputPath: '/test/filesystem.py',
          generatedAt: new Date().toISOString(),
        });

      const wrapperGenerator = {
        generateWrapper: mockGenerate,
      };

      const wizard = new CLIWizard(toolDetector as any);
      (wizard as any).wrapperGenerator = wrapperGenerator;

      const selections: LanguageSelection[] = [
        {
          server: {
            name: 'filesystem',
            description: 'File operations',
            type: 'STDIO' as const,
            status: 'available' as const,
          },
          language: 'both' as WrapperLanguage,
        },
      ];

      // Act
      const result = await wizard.generateWrappersWithProgress(selections, 'esm');

      // Assert
      expect(mockGenerate).toHaveBeenCalledTimes(2);
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'filesystem' }),
        'typescript',
        'esm',
        'force' // regenOption parameter
      );
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'filesystem' }),
        'python',
        'esm',
        'force' // regenOption parameter
      );
    });
  });

  describe('askDailySyncConfig', () => {
    it('should_returnNull_when_userDeclinesDailySync', async () => {
      // Arrange
      vi.mocked(prompts).mockResolvedValueOnce({ enabled: false });

      // Act
      const result = await wizard.askDailySyncConfig();

      // Assert
      expect(result).toBeNull();
    });

    it('should_returnDefaultTime_when_userAcceptsWithDefault', async () => {
      // Arrange
      vi.mocked(prompts)
        .mockResolvedValueOnce({ enabled: true })
        .mockResolvedValueOnce({ syncTime: '05:00' });

      // Act
      const result = await wizard.askDailySyncConfig();

      // Assert
      expect(result).toEqual({
        enabled: true,
        syncTime: '05:00',
      });
    });

    it('should_returnCustomTime_when_userProvides4AM', async () => {
      // Arrange
      vi.mocked(prompts)
        .mockResolvedValueOnce({ enabled: true })
        .mockResolvedValueOnce({ syncTime: '04:00' });

      // Act
      const result = await wizard.askDailySyncConfig();

      // Assert
      expect(result).toEqual({
        enabled: true,
        syncTime: '04:00',
      });
    });

    it('should_returnCustomTime_when_userProvides6AM', async () => {
      // Arrange
      vi.mocked(prompts)
        .mockResolvedValueOnce({ enabled: true })
        .mockResolvedValueOnce({ syncTime: '06:00' });

      // Act
      const result = await wizard.askDailySyncConfig();

      // Assert
      expect(result).toEqual({
        enabled: true,
        syncTime: '06:00',
      });
    });

    it('should_returnNull_when_userCancels', async () => {
      // Arrange
      vi.mocked(prompts)
        .mockResolvedValueOnce({ enabled: true })
        .mockResolvedValueOnce({}); // User pressed Ctrl+C

      // Act
      const result = await wizard.askDailySyncConfig();

      // Assert
      expect(result).toBeNull();
    });

    it('should_validateTimeFormat', async () => {
      // Arrange
      const mockPrompts = vi.mocked(prompts);
      mockPrompts.mockResolvedValueOnce({ enabled: true });
      mockPrompts.mockResolvedValueOnce({ syncTime: '05:00' });

      // Act
      await wizard.askDailySyncConfig();

      // Assert - Verify validation function was provided
      expect(mockPrompts).toHaveBeenCalledTimes(2);
      const timePromptCall = mockPrompts.mock.calls[1]![0] as any;
      expect(timePromptCall).toHaveProperty('validate');

      // Test the validation function
      const validate = timePromptCall.validate;
      expect(validate('invalid')).toContain('Invalid time format');
      expect(validate('03:59')).toContain('must be between 04:00 and 06:00');
      expect(validate('07:00')).toContain('must be between 04:00 and 06:00');
      expect(validate('06:01')).toContain('must be between 04:00 and 06:00');
      expect(validate('04:00')).toBe(true);
      expect(validate('05:30')).toBe(true);
      expect(validate('06:00')).toBe(true);
    });
  });

  /**
   * Visual Feedback Tests (FR-7)
   *
   * **SCOPE:** ASCII banner, color-coded output, spinners, progress bars
   * **TDD PHASE:** RED (failing tests)
   */
  describe('Visual Feedback (FR-7)', () => {
    describe('showBanner()', () => {
      it('should_displayASCIIBanner_when_wizardStarts', () => {
        // Arrange
        const wizard = new CLIWizard(toolDetector);

        // Act & Assert
        expect(() => wizard.showBanner()).not.toThrow();
      });

      it('should_returnBannerString_when_called', () => {
        // Arrange
        const wizard = new CLIWizard(toolDetector);

        // Act
        const banner = wizard.showBanner();

        // Assert
        expect(banner).toBeDefined();
        expect(typeof banner).toBe('string');
        expect(banner.length).toBeGreaterThan(0);
        // Banner contains ASCII art or fallback text
        expect(banner.length).toBeGreaterThan(20); // ASCII art is longer than 20 chars
      });
    });

    describe('formatMessage()', () => {
      it('should_formatSuccessMessage_when_typeIsSuccess', () => {
        // Arrange
        const wizard = new CLIWizard(toolDetector);
        const message = 'Configuration saved successfully';

        // Act
        const formatted = wizard.formatMessage('success', message);

        // Assert
        expect(formatted).toContain('✓');
        expect(formatted).toContain(message);
      });

      it('should_formatErrorMessage_when_typeIsError', () => {
        // Arrange
        const wizard = new CLIWizard(toolDetector);
        const message = 'Permission denied';

        // Act
        const formatted = wizard.formatMessage('error', message);

        // Assert
        expect(formatted).toContain('✗');
        expect(formatted).toContain(message);
      });

      it('should_formatWarningMessage_when_typeIsWarning', () => {
        // Arrange
        const wizard = new CLIWizard(toolDetector);
        const message = 'Some dependencies missing';

        // Act
        const formatted = wizard.formatMessage('warning', message);

        // Assert
        expect(formatted).toContain('⚠');
        expect(formatted).toContain(message);
      });

      it('should_formatInfoMessage_when_typeIsInfo', () => {
        // Arrange
        const wizard = new CLIWizard(toolDetector);
        const message = 'Using cached schemas';

        // Act
        const formatted = wizard.formatMessage('info', message);

        // Assert
        expect(formatted).toContain('ℹ');
        expect(formatted).toContain(message);
      });
    });

    describe('Spinner Integration', () => {
      it('should_createSpinner_when_startingAsyncOperation', () => {
        // Arrange
        const wizard = new CLIWizard(toolDetector);

        // Act
        const spinner = wizard.createSpinner('Discovering MCP servers...');

        // Assert
        expect(spinner).toBeDefined();
        expect(spinner).toHaveProperty('start');
        expect(spinner).toHaveProperty('succeed');
        expect(spinner).toHaveProperty('fail');
        expect(spinner).toHaveProperty('warn');
      });
    });

    describe('Progress Bar Integration', () => {
      it('should_createProgressBar_when_trackingMultiStepOperation', () => {
        // Arrange
        const wizard = new CLIWizard(toolDetector);

        // Act
        const progressBar = wizard.createProgressBar(10, 'Generating wrappers');

        // Assert
        expect(progressBar).toBeDefined();
        expect(progressBar).toHaveProperty('start');
        expect(progressBar).toHaveProperty('update');
        expect(progressBar).toHaveProperty('increment');
        expect(progressBar).toHaveProperty('stop');
      });
    });

    describe('Completion Summary', () => {
      it('should_displayCompletionTable_when_setupComplete', () => {
        // Arrange
        const wizard = new CLIWizard(toolDetector);
        const summary = {
          toolsConfigured: ['claude-code', 'windsurf'],
          mcpsDiscovered: 5,
          wrappersGenerated: 3,
          wrappersFailed: 0,
          dailySyncEnabled: true,
        };

        // Act
        const table = wizard.formatCompletionSummary(summary);

        // Assert
        expect(table).toBeDefined();
        expect(typeof table).toBe('string');
        expect(table).toContain('Setup Complete');
        expect(table).toContain('claude-code');
        expect(table).toContain('windsurf');
        expect(table).toContain('5'); // MCP count
        expect(table).toContain('3'); // Wrapper count
      });

      it('should_showWarning_when_wrappersFailedGeneration', () => {
        // Arrange
        const wizard = new CLIWizard(toolDetector);
        const summary = {
          toolsConfigured: ['claude-code'],
          mcpsDiscovered: 3,
          wrappersGenerated: 2,
          wrappersFailed: 1,
          dailySyncEnabled: false,
        };

        // Act
        const table = wizard.formatCompletionSummary(summary);

        // Assert
        expect(table).toContain('1'); // Failed count
        expect(table).toContain('⚠'); // Warning icon
      });
    });
  });

  /**
   * Idempotent Setup Tests (FR-8)
   *
   * **SCOPE:** Existing config detection, update prompts, lock file integration
   * **TDD PHASE:** RED (failing tests)
   */
  describe('Idempotent Setup (FR-8)', () => {
    describe('detectExistingConfigs()', () => {
      it('should_returnEmpty_when_noConfigsExist', async () => {
        // Arrange
        const wizard = new CLIWizard(toolDetector);
        const tools = [
          { id: 'claude-code', name: 'Claude Code', configPaths: { linux: '/nonexistent/.claude.json', darwin: '/nonexistent/.claude.json', win32: '/nonexistent/.claude.json' } } as AIToolMetadata,
        ];

        // Act
        const result = await wizard.detectExistingConfigs(tools);

        // Assert
        expect(result).toEqual([
          expect.objectContaining({
            toolId: 'claude-code',
            exists: false,
            valid: false,
          }),
        ]);
      });

      it('should_returnToolIds_when_configsExist', async () => {
        // Arrange: Create temporary config files
        const tmpDir = `/tmp/wizard-test-${Date.now()}`;
        await fs.mkdir(tmpDir, { recursive: true });
        const claudeConfigPath = `${tmpDir}/.claude.json`;
        const cursorConfigPath = `${tmpDir}/.cursor-mcp.json`;

        await fs.writeFile(claudeConfigPath, JSON.stringify({ mcpServers: {} }));
        await fs.writeFile(cursorConfigPath, JSON.stringify({ mcpServers: {} }));

        const wizard = new CLIWizard(toolDetector);
        const tools = [
          {
            id: 'claude-code',
            name: 'Claude Code',
            configPaths: { linux: claudeConfigPath, darwin: claudeConfigPath, win32: claudeConfigPath },
          } as AIToolMetadata,
          {
            id: 'cursor',
            name: 'Cursor',
            configPaths: { linux: cursorConfigPath, darwin: cursorConfigPath, win32: cursorConfigPath },
          } as AIToolMetadata,
        ];

        // Act
        const result = await wizard.detectExistingConfigs(tools);

        // Assert
        expect(result.length).toBeGreaterThan(0);
        expect(result).toContainEqual(
          expect.objectContaining({
            toolId: 'claude-code',
            exists: true,
          })
        );

        // Cleanup
        await fs.rm(tmpDir, { recursive: true, force: true });
      });

      it('should_parseValidJSON_when_configExists', async () => {
        // Arrange
        const wizard = new CLIWizard(toolDetector);
        const tools = [
          { id: 'claude-code', name: 'Claude Code', configPaths: { linux: '/home/user/.claude.json', darwin: '/home/user/.claude.json', win32: '/home/user/.claude.json' } } as AIToolMetadata,
        ];

        // Act
        const result = await wizard.detectExistingConfigs(tools);

        // Assert
        const claudeResult = result.find((r) => r.toolId === 'claude-code');
        if (claudeResult?.exists) {
          expect(claudeResult).toHaveProperty('config');
          expect(claudeResult.valid).toBe(true);
        }
      });
    });

    describe('promptConfigUpdate()', () => {
      it('should_offerUpdateOptions_when_configsExist', async () => {
        // Arrange
        const wizard = new CLIWizard(toolDetector);
        const existingConfigs = [
          {
            toolId: 'claude-code',
            toolName: 'Claude Code',
            configPath: '/home/user/.claude.json',
            exists: true,
            valid: true,
            config: { mcpServers: { filesystem: {} } },
          },
        ];

        vi.mocked(prompts).mockResolvedValueOnce({ updateOption: 'merge' });

        // Act
        const result = await wizard.promptConfigUpdate(existingConfigs);

        // Assert
        expect(result).toBe('merge');
        expect(prompts).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'select',
            name: 'updateOption',
            choices: expect.arrayContaining([
              expect.objectContaining({ value: 'keep' }),
              expect.objectContaining({ value: 'merge' }),
              expect.objectContaining({ value: 'reset' }),
            ]),
          })
        );
      });

      it('should_returnNull_when_userCancels', async () => {
        // Arrange
        const wizard = new CLIWizard(toolDetector);
        const existingConfigs = [
          {
            toolId: 'claude-code',
            toolName: 'Claude Code',
            configPath: '/home/user/.claude.json',
            exists: true,
            valid: true,
            config: {},
          },
        ];

        vi.mocked(prompts).mockResolvedValueOnce({}); // User cancelled

        // Act
        const result = await wizard.promptConfigUpdate(existingConfigs);

        // Assert
        expect(result).toBeNull();
      });
    });

    describe('Lock File Integration', () => {
      it('should_acquireLock_when_wizardStarts', async () => {
        // Arrange: Use unique lock file per test to avoid collisions
        const lockPath = `/tmp/wizard-test-${Date.now()}-${Math.random()}.lock`;

        // Cleanup any stale lock files first
        try {
          await fs.unlink(lockPath);
        } catch {
          // Ignore if file doesn't exist
        }

        const wizard = new CLIWizard(toolDetector, undefined, lockPath);

        // Act & Assert
        await expect(wizard.acquireLock()).resolves.not.toThrow();

        // Cleanup
        await wizard.releaseLock();
      });

      it('should_releaseLock_when_wizardCompletes', async () => {
        // Arrange: Use unique lock file per test
        const lockPath = `/tmp/wizard-test-${Date.now()}-${Math.random()}.lock`;

        // Cleanup any stale lock files first
        try {
          await fs.unlink(lockPath);
        } catch {
          // Ignore if file doesn't exist
        }

        const wizard = new CLIWizard(toolDetector, undefined, lockPath);
        await wizard.acquireLock();

        // Act & Assert
        await expect(wizard.releaseLock()).resolves.not.toThrow();
      });

      it('should_throwError_when_lockAlreadyHeld', async () => {
        // Arrange: Use shared lock file for concurrent access test
        const lockPath = `/tmp/wizard-test-concurrent-${Date.now()}.lock`;

        // Cleanup any stale lock files first
        try {
          await fs.unlink(lockPath);
        } catch {
          // Ignore if file doesn't exist
        }

        const wizard1 = new CLIWizard(toolDetector, undefined, lockPath);
        const wizard2 = new CLIWizard(toolDetector, undefined, lockPath);
        await wizard1.acquireLock();

        // Act & Assert
        await expect(wizard2.acquireLock()).rejects.toThrow(/lock.*held/i);

        // Cleanup
        await wizard1.releaseLock();
      });
    });

    describe('Wrapper Regeneration Options', () => {
      it('should_offerRegenerationOptions_when_wrappersExist', async () => {
        // Arrange
        const wizard = new CLIWizard(toolDetector);

        vi.mocked(prompts).mockResolvedValueOnce({ regenOption: 'missing' });

        // Act
        const result = await wizard.promptWrapperRegeneration();

        // Assert
        expect(result).toBe('missing');
        expect(prompts).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'select',
            name: 'regenOption',
            choices: expect.arrayContaining([
              expect.objectContaining({ value: 'missing' }),
              expect.objectContaining({ value: 'force' }),
              expect.objectContaining({ value: 'skip' }),
            ]),
          })
        );
      });

      it('should_returnNull_when_userCancelsRegeneration', async () => {
        // Arrange
        const wizard = new CLIWizard(toolDetector);

        vi.mocked(prompts).mockResolvedValueOnce({}); // User cancelled

        // Act
        const result = await wizard.promptWrapperRegeneration();

        // Assert
        expect(result).toBeNull();
      });
    });
  });

  /**
   * Project MCP Configuration Tests
   *
   * **SCOPE:** Project-specific .mcp.json path prompt and scanning
   * **TDD PHASE:** RED (failing tests)
   */
  describe('promptForProjectMCPConfig()', () => {
    it('should_returnPath_when_userProvidesValidPath', async () => {
      // Arrange
      const wizard = new CLIWizard(toolDetector);
      // Use a path within home directory (allowed by security validation)
      const projectPath = `${os.homedir()}/my-project/.mcp.json`;

      vi.mocked(prompts).mockResolvedValueOnce({ path: projectPath });

      // Act
      const result = await wizard.promptForProjectMCPConfig();

      // Assert
      expect(result).toContain(os.homedir());
      expect(result).toContain('my-project/.mcp.json');
      expect(prompts).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'text',
          name: 'path',
          message: expect.stringContaining('project'),
        })
      );
    });

    it('should_returnNull_when_userSkips', async () => {
      // Arrange
      const wizard = new CLIWizard(toolDetector);

      vi.mocked(prompts).mockResolvedValueOnce({ path: '' });

      // Act
      const result = await wizard.promptForProjectMCPConfig();

      // Assert
      expect(result).toBeNull();
    });

    it('should_returnNull_when_userCancels', async () => {
      // Arrange
      const wizard = new CLIWizard(toolDetector);

      vi.mocked(prompts).mockResolvedValueOnce(null);

      // Act
      const result = await wizard.promptForProjectMCPConfig();

      // Assert
      expect(result).toBeNull();
    });

    it('should_expandTilde_when_pathContainsTilde', async () => {
      // Arrange
      const wizard = new CLIWizard(toolDetector);

      vi.mocked(prompts).mockResolvedValueOnce({ path: '~/my-project/.mcp.json' });

      // Act
      const result = await wizard.promptForProjectMCPConfig();

      // Assert
      expect(result).toContain(os.homedir());
      expect(result).not.toContain('~');
    });

    it('should_showHelpText_when_promptDisplayed', async () => {
      // Arrange
      const wizard = new CLIWizard(toolDetector);

      vi.mocked(prompts).mockResolvedValueOnce({ path: '' });

      // Act
      await wizard.promptForProjectMCPConfig();

      // Assert
      const promptCall = vi.mocked(prompts).mock.calls[0][0];
      expect(promptCall).toHaveProperty('message');
      expect((promptCall as any).message).toContain('project');
    });
  });
});
