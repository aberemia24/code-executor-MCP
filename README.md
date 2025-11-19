# Code Executor MCP

**Stop hitting the 2-3 MCP server wall.** One MCP to orchestrate them all - 98% token savings, unlimited tool access.

[![npm version](https://img.shields.io/npm/v/code-executor-mcp.svg)](https://www.npmjs.com/package/code-executor-mcp)
[![Docker Pulls](https://img.shields.io/docker/pulls/aberemia24/code-executor-mcp.svg)](https://hub.docker.com/r/aberemia24/code-executor-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why Use Code Executor MCP?

- **98% Token Reduction** - 141k → 1.6k tokens (load 1 executor vs 50+ tools)
- **Sandboxed Security** - Isolated Deno/Python execution, no internet by default, audit logging
- **Type-Safe Wrappers** - Auto-generated TypeScript/Python SDK with full IntelliSense
- **Progressive Disclosure** - Tools loaded on-demand inside sandbox, not upfront in context
- **Zero Config Setup** - Wizard auto-detects existing MCP servers from Claude Code/Cursor
- **Production Ready** - 606 tests, 95%+ coverage, Docker support, rate limiting

## The Problem

You can't use more than 2-3 MCP servers before context exhaustion kills you.

- **Research confirms:** [Tool accuracy drops significantly after 2-3 servers](https://www.mcpjam.com/blog/claude-agent-skills)
- **6,490+ MCP servers available**, but you can only use 2-3
- **47 tools = 141k tokens** consumed before you write a single word

**You're forced to choose:** filesystem OR browser OR git OR AI tools. Never all of them.

## The Solution

Disable all MCPs. Enable only `code-executor-mcp`.

```bash
# Before: 47 tools, 141k tokens
mcp__filesystem__read_file
mcp__filesystem__write_file
mcp__git__commit
mcp__browser__navigate
... 43 more tools

# After: 2 tools, 1.6k tokens (98% reduction)
run-typescript-code
run-python-code
```

**Inside the sandbox**, access ANY MCP tool on-demand:

```typescript
// Claude writes this automatically
const file = await callMCPTool('mcp__filesystem__read_file', { path: '/src/app.ts' });
const review = await callMCPTool('mcp__zen__codereview', { code: file });
await callMCPTool('mcp__git__commit', { message: review.suggestions });
```

**Result:** Unlimited MCP access, zero context overhead.

### How Progressive Disclosure Works

```mermaid
sequenceDiagram
    participant C as Claude/Cursor
    participant E as Code Executor
    participant M as Other MCPs

    Note over C: ❌ Traditional: Load 50+ tools (141k tokens)

    Note over C: ✅ Code Executor: Load 2 tools (1.6k tokens)
    C->>E: run-typescript-code

    rect rgb(240, 248, 255)
        Note right of E: Sandbox (on-demand discovery)
        E->>M: callMCPTool('mcp__filesystem__read_file')
        M-->>E: Return data
    end

    E-->>C: Return result
```

Traditional MCP exposes all 47 tools upfront (141k tokens). Code Executor exposes 2 tools with outputSchema (1.6k tokens), loading others on-demand inside the sandbox when needed.

## Quick Start

### Option 1: Interactive Setup Wizard (Recommended)

Don't configure manually. Our wizard does everything:

```bash
npm install -g code-executor-mcp
code-executor-mcp setup
```

**What the wizard does:**
1. 🔍 Scans for existing MCP configs (Claude Code `~/.claude.json`, Cursor `~/.cursor/mcp.json`, project `.mcp.json`)
2. ⚙️ Configures with smart defaults (or customize interactively)
3. 📦 Generates type-safe TypeScript/Python wrappers for autocomplete
4. 📅 Optional: Sets up daily sync to keep wrappers updated

**Smart defaults** (just press Enter):
- Port: 3333 | Timeout: 30s | Rate limit: 30/min
- Audit logs: `~/.code-executor/audit-logs/`

**Supported AI Tools:** Claude Code and Cursor (more coming soon)

#### What are Wrappers?

The wizard generates TypeScript/Python wrapper functions for your MCP tools:

**Before** (manual):
```typescript
const file = await callMCPTool('mcp__filesystem__read_file', {
  path: '/src/app.ts'
});
```

**After** (wrapper):
```typescript
import { filesystem } from './mcp-wrappers';
const file = await filesystem.readFile({ path: '/src/app.ts' });
```

**Benefits:**
- ✅ Type-safe with full IntelliSense/autocomplete
- ✅ Self-documenting JSDoc comments from schemas
- ✅ No need to remember exact tool names
- ✅ Matches actual MCP tool APIs (generated from schemas)

**Keeping Wrappers Updated:**

The wizard can set up daily sync (optional) to automatically regenerate wrappers:

- **macOS**: launchd plist runs at 4-6 AM
- **Linux**: systemd timer runs at 4-6 AM
- **Windows**: Task Scheduler runs at 4-6 AM

Daily sync re-scans your AI tool configs and project config for new/removed MCP servers. You can also manually update anytime with `code-executor-mcp setup`.

### Option 2: Manual Configuration

#### 1. Install

```bash
npm install -g code-executor-mcp
```

#### 2. Configure

**IMPORTANT:** Code-executor discovers and merges MCP servers from BOTH locations:
- **Global:** `~/.claude.json` (cross-project MCPs like voice-mode, personal tools)
- **Project:** `.mcp.json` (team-shared MCPs in your project root)

**Config Merging:** Global MCPs + Project MCPs = All available (project overrides global for duplicate names)

Add to your **project** `.mcp.json` or **global** `~/.claude.json`:

```json
{
  "mcpServers": {
    "code-executor": {
      "command": "npx",
      "args": ["-y", "code-executor-mcp"],
      "env": {
        "MCP_CONFIG_PATH": "/full/path/to/this/.mcp.json",
        "DENO_PATH": "/path/to/.deno/bin/deno"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp", "--headless"]
    }
  }
}
```

**Configuration Guide:**
- `MCP_CONFIG_PATH`: Optional - points to project `.mcp.json` (still discovers global `~/.claude.json`)
- `DENO_PATH`: Run `which deno` to find it (required for TypeScript execution)
- **Global MCPs** (`~/.claude.json`): Personal servers available across all projects
- **Project MCPs** (`.mcp.json`): Team-shared servers in version control
- **Connection Flow**: Claude Code → code-executor ONLY, then code-executor → all other MCPs

**Quick Setup:**
```bash
# Find Deno path
which deno
# Output: /home/user/.deno/bin/deno

# Project config (team-shared)
realpath .mcp.json
# Output: /home/user/projects/myproject/.mcp.json

# Global config (personal)
ls ~/.claude.json
# Output: /home/user/.claude.json

# Code-executor automatically merges both!
```

**Minimal (Python-only):**
```json
{
  "mcpServers": {
    "code-executor": {
      "command": "npx",
      "args": ["-y", "code-executor-mcp"],
      "env": {
        "MCP_CONFIG_PATH": "/path/to/.mcp.json",
        "PYTHON_ENABLED": "true"
      }
    }
  }
}
```

#### 3. Use

Claude can now access any MCP tool through code execution:

```typescript
// Claude writes this when you ask to "read package.json"
const result = await callMCPTool('mcp__filesystem__read_file', {
  path: './package.json'
});
console.log(result);
```

That's it. No configuration, no allowlists, no manual tool setup.

## Real-World Example

**Task:** "Review auth.ts for security issues and commit fixes"

**Without code-executor** (impossible - hit context limit):
```
Can't enable: filesystem + git + zen codereview
Pick 2, manually do the 3rd
```

**With code-executor** (single AI message):
```typescript
// Read file
const code = await callMCPTool('mcp__filesystem__read_file', {
  path: '/src/auth.ts'
});

// Review with AI
const review = await callMCPTool('mcp__zen__codereview', {
  step: 'Security audit',
  code: code,
  step_number: 1,
  total_steps: 1
});

// Apply fixes
const fixed = review.suggestions.replace(/timing-attack/g, 'constant-time');

await callMCPTool('mcp__filesystem__write_file', {
  path: '/src/auth.ts',
  content: fixed
});

// Commit
await callMCPTool('mcp__git__commit', {
  message: 'fix: constant-time token comparison'
});

console.log('Security fixes applied and committed');
```

**All in ONE tool call.** Variables persist, no context switching.

## Features

| Feature | Description |
|---------|-------------|
| **98% Token Savings** | 141k → 1.6k tokens (47 tools → 2 tools) |
| **Unlimited MCPs** | Access 6,490+ MCP servers without context limits |
| **Multi-Step Workflows** | Chain multiple MCP calls in one execution |
| **Auto-Discovery** | AI agents find tools on-demand (0 token cost) |
| **Deep Validation** | AJV schema validation with helpful error messages |
| **Security** | Sandboxed (Deno/Python), allowlists, audit logs, rate limiting |
| **Production Ready** | TypeScript, 606 tests, 95%+ coverage, Docker support |

## Security (Enterprise-Grade)

Code Executor doesn't just "run code." It secures it:

| Feature | Implementation |
|---------|---------------|
| **Sandbox Isolation** | Deno (TypeScript) with restricted permissions, Pyodide WebAssembly (Python) |
| **File Access Control** | Non-root user (UID 1001), read-only root FS, explicit project path allowlist |
| **Network Policy** | NO internet by default, explicit domain allowlist required |
| **Path Validation** | Symlink resolution, directory traversal protection |
| **Audit Logging** | Every execution logged to `~/.code-executor/audit.jsonl` with timestamps |
| **Rate Limiting** | 30 requests/min default (configurable per MCP) |
| **Dangerous Pattern Detection** | Blocks eval, exec, __import__, pickle.loads |
| **Schema Validation** | AJV deep validation before execution |
| **SSRF Protection** | Blocks AWS metadata, localhost, private IPs |

**Example**: Block all internet except GitHub API:
```json
{
  "security": {
    "allowedDomains": ["api.github.com"],
    "allowedProjects": ["/home/user/projects"]
  }
}
```

**Sandbox Architecture:**
- **Deno (TypeScript)**: V8 isolate, explicit permissions (--allow-read=/tmp), no shell access
- **Pyodide (Python)**: WebAssembly sandbox, virtual filesystem, network restricted to MCP proxy only
- **Docker (Optional)**: Non-root container, read-only root, minimal attack surface

See [SECURITY.md](SECURITY.md) for complete threat analysis and security model.

## Advanced Usage

### Allowlists (Optional Security)

Restrict which tools can be executed:

```typescript
await callMCPTool('mcp__code-executor__run-typescript-code', {
  code: `
    // This works
    await callMCPTool('mcp__filesystem__read_file', {...});

    // This fails - not in allowlist
    await callMCPTool('mcp__git__push', {...});
  `,
  allowedTools: ['mcp__filesystem__read_file']
});
```

### Discovery Functions

AI agents can explore available tools:

```typescript
// Find all tools
const tools = await discoverMCPTools();

// Search for specific functionality
const fileTools = await searchTools('file read write');

// Inspect schema
const schema = await getToolSchema('mcp__filesystem__read_file');
```

**Zero token cost** - discovery functions hidden from AI agent's tool list.

### Multi-Action Workflows

Complex automation in a single tool call:

```typescript
// Launch browser → navigate → interact → extract
await callMCPTool('mcp__code-executor__run-typescript-code', {
  code: `
    await callMCPTool('mcp__playwright__launch', { headless: false });
    await callMCPTool('mcp__playwright__navigate', { url: 'https://example.com' });
    const title = await callMCPTool('mcp__playwright__evaluate', {
      script: 'document.title'
    });
    console.log('Page title:', title);
  `,
  allowedTools: ['mcp__playwright__*']
});
```

State persists across calls - no context switching.

### Python Execution (Pyodide WebAssembly)

Secure Python execution with Pyodide sandbox:

**Enable Python:**
```bash
# Set environment variable (REQUIRED)
export PYTHON_SANDBOX_READY=true

# Enable in config
# .code-executor.json
{
  "executors": {
    "python": {
      "enabled": true
    }
  }
}
```

**Example - Python with MCP tools:**
```python
import asyncio

async def main():
    # Discover available tools
    tools = await discover_mcp_tools()
    print(f'Found {len(tools)} tools')

    # Call MCP tool to read file
    content = await call_mcp_tool('mcp__filesystem__read_file', {
        'path': '/tmp/data.json'
    })
    print(f'File content: {content}')

    # Process data
    import json
    data = json.loads(content)
    result = [x * 2 for x in data['numbers']]
    print(f'Processed: {result}')

asyncio.run(main())
```

**Security guarantees:**
- ✅ WebAssembly sandbox (same security as Deno)
- ✅ Virtual filesystem (no host file access)
- ✅ Network restricted to authenticated MCP proxy
- ✅ No subprocess spawning
- ✅ Memory limited by V8 heap

**Limitations:**
- Pure Python only (no native C extensions unless WASM-compiled)
- ~2-3s first load (Pyodide npm package), <100ms cached
- No multiprocessing/threading (use async/await)
- 10-30% slower than native Python (WASM overhead acceptable for security)

See [SECURITY.md](SECURITY.md#-python-executor-security-pyodide) for complete security model.

## Installation Options

### npm (Recommended)

```bash
npm install -g code-executor-mcp
code-executor-mcp
```

### Docker (Production)

```bash
docker pull aberemia24/code-executor-mcp:latest
docker run -p 3333:3333 aberemia24/code-executor-mcp:latest
```

See [DOCKER_TESTING.md](DOCKER_TESTING.md) for security details.

### Local Development

```bash
git clone https://github.com/aberemia24/code-executor-MCP.git
cd code-executor-mcp
npm install && npm run build
npm run server
```

## Configuration

**Complete Example** (`.mcp.json`):

```json
{
  "mcpServers": {
    "code-executor": {
      "command": "npx",
      "args": ["-y", "code-executor-mcp"],
      "env": {
        "MCP_CONFIG_PATH": "/absolute/path/to/.mcp.json",
        "DENO_PATH": "/home/user/.deno/bin/deno",
        "ENABLE_AUDIT_LOG": "true",
        "AUDIT_LOG_PATH": "/home/user/.code-executor/audit.log",
        "ALLOWED_PROJECTS": "/home/user/projects:/tmp"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]
    },
    "zen": {
      "command": "uvx",
      "args": ["--from", "git+https://github.com/zen-mcp.git", "zen-mcp-server"],
      "env": {
        "GEMINI_API_KEY": "your-key-here"
      }
    }
  }
}
```

**Environment Variables:**
| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `MCP_CONFIG_PATH` | ⚠️ Optional | Explicit path to project `.mcp.json` | `/home/user/projects/myproject/.mcp.json` |
| `DENO_PATH` | ✅ For TypeScript | Path to Deno binary | `/home/user/.deno/bin/deno` |
| `ENABLE_AUDIT_LOG` | ⚠️ Recommended | Enable security audit logging | `true` |
| `AUDIT_LOG_PATH` | No | Custom audit log location | `/var/log/code-executor/audit.log` |
| `ALLOWED_PROJECTS` | ⚠️ Recommended | Restrict file access | `/home/user/projects:/tmp` |
| `PYTHON_ENABLED` | No | Enable Python executor | `true` (default) |

**Security Note:** Store API keys in environment variables, not directly in config files.

**Auto-discovery (NEW in v0.7.3):** Code-executor automatically discovers and merges:
- `~/.claude.json` (global/personal MCPs)
- `.mcp.json` (project MCPs)
- `MCP_CONFIG_PATH` if set (explicit override, still merges with global)

**No configuration needed** - just add MCPs to either location and code-executor finds them all!

## TypeScript Support

Full type definitions included:

```typescript
import { MCPClientPool, executeTypescript, type ToolSchema } from 'code-executor-mcp';

const pool = new MCPClientPool();
await pool.initialize('/path/to/.mcp.json');

const result = await executeTypescript({
  code: `const tools = await discoverMCPTools(); console.log(tools.length);`,
  allowedTools: ['mcp__*'],
  timeoutMs: 30000
});
```

## Performance

| Metric | Value |
|--------|-------|
| **Token savings** | 98% (141k → 1.6k) |
| **Tool discovery** | <5ms (cached), 50-100ms (first call) |
| **Validation** | <1ms per tool call |
| **Sandbox startup** | ~200ms (Deno), ~2-3s first/~100ms cached (Pyodide) |
| **Test coverage** | 606 tests, 95%+ security, 90%+ overall |

## Documentation

- [AGENTS.md](AGENTS.md) - Repository guidelines for AI agents
- [CONTRIBUTING.md](CONTRIBUTING.md) - Development setup and workflow
- [SECURITY.md](SECURITY.md) - Security model and threat analysis
- [DOCKER_TESTING.md](DOCKER_TESTING.md) - Docker security details
- [CHANGELOG.md](CHANGELOG.md) - Version history

## FAQ

**Q: Do I need to configure each MCP server?**
A: No. Code-executor auto-discovers MCPs from `~/.claude.json` (global) AND `.mcp.json` (project). Just add MCPs to either location.

**Q: How does global + project config merging work?**
A: Code-executor finds and merges both:
- Global (`~/.claude.json`): Personal MCPs available everywhere
- Project (`.mcp.json`): Team MCPs in version control
- Result: All MCPs available, project configs override global for duplicate names

**Q: How does validation work?**
A: AJV validates all tool calls against live schemas. On error, you get a detailed message showing expected parameters.

**Q: What about Python support?**
A: Full Python sandbox via Pyodide WebAssembly. Requires `PYTHON_SANDBOX_READY=true` environment variable. Same security model as Deno (WASM isolation, virtual FS, network restricted). Pure Python only - no native C extensions unless WASM-compiled. See [SECURITY.md](SECURITY.md#-python-executor-security-pyodide) for details.

**Q: Can I use this in production?**
A: Yes. 606 tests, 95%+ coverage, Docker support, audit logging, rate limiting.

**Q: Does this work with Claude Code only?**
A: Built for Claude Code. Untested on other MCP clients, but should work per MCP spec.

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Code Quality Standards:**
- ✅ TypeScript strict mode
- ✅ 90%+ test coverage on business logic
- ✅ ESLint + Prettier
- ✅ All PRs require passing tests

## License

MIT - See [LICENSE](LICENSE)

## Links

- **npm:** https://www.npmjs.com/package/code-executor-mcp
- **Docker Hub:** https://hub.docker.com/r/aberemia24/code-executor-mcp
- **GitHub:** https://github.com/aberemia24/code-executor-MCP
- **Issues:** https://github.com/aberemia24/code-executor-MCP/issues

---

**Built with Claude Code** | Based on [Anthropic's Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=aberemia24/code-executor-MCP&type=timeline)](https://star-history.com/#aberemia24/code-executor-MCP&Timeline)
