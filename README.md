# Code Executor MCP Server

**Universal MCP server for executing TypeScript and Python code with progressive disclosure** - reduces token usage by **98%** compared to exposing all tools directly.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-green.svg)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-122%20passing-brightgreen.svg)](https://github.com/aberemia24/code-executor-MCP)

> **Based on** [Anthropic's official guide to Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)

> **⚠️ Built for Claude Code:** This MCP server was developed and tested **exclusively with Claude Code**. While it follows MCP standards, **no testing has been performed** on other MCP clients (Claude Desktop, Cline, Roo, etc.). Use with other clients at your own risk.

## 🎯 The Problem

Tired of constantly toggling MCPs on and off in Claude Code? Need filesystem access, so you enable it. Done with that, now need zen for code review? Disable filesystem, enable zen. It's tedious and wastes context on unused tools.

With many MCP servers enabled simultaneously, you can easily hit context limits just loading tool definitions - leaving little room for actual work.

## ✨ The Solution: One MCP to Rule Them All

**Keep ALL your MCPs disabled. Enable ONLY code-executor.**

Based on Anthropic's code execution pattern, code-executor exposes up to 2 tools (`executeTypescript`, `executePython`) that can access **all your other MCPs on-demand**. No more toggling. No context bloat.

**Progressive Disclosure**: Instead of Claude directly accessing 47 tools (consuming ~150k tokens), Claude writes code that accesses those tools when needed (~1.6k tokens = **98% reduction**).

**Note:** `executeTypescript` requires Deno. Without Deno, only `executePython` is available (still works, just Python-only).

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
- **TypeScript/JavaScript** - Deno sandbox with fine-grained permissions (requires Deno)
- **Python** - Subprocess execution with MCP access (enabled via config)

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

### Option 1: Docker (Recommended for Production)

**Production-grade containerized deployment with security hardening.**

```bash
# 1. Build the image locally
cd code-executor-mcp
npm run build  # Build TypeScript first
docker build -t code-executor-mcp:1.3.0 .

# 2. Run with docker-compose (recommended)
docker-compose up -d

# 3. Or run manually with security options
docker run -d \
  --name code-executor \
  --read-only \
  -v /tmp/code-executor \
  -m 512m \
  --cpus="0.5" \
  --pids-limit=100 \
  --security-opt=no-new-privileges \
  --cap-drop=ALL \
  code-executor-mcp:1.3.0
```

**Docker Security Features:**
- ✅ Non-root user (UID 1001)
- ✅ Read-only root filesystem
- ✅ Resource limits (memory, CPU, PIDs)
- ✅ Network isolation (no external access by default)
- ✅ All capabilities dropped
- ✅ Custom seccomp profile (syscall filtering)
- ✅ Tini init system (zombie process reaping)

**Testing Docker Security:**
```bash
# Run comprehensive security test suite
./test-docker-security.sh
```

See [DOCKER_TESTING.md](DOCKER_TESTING.md) for detailed testing procedures.

### Option 2: NPM (Development/Local)

```bash
# Install globally
npm install -g code-executor-mcp

# Or install locally for development
git clone https://github.com/aberemia24/code-executor-MCP.git
cd code-executor-mcp
npm install
npm run build
```

### Running the Server

**After global install:**
```bash
code-executor-mcp
```

**Local development:**
```bash
npm run server  # Build + start
# or
npm start  # Start (requires build first)
```

**Link for local CLI testing:**
```bash
npm link  # Creates global symlink
code-executor-mcp  # Run from anywhere
```

### Prerequisites

**For NPM installation:**
- **Node.js** 22.x or higher (required)
- **Deno** (recommended, enables TypeScript execution) - Install from [deno.land](https://deno.land/)
  ```bash
  # Quick install (Linux/macOS)
  curl -fsSL https://deno.land/install.sh | sh

  # Or use your package manager
  brew install deno  # macOS
  choco install deno  # Windows
  ```
- **Python** 3.9+ (optional, enables Python execution)

**Note:** Without Deno, only `executePython` tool will be available. TypeScript execution (`executeTypescript`) requires Deno.

**For Docker installation:**
- **Docker** 20.10+ and **Docker Compose** 2.0+
- All dependencies (Node.js, Deno, Python) are included in the image

## 🔧 Configuration

### Docker Configuration

When running in Docker, configure via `docker-compose.yml`:

```yaml
services:
  code-executor:
    image: code-executor-mcp:1.3.0
    environment:
      # Security
      ALLOWED_PROJECTS: "/app/projects"
      ENABLE_AUDIT_LOG: "true"
      AUDIT_LOG_PATH: "/app/audit.log"

      # Executors
      DENO_PATH: "/usr/bin/deno"
      PYTHON_PATH: "/usr/bin/python3"

      # MCP Configuration (optional)
      MCP_CONFIG_PATH: "/app/.mcp.json"

    volumes:
      # Mount your project (read-only)
      - ./my-project:/app/projects:ro

      # Mount MCP config if using other servers
      - ./.mcp.json:/app/.mcp.json:ro

      # Writable temp directory
      - /tmp/code-executor

    # Security constraints
    read_only: true
    mem_limit: 512m
    cpus: 0.5
    pids_limit: 100
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges
      - seccomp=./seccomp-profile.json
```

**Note:** The Docker image includes a default `.mcp.json` with zero servers (standalone mode). Mount your own `.mcp.json` to enable MCP tool access.

### Local Configuration

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

### Add to MCP Configuration (Claude Code)

Add to your `.mcp.json` (tested with Claude Code only):

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

### MCP Transport Types

Code-executor supports **two transport types** for connecting to other MCP servers:

#### 1. STDIO (Local Servers)

For local MCP servers spawned as child processes:

```json
{
  "mcpServers": {
    "zen": {
      "command": "npx",
      "args": ["-y", "zen-mcp-server"],
      "env": {
        "GEMINI_API_KEY": "your-key-here"
      }
    }
  }
}
```

#### 2. HTTP/SSE (Remote Servers)

For remote HTTP-based MCP servers (Linear, GitHub, etc.) with authentication:

```json
{
  "mcpServers": {
    "linear": {
      "type": "http",
      "url": "https://mcp.linear.app/mcp",
      "headers": {
        "Authorization": "Bearer your-api-token-here"
      }
    },
    "github": {
      "type": "http",
      "url": "https://api.github.com/mcp",
      "headers": {
        "Authorization": "token ghp_your_token_here",
        "Accept": "application/vnd.github.v3+json"
      }
    }
  }
}
```

**How it works:**
- Code-executor tries **StreamableHTTP first** (modern, bidirectional)
- Falls back to **SSE** (Server-Sent Events) if StreamableHTTP unavailable
- Supports authentication via HTTP headers (`Authorization`, custom headers)

**Use cases:**
- ✅ Linear MCP (project management via HTTP)
- ✅ GitHub MCP (repository operations via API)
- ✅ Any OAuth/token-authenticated MCP service
- ✅ Internal company MCP servers

> **⚠️ Important:** Code-executor reads MCP servers from the **project-level `.mcp.json`** file (configured via `mcpConfigPath` in `.code-executor.json`). It does **NOT** read from user-level MCP configs like `~/.config/claude/claude_desktop_config.json`. All MCP servers must be defined in your project's `.mcp.json`.

#### Authentication Flow for SSE/HTTP MCPs (Claude Code)

For SSE MCPs that require OAuth (Linear, GitHub, etc.):

1. **Enable MCP** - Type `/mcp` in Claude Code to open MCP management

2. **Authenticate** - Complete OAuth flow from Claude Code's MCP interface (browser will open)

3. **Disable MCP** - Type `/mcp` or `@mcp` and press Enter to disable the MCP in Claude Code

4. **Code-executor takes over** - The MCP is now authenticated and available to code-executor, but disabled in Claude Code to prevent duplicate loading

> **⚠️ Critical:** Do **NOT** delete the MCP from `.mcp.json` - just disable it via `/mcp`. If you delete it, code-executor won't have access anymore. The MCP must remain in the config file (disabled state).

> **📝 Note:** This authentication flow is for **Claude Code only**. The entire code-executor MCP server has been developed and tested **exclusively with Claude Code**. Other MCP clients have not been tested and may not work correctly.

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

**Real example:**
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

### Multi-Layer Defense Strategy

**Code-executor implements defense-in-depth with multiple security layers:**

1. **Path Traversal Protection (CWE-22)**
   - Symlink resolution with `fs.realpath()`
   - Canonical path validation before access
   - Prevents directory escape attacks

2. **SSRF Protection (CWE-918)**
   - Comprehensive IP blocklist (localhost, RFC 1918 private networks)
   - Cloud metadata endpoint filtering (AWS, GCP, Azure)
   - Hostname and resolved IP validation

3. **HTTP Proxy Authentication (CWE-306)**
   - Cryptographically secure bearer tokens (32 bytes)
   - All sandbox-to-MCP communication authenticated
   - Prevents unauthorized tool access

4. **Temp File Integrity (CWE-345)**
   - SHA-256 hash verification after write
   - Detects tampering before execution
   - Race condition prevention

5. **Container Isolation (Docker)**
   - Non-root user execution (UID 1001)
   - Read-only root filesystem
   - Network isolation (no external access)
   - Resource limits (memory, CPU, PIDs)
   - Syscall filtering (seccomp profile)

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

## 🚀 Production Deployment

### Docker Deployment (Recommended)

**1. Build Production Image**
```bash
# Install dependencies and build
npm ci
npm run build

# Build Docker image
docker build -t code-executor-mcp:1.3.0 .

# Tag for registry (optional)
docker tag code-executor-mcp:1.3.0 your-registry/code-executor-mcp:1.3.0
```

**2. Deploy with Docker Compose**
```bash
# Start service
docker-compose up -d

# View logs
docker-compose logs -f code-executor

# Stop service
docker-compose down
```

**3. Security Checklist**
- ✅ Run as non-root (UID 1001)
- ✅ Enable read-only filesystem
- ✅ Set resource limits (512MB RAM, 0.5 CPU)
- ✅ Drop all capabilities
- ✅ Use seccomp profile
- ✅ Network isolation (default)
- ✅ Mount projects read-only
- ✅ Enable audit logging

**4. Health Monitoring**
```bash
# Health check via Docker
docker exec code-executor node -e "console.log('healthy')"

# Check container status
docker ps --filter name=code-executor

# View resource usage
docker stats code-executor
```

### Production Configuration

```yaml
# docker-compose.yml for production
services:
  code-executor:
    image: code-executor-mcp:1.3.0
    restart: unless-stopped
    read_only: true
    mem_limit: 512m
    cpus: 0.5
    pids_limit: 100

    environment:
      NODE_ENV: production
      ENABLE_AUDIT_LOG: "true"
      AUDIT_LOG_PATH: "/app/audit.log"

    volumes:
      # Projects (read-only)
      - /var/projects:/app/projects:ro

      # Audit logs (persistent)
      - ./logs:/app/logs

      # Temp directory
      - /tmp/code-executor

    cap_drop:
      - ALL

    security_opt:
      - no-new-privileges
      - seccomp=./seccomp-profile.json

    networks:
      - isolated

networks:
  isolated:
    driver: bridge
    internal: true  # No external network access
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

# Docker development
npm run docker:build    # Build Docker image
npm run docker:test     # Run security tests
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

**Current Security Status:**
- ✅ Path traversal protection (symlink resolution)
- ✅ SSRF mitigation (IP blocklist)
- ✅ HTTP proxy authentication (bearer tokens)
- ✅ Temp file integrity (SHA-256 verification)
- ✅ Docker containerization (multi-layer isolation)
- ✅ Comprehensive audit logging

Found a security vulnerability? See [SECURITY.md](SECURITY.md) for:
- Documented vulnerabilities and mitigations
- Responsible disclosure process
- Security audit history

**Please do not open public issues for security vulnerabilities.**

**Testing Security:**
```bash
# Run comprehensive Docker security tests
./test-docker-security.sh

# View audit logs
tail -f audit.log

# Check security configuration
docker inspect code-executor | jq '.[0].HostConfig.SecurityOpt'
```

## 🙏 Acknowledgments

- **Model Context Protocol (MCP)** - Anthropic's standard for LLM-tool communication
- **Deno** - Secure TypeScript runtime with fine-grained permissions
- **Progressive Disclosure Pattern** - UI/UX principles applied to LLM context management

## 📚 Related

**MCP & Code Execution:**
- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [Claude Code Documentation](https://docs.claude.com/claude-code)
- [Anthropic's Code Execution Guide](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Deno Documentation](https://docs.deno.com/)

**Security:**
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CWE-22: Path Traversal](https://cwe.mitre.org/data/definitions/22.html)
- [CWE-918: SSRF](https://cwe.mitre.org/data/definitions/918.html)
- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [Seccomp Security Profiles](https://docs.docker.com/engine/security/seccomp/)

**Algorithms & Patterns:**
- [Token Bucket Algorithm](https://en.wikipedia.org/wiki/Token_bucket)
- [Progressive Disclosure (UX)](https://www.nngroup.com/articles/progressive-disclosure/)

**Project Documentation:**
- [SECURITY.md](SECURITY.md) - Vulnerability documentation and mitigations
- [DOCKER_TESTING.md](DOCKER_TESTING.md) - Docker security testing procedures
- [CLAUDE.md](CLAUDE.md) - AI assistant context and standards

---

**Made with ❤️ for anyone really. this has always been a pain point. i am sure that anthropic will release an official something for this, until then, hope this helps.
