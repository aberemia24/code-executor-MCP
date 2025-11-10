# Code Executor MCP

**One MCP to orchestrate them all.** Progressive disclosure pattern - 98% token savings vs exposing all tools.

> Based on [Anthropic's Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
> Built for Claude Code. Untested on other MCP clients.

## Problem

47 MCP tools = 141k tokens just for schemas. Context exhausted before you start working.

## Solution

**Disable all MCPs. Enable only code-executor.**

2 tools (`executeTypescript`, `executePython`) access all other MCPs on-demand:

```typescript
// Claude writes this to access zen MCP
const result = await callMCPTool('mcp__zen__codereview', {...});
```

**Result:** 47 tools → 2 tools = 141k tokens → 1.6k tokens (98% reduction)

## When to Use

✅ **Use if:**
- 3+ MCP servers (context bloat problem)
- Mix of local + remote + APIs
- Need audit logs, allowlisting, rate limiting

❌ **Skip if:**
- 1-2 MCPs (just enable them directly)
- Simple filesystem/git ops (use Node.js directly)

## Validation

**Deep recursive validation with AJV (JSON Schema library):**

All MCP tool calls are validated against live schemas before execution using industry-standard AJV validator. Validates nested objects, arrays, constraints, enums, and patterns. If parameters are invalid, you get a detailed error explaining what's wrong:

```
Parameter validation failed for "mcp__zen__consensus"

Errors:
  - Missing required parameters: models
  - Unexpected parameters: model

Expected parameters:
  Required:
    • prompt: string - The prompt to analyze
    • models: array<string> - List of model IDs
  Optional:
    • temperature: number - Sampling temperature

You provided:
  { "prompt": "...", "model": "gpt-4" }
```

**Benefits:**
- 🎯 Catch errors before MCP call (faster feedback)
- 📚 See expected schema on failure (self-documenting)
- 🔒 Zero token overhead (validation server-side, schemas disk-cached)
- 🔐 Deep validation (nested objects, arrays, min/max, patterns, enums)
- ⚡ Mutex-locked disk cache (no race conditions, survives restarts)

## Features

- **Executors:** TypeScript (Deno), Python
- **Security:** Sandboxed, allowlist, audit logs, rate limiting
- **Validation:** AJV-based deep validation, disk-cached schemas, mutex-locked
- **Config:** Auto-discovery, env vars, MCP integration
- **Quality:** TypeScript, 139 tests, 98%+ coverage on validation

## Installation

```bash
# NPM
npm install -g code-executor-mcp
code-executor-mcp

# Or local dev
git clone https://github.com/aberemia24/code-executor-MCP.git
cd code-executor-mcp
npm install && npm run build
npm run server

# Docker (production)
docker-compose up -d
```

See [DOCKER_TESTING.md](DOCKER_TESTING.md) for Docker security details.

## Configuration

Add to `.mcp.json`:
```json
{
  "mcpServers": {
    "code-executor": {
      "command": "node",
      "args": ["/path/to/code-executor-mcp/dist/index.js"],
      "env": {
        "MCP_CONFIG_PATH": "/path/to/.mcp.json"
      }
    }
  }
}
```

**Then disable all other MCPs. Enable only code-executor.**

## Advanced Features

### TypeScript Wrappers (Optional, Not Recommended)

> ⚠️ **NOTE:** Wrappers are **optional** and **not recommended** for most users. Runtime validation (enabled by default) provides the same benefits with zero maintenance.

If you prefer TypeScript autocomplete over runtime validation errors, you can generate type-safe wrappers:

```bash
npm run generate-wrappers  # Queries MCPs, generates ~/.code-executor/wrappers/*.ts
```

```typescript
// Without wrappers (recommended):
await callMCPTool('mcp__zen__thinkdeep', {...}); // Runtime validation shows schema on error

// With wrappers (optional):
await thinkdeep(step, step_number, total_steps, ...) // TypeScript autocomplete
```

**Why validation is better:**
- ✅ Zero maintenance (uses live schemas automatically)
- ✅ Self-documenting errors (shows expected schema on failure)
- ✅ Always up-to-date (no regeneration needed)
- ✅ Works for all MCPs (even newly added ones)

**When to use wrappers:**
- You write TypeScript code that calls MCP tools frequently
- You prefer compile-time over runtime errors
- You want IDE autocomplete for tool parameters

Wrappers are auto-generated from `tools/list` schemas, not manually written.

## License

MIT

---

Full docs: [GitHub](https://github.com/aberemia24/code-executor-MCP)
