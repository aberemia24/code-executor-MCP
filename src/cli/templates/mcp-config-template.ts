/**
 * Complete MCP Configuration Template
 *
 * This template includes ALL recommended settings for production-ready setup:
 * - AI Sampling (multi-provider support)
 * - Sandbox security
 * - Rate limiting
 * - Audit logging
 * - Performance tuning
 * - Path restrictions
 */

export interface SamplingOptions {
  enabled: boolean;
  provider?: 'anthropic' | 'openai' | 'gemini' | 'grok' | 'perplexity';
  apiKey?: string;
  model?: string;
  maxRounds?: number;
  maxTokens?: number;
}

export interface SecurityOptions {
  auditLogEnabled: boolean;
  auditLogPath?: string;
  contentFiltering: boolean;
  allowedProjects?: string[];
  allowedSystemPrompts?: string[];
}

export interface PerformanceOptions {
  executionTimeout?: number;
  schemaCacheTTL?: number;
  rateLimitRPM?: number;
}

/**
 * Generate complete MCP server configuration with all best practices
 */
export function generateCompleteConfig(options: {
  sampling?: SamplingOptions;
  security?: SecurityOptions;
  performance?: PerformanceOptions;
  denoPath?: string;
  mcpConfigPath?: string;
}): {
  mcpServers: {
    'code-executor': {
      command: string;
      args: string[];
      env: Record<string, string>;
    };
  };
} {
  const {
    sampling = { enabled: false },
    security = {
      auditLogEnabled: true,
      contentFiltering: true
    },
    performance = {},
    denoPath,
    mcpConfigPath
  } = options;

  // Base configuration
  const env: Record<string, string> = {};

  // ============================================
  // SAMPLING CONFIGURATION (Multi-Provider AI)
  // ============================================
  if (sampling.enabled && sampling.provider && sampling.apiKey) {
    env.CODE_EXECUTOR_SAMPLING_ENABLED = 'true';
    env.CODE_EXECUTOR_AI_PROVIDER = sampling.provider;

    // Set the appropriate API key based on provider
    const keyMap: Record<typeof sampling.provider, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      gemini: 'GEMINI_API_KEY',
      grok: 'GROK_API_KEY',
      perplexity: 'PERPLEXITY_API_KEY'
    };

    const envKeyName = keyMap[sampling.provider];
    if (envKeyName) {
      env[envKeyName] = sampling.apiKey;
    }

    // Optional model override
    if (sampling.model) {
      env.CODE_EXECUTOR_ALLOWED_MODELS = sampling.model;
    }

    // Rate limiting for sampling
    if (sampling.maxRounds) {
      env.CODE_EXECUTOR_MAX_SAMPLING_ROUNDS = sampling.maxRounds.toString();
    }
    if (sampling.maxTokens) {
      env.CODE_EXECUTOR_MAX_SAMPLING_TOKENS = sampling.maxTokens.toString();
    }

    // Default sampling timeout
    env.CODE_EXECUTOR_SAMPLING_TIMEOUT_MS = '30000';

    // Content filtering (default: enabled for security)
    env.CODE_EXECUTOR_CONTENT_FILTERING_ENABLED =
      security.contentFiltering ? 'true' : 'false';

    // System prompt allowlist
    if (security.allowedSystemPrompts) {
      env.CODE_EXECUTOR_ALLOWED_SYSTEM_PROMPTS =
        security.allowedSystemPrompts.join(',');
    }
  }

  // ============================================
  // SECURITY CONFIGURATION
  // ============================================

  // Audit logging (recommended for security)
  if (security.auditLogEnabled) {
    env.ENABLE_AUDIT_LOG = 'true';
    if (security.auditLogPath) {
      env.AUDIT_LOG_PATH = security.auditLogPath;
    }
  }

  // Project path restrictions (sandbox security)
  if (security.allowedProjects && security.allowedProjects.length > 0) {
    env.ALLOWED_PROJECTS = security.allowedProjects.join(':');
  }

  // ============================================
  // SANDBOX CONFIGURATION
  // ============================================

  // Deno path for TypeScript execution
  if (denoPath) {
    env.DENO_PATH = denoPath;
  }

  // Python execution (enabled by default)
  env.PYTHON_ENABLED = 'true';

  // Execution timeout (default: 2 minutes)
  if (performance.executionTimeout) {
    env.CODE_EXECUTOR_TIMEOUT_MS = performance.executionTimeout.toString();
  }

  // ============================================
  // PERFORMANCE TUNING
  // ============================================

  // Schema cache TTL (default: 24 hours)
  if (performance.schemaCacheTTL) {
    env.CODE_EXECUTOR_SCHEMA_CACHE_TTL_MS = performance.schemaCacheTTL.toString();
  }

  // Rate limiting (requests per minute)
  if (performance.rateLimitRPM) {
    env.CODE_EXECUTOR_RATE_LIMIT_RPM = performance.rateLimitRPM.toString();
  }

  // ============================================
  // MCP SERVER DISCOVERY
  // ============================================

  // Explicit MCP config path (optional)
  if (mcpConfigPath) {
    env.MCP_CONFIG_PATH = mcpConfigPath;
  }

  // ============================================
  // RETURN COMPLETE CONFIGURATION
  // ============================================

  return {
    mcpServers: {
      'code-executor': {
        command: 'npx',
        args: ['-y', 'code-executor-mcp'],
        env
      }
    }
  };
}

