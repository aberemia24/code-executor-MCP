#!/bin/sh
set -e

##############################################################################
# Docker Entrypoint Script - First-Run Configuration
#
# Generates complete MCP configuration from environment variables on first run
# Ensures Docker deployments have comprehensive config (sampling + security + sandbox + performance)
##############################################################################

CONFIG_FILE="/app/config/.mcp.json"

echo "🐳 Code Executor MCP - Docker Entrypoint"

# First-run detection: Generate complete config from environment variables
if [ ! -f "$CONFIG_FILE" ]; then
  echo ""
  echo "📝 First run detected - generating MCP configuration from environment variables..."
  echo ""

  # Use Node.js to generate config using our TypeScript template
  node -e "
    const { generateCompleteConfig } = require('./dist/cli/templates/mcp-config-template.js');
    const fs = require('fs');
    const path = require('path');

    // Determine provider and extract API key
    const provider = process.env.CODE_EXECUTOR_AI_PROVIDER || 'anthropic';
    const providerKeyMap = {
      'anthropic': process.env.ANTHROPIC_API_KEY,
      'openai': process.env.OPENAI_API_KEY,
      'gemini': process.env.GEMINI_API_KEY,
      'grok': process.env.GROK_API_KEY,
      'perplexity': process.env.PERPLEXITY_API_KEY
    };

    const apiKey = providerKeyMap[provider];
    const samplingEnabled = process.env.CODE_EXECUTOR_SAMPLING_ENABLED === 'true';

    // Parse allowed models (comma-separated)
    const allowedModels = process.env.CODE_EXECUTOR_ALLOWED_MODELS
      ? process.env.CODE_EXECUTOR_ALLOWED_MODELS.split(',')
      : [];

    // Generate complete configuration
    const config = generateCompleteConfig({
      sampling: samplingEnabled && apiKey ? {
        enabled: true,
        provider: provider,
        apiKey: apiKey,
        model: allowedModels[0],
        maxRounds: parseInt(process.env.CODE_EXECUTOR_MAX_SAMPLING_ROUNDS || '10'),
        maxTokens: parseInt(process.env.CODE_EXECUTOR_MAX_SAMPLING_TOKENS || '10000')
      } : { enabled: false },
      security: {
        auditLogEnabled: process.env.ENABLE_AUDIT_LOG !== 'false',
        contentFiltering: process.env.CODE_EXECUTOR_CONTENT_FILTERING_ENABLED !== 'false',
        allowedProjects: process.env.ALLOWED_PROJECTS ? process.env.ALLOWED_PROJECTS.split(':') : []
      },
      performance: {
        executionTimeout: parseInt(process.env.CODE_EXECUTOR_TIMEOUT_MS || '120000'),
        schemaCacheTTL: parseInt(process.env.CODE_EXECUTOR_SCHEMA_CACHE_TTL_MS || '86400000'),
        rateLimitRPM: parseInt(process.env.CODE_EXECUTOR_RATE_LIMIT_RPM || '60')
      },
      denoPath: process.env.DENO_PATH || '/usr/local/bin/deno'
    });

    // Ensure config directory exists
    const configDir = path.dirname('$CONFIG_FILE');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Write configuration
    fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2));

    console.log('✅ Configuration created successfully');
  " || {
    echo ""
    echo "❌ Failed to generate configuration"
    echo "   Using default minimal configuration..."
    echo ""

    # Fallback: Create minimal config
    mkdir -p /app/config
    echo '{
  "mcpServers": {
    "code-executor": {
      "command": "npx",
      "args": ["-y", "code-executor-mcp"],
      "env": {}
    }
  }
}' > "$CONFIG_FILE"
  }

  echo ""
  echo "📍 Configuration location: $CONFIG_FILE"
  echo ""

  # Show config summary (without exposing API keys)
  if [ "$CODE_EXECUTOR_SAMPLING_ENABLED" = "true" ]; then
    echo "🤖 AI Sampling: ENABLED"
    echo "   Provider: ${CODE_EXECUTOR_AI_PROVIDER:-anthropic}"
  else
    echo "🤖 AI Sampling: DISABLED"
  fi

  echo "🔒 Security: Audit logs $([ "$ENABLE_AUDIT_LOG" != "false" ] && echo "ENABLED" || echo "DISABLED")"
  echo "⚡ Performance: Timeout ${CODE_EXECUTOR_TIMEOUT_MS:-120000}ms"
  echo ""

else
  echo ""
  echo "✓ Configuration found: $CONFIG_FILE"
  echo ""
fi

# Display startup info
echo "🚀 Starting Code Executor MCP Server..."
echo "   Version: $(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")"
echo "   Node.js: $(node --version)"
echo "   Deno: $(deno --version 2>/dev/null | head -1 || echo "not found")"
echo ""

# Execute the main command (typically "node dist/index.js")
exec "$@"
