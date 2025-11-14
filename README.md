# Code Executor MCP

**Stop hitting the 2-3 MCP server wall.** One MCP to orchestrate them all - 98% token savings, unlimited tool access.

[![npm version](https://img.shields.io/npm/v/code-executor-mcp.svg)](https://www.npmjs.com/package/code-executor-mcp)
[![Docker Pulls](https://img.shields.io/docker/pulls/aberemia24/code-executor-mcp.svg)](https://hub.docker.com/r/aberemia24/code-executor-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

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

## Quick Start

### 1. Install

```bash
npm install -g code-executor-mcp
```

### 2. Configure

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "code-executor": {
      "command": "code-executor-mcp"
    }
  }
}
```

**Important:** Disable all other MCPs. Enable ONLY `code-executor`.

### 3. Use

Claude can now access any MCP tool through code execution:

```typescript
// Claude writes this when you ask to "read package.json"
const result = await callMCPTool('mcp__filesystem__read_file', {
  path: './package.json'
});
console.log(result);
```

That's it. No configuration, no allowlists, no manual tool setup.

## Why This Works

**Progressive Disclosure Architecture**

Traditional MCP: Expose all 47 tools upfront → 141k tokens

Code Executor: Expose 2 tools (with outputSchema) → tools load on-demand → 1.6k tokens

**NEW in v0.6.0:** All tools now include `outputSchema` - AI agents know response structure without trial execution! *Note: The MCP SDK protocol doesn't expose outputSchema yet (v1.21.1), but our implementation is ready for when it does. See [Architecture docs](docs/architecture.md#35-output-schema-support-new-v060) for details.*

```
┌─────────────────────────────────────┐
│ AI Agent sees 2 tools (~1.6k tokens)│
│  - run-typescript-code              │
│  - run-python-code                  │
└─────────────────────────────────────┘
              ↓ executes
┌─────────────────────────────────────┐
│ Sandbox has access to ALL tools     │
│  - mcp__filesystem__*               │
│  - mcp__git__*                      │
│  - mcp__browser__*                  │
│  - mcp__zen__*                      │
│  - ... all 47 tools                 │
└─────────────────────────────────────┘
```

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

## Installation Options

### npm (Recommended)

```bash
npm install -g code-executor-mcp
code-executor-mcp
```

### Docker (Production)

```bash
docker pull aberemia24/code-executor-mcp:latest
docker run -p 3000:3000 aberemia24/code-executor-mcp:latest
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

Basic setup in `.mcp.json`:

```json
{
  "mcpServers": {
    "code-executor": {
      "command": "code-executor-mcp",
      "env": {
        "MCP_CONFIG_PATH": "/path/to/.mcp.json"
      }
    }
  }
}
```

**Auto-discovery:** Reads other MCP servers from same config file.

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

## Security

- **Sandboxed execution:** Deno (TypeScript) and Python subprocesses with restricted permissions
- **Tool allowlists:** Whitelist specific MCP tools per execution
- **Rate limiting:** 30 requests/60 seconds (configurable)
- **Audit logging:** All tool calls logged with timestamps
- **Deep validation:** AJV schema validation before execution
- **SSRF protection:** Blocks AWS metadata, localhost, private IPs

See [SECURITY.md](SECURITY.md) for security model and threat analysis.

## Performance

| Metric | Value |
|--------|-------|
| **Token savings** | 98% (141k → 1.6k) |
| **Tool discovery** | <5ms (cached), 50-100ms (first call) |
| **Validation** | <1ms per tool call |
| **Sandbox startup** | ~200ms (Deno), ~300ms (Python) |
| **Test coverage** | 606 tests, 95%+ security, 90%+ overall |

## Documentation

- [AGENTS.md](AGENTS.md) - Repository guidelines for AI agents
- [CONTRIBUTING.md](CONTRIBUTING.md) - Development setup and workflow
- [SECURITY.md](SECURITY.md) - Security model and threat analysis
- [DOCKER_TESTING.md](DOCKER_TESTING.md) - Docker security details
- [CHANGELOG.md](CHANGELOG.md) - Version history

## FAQ

**Q: Do I need to configure each MCP server?**
A: No. Code-executor auto-discovers MCPs from your `.mcp.json`. Just disable them and enable only code-executor.

**Q: How does validation work?**
A: AJV validates all tool calls against live schemas. On error, you get a detailed message showing expected parameters.

**Q: What about Python support?**
A: Full Python sandbox support with `run-python-code` tool. Same features as TypeScript.

**Q: Can I use this in production?**
A: Yes. 606 tests, 95%+ coverage, Docker support, audit logging, rate limiting.

**Q: Does this work with Claude Code only?**
A: Built for Claude Code. Untested on other MCP clients, but should work per MCP spec.

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