/**
 * Generate configuration with recommended defaults
 */
export function generateRecommendedConfig(options: {
  samplingProvider?: 'anthropic' | 'openai' | 'gemini' | 'grok' | 'perplexity';
  samplingApiKey?: string;
  denoPath?: string;
  projectRoots?: string[];
}): ReturnType<typeof generateCompleteConfig> {
  const { samplingProvider, samplingApiKey, denoPath, projectRoots } = options;

  return generateCompleteConfig({
    sampling: samplingProvider && samplingApiKey ? {
      enabled: true,
      provider: samplingProvider,
      apiKey: samplingApiKey,
      maxRounds: 10,
      maxTokens: 10000
    } : { enabled: false },

    security: {
      auditLogEnabled: true,
      contentFiltering: true,
      allowedProjects: projectRoots || [],
      allowedSystemPrompts: [
        '',
        'You are a helpful assistant',
        'You are a code analysis expert'
      ]
    },

    performance: {
      executionTimeout: 120000,  // 2 minutes
      schemaCacheTTL: 86400000,  // 24 hours
      rateLimitRPM: 60
    },

    denoPath
  });
}

/**
 * Pretty-print configuration for display
 */
export function formatConfigForDisplay(config: ReturnType<typeof generateCompleteConfig>): string {
  const env = config.mcpServers['code-executor'].env;

  const sections = [
    {
      title: '🤖 AI Sampling',
      enabled: env.CODE_EXECUTOR_SAMPLING_ENABLED === 'true',
      items: [
        `Provider: ${env.CODE_EXECUTOR_AI_PROVIDER || 'disabled'}`,
        `Max Rounds: ${env.CODE_EXECUTOR_MAX_SAMPLING_ROUNDS || '10'}`,
        `Max Tokens: ${env.CODE_EXECUTOR_MAX_SAMPLING_TOKENS || '10000'}`,
        `Content Filtering: ${env.CODE_EXECUTOR_CONTENT_FILTERING_ENABLED || 'true'}`
      ]
    },
    {
      title: '🔒 Security',
      enabled: true,
      items: [
        `Audit Log: ${env.ENABLE_AUDIT_LOG || 'false'}`,
        `Audit Path: ${env.AUDIT_LOG_PATH || 'default'}`,
        `Allowed Projects: ${env.ALLOWED_PROJECTS || 'unrestricted'}`
      ]
    },
    {
      title: '⚡ Performance',
      enabled: true,
      items: [
        `Execution Timeout: ${env.CODE_EXECUTOR_TIMEOUT_MS || '120000'}ms`,
        `Schema Cache TTL: ${env.CODE_EXECUTOR_SCHEMA_CACHE_TTL_MS || '86400000'}ms`,
        `Rate Limit: ${env.CODE_EXECUTOR_RATE_LIMIT_RPM || '60'} req/min`
      ]
    },
    {
      title: '📦 Sandbox',
      enabled: true,
      items: [
        `Deno Path: ${env.DENO_PATH || 'auto-detected'}`,
        `Python: ${env.PYTHON_ENABLED || 'true'}`,
        `MCP Config: ${env.MCP_CONFIG_PATH || 'auto-discover'}`
      ]
    }
  ];

  return sections
    .map(section => {
      const status = section.enabled ? '✓' : '✗';
      const title = `${status} ${section.title}`;
      const items = section.items.map(item => `  ${item}`).join('\n');
      return `${title}\n${items}`;
    })
    .join('\n\n');
}
