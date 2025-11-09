# Code Executor MCP Server

**Universal MCP server for executing TypeScript and Python code with progressive disclosure** - reduces token usage by **98%** compared to exposing all tools directly.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-green.svg)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-105%20passing-brightgreen.svg)](https://github.com/aberemia24/code-executor-MCP)

## 🎯 The Problem

MCP servers with many tools consume excessive context window tokens. For example, a configuration with 47 MCP tools uses ~150,000 tokens just to expose the tool definitions - leaving little room for actual work.

## ✨ The Solution

**Progressive Disclosure**: Expose only 2-3 simple tools (`executeTypescript`, `executePython`, `health`) that provide **on-demand access** to all other MCP tools through injected functions. This reduces token usage from ~150,000 to ~1,600 tokens (**98% reduction**).

### How It Works

1. **LLM calls `executeTypescript`** with code + allowed tools whitelist
2. **Code executes in sandbox** (Deno for TypeScript, subprocess for Python)
3. **Code can call `callMCPTool('mcp__server__tool', params)`** to access other MCP servers
4. **Results returned** to LLM with audit trail

```typescript
// LLM executes this code to access zen MCP server
const result = await callMCPTool('mcp__zen__codereview', {
  code: myCode,
  language: 'typescript'
});
console.log(result);
```

**Token savings**: 47 tools @ ~3,000 tokens each = 141,000 tokens saved!

## 🚀 Features

### ✅ Executors
- **TypeScript/JavaScript** - Deno sandbox with fine-grained permissions
- **Python** - Subprocess execution with MCP access (optional)

### ✅ Security
- **Sandbox execution** - Deno for TypeScript, subprocess for Python
- **Tool allowlist** - Only explicitly allowed tools can be called
- **Dangerous pattern detection** - Blocks `eval()`, `exec()`, `__import__()`, `pickle.loads()`, etc.
- **Path validation** - File system access restricted to allowed projects
- **Network restrictions** - Default: localhost only
- **Rate limiting** - Token bucket algorithm (optional, 30 req/min default)
- **Comprehensive audit logging** - All executions logged with code hash, memory usage

### ✅ Configuration
- **Auto-discovery** - Searches `.code-executor.json` in project/user/XDG directories
- **Environment variables** - Override any setting
- **Secret management** - `env:VAR_NAME` pattern for secure config
- **MCP integration** - Auto-connects to all MCP servers in `.mcp.json`
- **Safe defaults** - Localhost-only network, no write access, 30s timeout

### ✅ Quality
- **Type safe** - Full TypeScript definitions, Zod validation
- **Connection pooling** - Limit concurrent executions (max 100)
- **Error handling** - Graceful degradation, clear error messages
- **Well tested** - 105 tests passing, 90%+ coverage

## 📦 Installation

```bash
npm install -g code-executor-mcp
```

### Prerequisites

- **Node.js** 22.x or higher
- **Deno** (for TypeScript execution) - Install from [deno.land](https://deno.land/)
- **Python** 3.9+ (optional, for Python execution)

## 🔧 Configuration

### Quick Start

Create `.code-executor.json` in your project root:

```json
{
  "version": 1,
  "security": {
    "allowRead": ["/home/user/projects/my-project"],
    "allowWrite": false,
    "allowNetwork": ["localhost", "127.0.0.1"],
    "defaultTimeoutMs": 30000,
    "maxTimeoutMs": 300000,
    "enableAuditLog": true,
    "auditLogPath": "./audit.log",
    "rateLimit": {
      "enabled": true,
      "maxRequests": 30,
      "windowMs": 60000
    }
  },
  "executors": {
    "typescript": {
      "enabled": true,
      "denoPath": "deno"
    },
    "python": {
      "enabled": false,
      "pythonPath": "python3"
    }
  },
  "mcpConfigPath": "./.mcp.json"
}
```

### Configuration Discovery

The server searches for configuration in this order (first found wins):

1. `CODE_EXECUTOR_CONFIG_PATH` environment variable
2. `./.code-executor.json` (project root)
3. `~/.code-executor.json` (user home)
4. `~/.config/code-executor/config.json` (XDG config)

### Environment Variables

Override any setting with environment variables:

```bash
# Security
export ALLOWED_PROJECTS="/home/user/project1:/home/user/project2"
export ENABLE_AUDIT_LOG=true
export AUDIT_LOG_PATH="/var/log/code-executor.log"

# Executors
export DENO_PATH="/usr/local/bin/deno"
export PYTHON_PATH="/usr/bin/python3"

# MCP Configuration
export MCP_CONFIG_PATH="/path/to/custom/mcp.json"

# Explicit config file
export CODE_EXECUTOR_CONFIG_PATH="/etc/code-executor/config.json"
```

### Secret Management

Use `env:VAR_NAME` pattern in configuration files to reference environment variables:

```json
{
  "security": {
    "allowRead": ["env:PROJECT_ROOT"],
    "auditLogPath": "env:AUDIT_LOG_PATH"
  }
}
```

## 📖 Usage

### Add to MCP Configuration

Add to your `.mcp.json` (Claude Code, Cline, etc.):

```json
{
  "mcpServers": {
    "code-executor": {
      "command": "node",
      "args": ["/path/to/code-executor-mcp/dist/index.js"],
      "env": {
        "ALLOWED_PROJECTS": "/home/user/my-project"
      }
    }
  }
}
```

### Execute TypeScript

```typescript
// LLM calls this tool
{
  "code": `
    const files = await callMCPTool('mcp__filesystem__list_directory', { path: '/src' });
    console.log('Files:', files.length);

    for (const file of files) {
      if (file.endsWith('.ts')) {
        const content = await callMCPTool('mcp__filesystem__read_file', { path: file });
        console.log(\`\${file}: \${content.length} bytes\`);
      }
    }
  `,
  "allowedTools": [
    "mcp__filesystem__list_directory",
    "mcp__filesystem__read_file"
  ],
  "timeoutMs": 30000,
  "permissions": {
    "read": ["/home/user/my-project/src"],
    "net": ["localhost"]
  }
}
```

### Execute Python (Optional)

Enable Python in config, then:

```python
# LLM calls this tool
{
  "code": """
import json

# Call MCP tool from Python
result = call_mcp_tool('mcp__zen__thinkdeep', {
    'problem': 'How to optimize this algorithm?',
    'model': 'gemini-2.5-pro'
})

print(json.dumps(result, indent=2))
  """,
  "allowedTools": ["mcp__zen__thinkdeep"],
  "timeoutMs": 120000
}
```

### Health Check

```typescript
// Check server status
{
  // No parameters
}

// Returns:
{
  "healthy": true,
  "auditLog": { "enabled": true },
  "mcpClients": { "connected": 47 },
  "connectionPool": { "active": 0, "waiting": 0, "max": 100 },
  "uptime": 3600.5,
  "timestamp": "2025-01-09T12:00:00.000Z"
}
```

## 🛠️ Creating MCP Tool Wrappers

### Why We Don't Ship Wrappers

**MCP servers update independently.** Their APIs can change at any time without warning.

**Real example from January 2025:**
- Zen MCP changed parameter names: `cli_name` → `model`, `query` → `step`
- Changed data types: `findings: []` → `findings: ''`
- **If we shipped wrappers, they'd be broken** ❌

**The solution:** You create and maintain wrappers that match YOUR installed MCP server versions.

### Copy-Paste Templates

We provide **battle-tested templates** instead of shipped code:

```typescript
// Copy template to your project
cp node_modules/code-executor-mcp/docs/examples/zen-wrapper-template.ts \
   src/lib/mcp/zen.ts

// Adapt to your environment
export async function zenThinkDeep(question: string) {
  const result = await callMCPTool('mcp__zen__thinkdeep', {
    // Update params to match YOUR zen version
    step: question,
    step_number: 1,
    total_steps: 1,
    next_step_required: false,
    findings: '',
    model: 'gemini-2.5-pro'
  });
  return typeof result === 'string' ? JSON.parse(result) : result;
}

// Use it
import { zenThinkDeep } from './lib/mcp/zen';
const analysis = await zenThinkDeep('How to optimize this?');
```

### Available Templates

- **`docs/examples/zen-wrapper-template.ts`** - AI analysis tools (thinkdeep, codereview, etc.)
- **`docs/examples/filesystem-wrapper-template.ts`** - File operations (read, write, search)
- **`docs/examples/CREATING_WRAPPERS.md`** - Complete guide for creating your own

### Benefits of This Approach

✅ **Your wrappers match YOUR MCP server versions**
✅ **You update when YOU update MCP servers**
✅ **No dependency on our release schedule**
✅ **No "broken package" issues**
✅ **Full TypeScript autocomplete in your IDE**

### Quick Start

**1. Copy template:**
```bash
cp docs/examples/zen-wrapper-template.ts src/lib/mcp/zen.ts
```

**2. Adapt to your environment:**
```typescript
// You own this file - update when zen updates
export async function zenThinkDeep(question: string) { /* ... */ }
```

**3. Use throughout your project:**
```typescript
import { zenThinkDeep } from './lib/mcp/zen';
const result = await zenThinkDeep('question');
```

**See `docs/examples/CREATING_WRAPPERS.md` for complete guide.**

---

## 🔒 Security Model

### Principle of Least Privilege

1. **Default: Deny All** - No file system or network access by default
2. **Explicit Allowlist** - Each execution specifies allowed tools
3. **Path Validation** - File paths must be within `allowRead`/`allowWrite`
4. **Pattern Detection** - Dangerous code patterns blocked before execution
5. **Sandbox Isolation** - Deno/subprocess provide OS-level isolation
6. **Rate Limiting** - Token bucket algorithm prevents abuse

### Dangerous Patterns Blocked

**JavaScript/TypeScript:**
- `eval()`, `Function()`, `new Function()`, `.constructor.constructor()`
- `require()`, `import()` (dynamic imports)
- `child_process`, `Deno.run`, `Deno.Command`
- `setTimeout('code')`, `setInterval('code')`

**Python:**
- `exec()`, `__import__()`, `compile()`
- `pickle.loads()` (deserialization RCE)
- `os.system()`, `subprocess.run/call/Popen`
- `globals()`, `locals()`, `__builtins__`
- `open(..., 'w')` (write mode)

### Audit Logging

All executions are logged with:
- **Timestamp** (ISO 8601)
- **Executor type** (typescript/python)
- **Code hash** (SHA-256)
- **Code length** (bytes)
- **Allowed tools** (whitelist)
- **Tools called** (actual usage)
- **Execution time** (milliseconds)
- **Memory usage** (bytes)
- **Success/error** status
- **Client identifier** (for rate limiting)

Example audit log entry:
```json
{
  "timestamp": "2025-01-09T12:00:00.000Z",
  "executor": "typescript",
  "codeHash": "a1b2c3d4e5f6...",
  "codeLength": 1234,
  "allowedTools": ["mcp__filesystem__read_file"],
  "toolsCalled": ["mcp__filesystem__read_file"],
  "executionTimeMs": 150,
  "success": true,
  "clientId": "default",
  "memoryUsage": 12345678
}
```

### Rate Limiting

Optional token bucket rate limiter:

```json
{
  "security": {
    "rateLimit": {
      "enabled": true,
      "maxRequests": 30,
      "windowMs": 60000
    }
  }
}
```

Features:
- **Token bucket algorithm** - Smooth limiting with burst capacity
- **Per-client limiting** - Default: single "default" client (MCP servers run locally)
- **Automatic cleanup** - Stale buckets removed every 5 minutes
- **Graceful errors** - Clear messages with retry timing

## 📊 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  LLM (Claude, GPT-4, etc.)                                  │
│  - Calls executeTypescript/executePython                     │
│  - Provides code + allowlist                                │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  Code Executor MCP Server                                   │
│  ├─ Security Validator (pattern detection, allowlist)       │
│  ├─ Rate Limiter (token bucket, optional)                   │
│  ├─ Connection Pool (max 100 concurrent)                    │
│  └─ Config Discovery (.code-executor.json, env vars)        │
└──────────────────┬──────────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
┌──────────────┐    ┌──────────────────┐
│ Deno Sandbox │    │ Python Subprocess│
│ (TypeScript) │    │ (Python 3.9+)    │
│              │    │                  │
│ callMCPTool()│    │ call_mcp_tool()  │
└──────┬───────┘    └──────┬───────────┘
       │                   │
       └─────────┬─────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  MCP Proxy Server (HTTP, localhost-only)                    │
│  ├─ Allowlist Validator                                      │
│  ├─ Tool Call Tracker                                        │
│  └─ Error Normalization                                      │
└──────────────────┬──────────────────────────────────────────┘
                   │
        ┌──────────┴──────────┬──────────┬─────────┐
        │                     │          │         │
        ▼                     ▼          ▼         ▼
┌──────────────┐    ┌─────────────┐  ┌────────┐ ┌────┐
│ MCP Client   │    │ MCP Client  │  │  MCP   │ │... │
│ (zen)        │    │ (filesystem)│  │(fetcher)│ │ 47 │
│ thinkdeep    │    │ read_file   │  │fetch_url│ │tools│
│ codereview   │    │ write_file  │  │         │ │total│
└──────────────┘    └─────────────┘  └────────┘ └────┘
```

## 🧪 Development

### Setup

```bash
git clone https://github.com/aberemia24/code-executor-MCP.git
cd code-executor-MCP
npm install
```

### Commands

```bash
npm run build       # Build TypeScript
npm test            # Run tests (105 passing)
npm run typecheck   # Type check only
npm run dev         # Watch mode
```

### Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

**Current Status:** ✅ 105 tests passing | ✅ 90%+ coverage | ✅ Clean TypeScript build

## 📈 Progressive Disclosure Pattern

### Traditional Approach (❌ ~150,000 tokens)
- Load all 47 MCP tool definitions upfront
- Wasted context on unused tools
- Tools: 47 × ~3,000 tokens = ~141,000 tokens
- Overhead: ~9,000 tokens (descriptions, schemas)
- **Total: ~150,000 tokens**

### Progressive Disclosure (✅ ~1,600 tokens)
- Load only 2-3 code-executor tool definitions
- Tools loaded on-demand via `callMCPTool()`
- Tools: 2-3 × ~500 tokens = ~1,000-1,500 tokens
- Overhead: ~100 tokens
- **Total: ~1,600 tokens**

**Savings: 98% reduction** (148,400 tokens saved!)

### Real-World Example

```typescript
// Instead of exposing 47 tools, the LLM writes code that discovers and uses them:
const allTools = await callMCPTool('mcp__code-executor__health', {});
console.log(`Available: ${allTools.mcpClients.connected} tools`);

// Then uses tools as needed
for (const file of files) {
  const content = await callMCPTool('mcp__filesystem__read_file', { path: file });
  const review = await callMCPTool('mcp__zen__codereview', { code: content });

  if (review.issues.length > 0) {
    await callMCPTool('mcp__filesystem__write_file', {
      path: `${file}.review.md`,
      content: JSON.stringify(review, null, 2)
    });
  }
}
```

## 🤝 Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Code Quality Standards

- ✅ TypeScript strict mode
- ✅ 90%+ test coverage on business logic
- ✅ All tests passing
- ✅ ESLint + Prettier
- ✅ Meaningful commit messages

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🔐 Security

Found a security vulnerability? See [SECURITY.md](SECURITY.md) for responsible disclosure.

**Please do not open public issues for security vulnerabilities.**

## 🙏 Acknowledgments

- **Model Context Protocol (MCP)** - Anthropic's standard for LLM-tool communication
- **Deno** - Secure TypeScript runtime with fine-grained permissions
- **Progressive Disclosure Pattern** - UI/UX principles applied to LLM context management

## 📚 Related

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [Claude Code Documentation](https://docs.claude.com/claude-code)
- [Deno Documentation](https://docs.deno.com/)
- [Token Bucket Algorithm](https://en.wikipedia.org/wiki/Token_bucket)

---

**Made with ❤️ for the MCP community** | **98% token savings** | **Production-ready security** | **105 tests passing**
