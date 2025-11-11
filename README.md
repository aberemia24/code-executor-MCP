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
- **Discovery:** In-sandbox tool discovery, search, and schema inspection (v0.4.0)
- **Security:** Sandboxed, allowlist, audit logs, rate limiting
- **Validation:** AJV-based deep validation, disk-cached schemas, mutex-locked
- **Config:** Auto-discovery, env vars, MCP integration
- **Quality:** TypeScript, 168 tests, 98%+ coverage on validation

## Discovery Functions (v0.4.0)

**Problem:** AI agents get stuck without knowing what MCP tools exist. Need manual documentation lookup.

**Solution:** Three in-sandbox discovery functions for self-service tool exploration:

### Quick Start

```typescript
// Inside executeTypescript, discover all available tools
const tools = await discoverMCPTools();
console.log(`Found ${tools.length} tools`);

// Search for specific functionality
const fileTools = await searchTools('file read write', 10);
console.log('File-related tools:', fileTools.map(t => t.name));

// Inspect tool schema before using it
const schema = await getToolSchema('mcp__filesystem__read_file');
console.log('Parameters:', schema.parameters);

// Execute the tool (allowlist still enforced)
const result = await callMCPTool('mcp__filesystem__read_file', {
  path: '/path/to/file.txt'
});
```

### Complete Workflow Example

```typescript
// Discover → Inspect → Execute in one call (no context switching)
const code = `
  // 1. Search for tools related to code review
  const reviewTools = await searchTools('code review analysis', 5);
  console.log('Available review tools:', reviewTools.map(t => t.name));

  // 2. Inspect the schema for the tool we want
  const schema = await getToolSchema('mcp__zen__codereview');
  console.log('Required parameters:', schema.parameters.required);

  // 3. Execute the tool with proper parameters
  const result = await callMCPTool('mcp__zen__codereview', {
    step: 'Security analysis of authentication flow',
    relevant_files: ['/src/auth.ts', '/src/middleware.ts'],
    step_number: 1,
    total_steps: 2,
    next_step_required: true,
    findings: 'Initial scan shows potential timing attack in token comparison',
    model: 'gpt-5-pro'
  });

  console.log('Review result:', result);
`;

await executeTypescript(code, ['mcp__zen__codereview']);
```

### Function Reference

#### discoverMCPTools(options?)

Fetch all available tool schemas from connected MCP servers.

```typescript
interface DiscoveryOptions {
  search?: string[]; // Optional keywords (OR logic, case-insensitive)
}

const allTools = await discoverMCPTools();
// Returns: [{ name, description, parameters }, ...]

const fileTools = await discoverMCPTools({ search: ['file', 'read'] });
// Returns: Tools matching "file" OR "read" (case-insensitive)
```

**Performance:**
- First call: 50-100ms (populates cache)
- Subsequent calls: <5ms (24h cache, disk-persisted)

#### getToolSchema(toolName)

Retrieve full JSON Schema for a specific tool.

```typescript
const schema = await getToolSchema('mcp__filesystem__read_file');
// Returns: { name, description, parameters: { type, properties, required } }

const missing = await getToolSchema('nonexistent_tool');
// Returns: null (no exception thrown)
```

#### searchTools(query, limit?)

Search tools by keywords with result limiting.

```typescript
const tools = await searchTools('file write create', 10);
// Returns: Top 10 tools matching ANY keyword (OR logic)

const exactMatch = await searchTools('zen codereview', 5);
// Returns: Tools with "zen" OR "codereview" in name/description
```

**Default limit:** 10 tools

### Security Model: Discovery vs Execution

**Two-tier security boundary:**

| Operation | Allowlist Check | Why |
|-----------|----------------|-----|
| **Discovery** (discoverMCPTools, getToolSchema, searchTools) | ❌ Bypassed | Read-only metadata, enables self-service tool exploration |
| **Execution** (callMCPTool) | ✅ Enforced | Write operations, requires explicit allowlist permission |

**Example:**
```typescript
// ✅ Discovery ALWAYS works (no allowlist needed)
const tools = await discoverMCPTools();
const schema = await getToolSchema('mcp__filesystem__write_file');

// ❌ Execution BLOCKED if not in allowlist
await callMCPTool('mcp__filesystem__write_file', {...});
// Error: Tool not in allowlist ['mcp__zen__codereview']
```

**Rationale:** AI agents need to know what tools exist (read) before deciding what to execute (write). Discovery provides read-only metadata access while execution maintains strict allowlist enforcement.

**Security controls:**
- ✅ Bearer token authentication (same as execution)
- ✅ Rate limiting (30 req/60s, same as execution)
- ✅ Audit logging (all discovery requests logged)
- ✅ Query validation (max 100 chars, injection prevention)

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
