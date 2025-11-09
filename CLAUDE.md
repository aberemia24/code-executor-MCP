# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**code-executor-mcp** is a Model Context Protocol (MCP) server that enables progressive disclosure for code execution. It reduces token usage by **98%** (from ~150K to ~1.6K tokens) by exposing only 2-3 execution tools instead of 47+ individual MCP tools.

### Core Architecture

```
LLM → executeTypescript/executePython
  ↓
Sandbox (Deno/Python) with injected callMCPTool()
  ↓
MCP Proxy Server (HTTP, localhost-only)
  ↓
MCP Client Pool → 47+ MCP tools (zen, filesystem, fetcher, etc.)
```

**Key Principle:** Instead of exposing all MCP tools upfront (consuming massive context), the LLM writes code that discovers and uses tools on-demand via `callMCPTool()`.

## Essential Commands

### Build & Development
```bash
npm run build          # Compile TypeScript to dist/
npm run dev            # Watch mode (tsc --watch)
npm run typecheck      # Type check without building
```

### Testing
```bash
npm test               # Run all tests (vitest)
npm run test:watch     # Watch mode for TDD
npm run test:coverage  # Generate coverage report (target: 90%+)
```

### Running Locally
```bash
npm start              # Run compiled server (dist/index.js)
# OR for development
node --loader ts-node/esm src/index.js
```

### Run Single Test File
```bash
npx vitest tests/security.test.ts          # Run specific test
npx vitest tests/security.test.ts --watch  # Watch mode
```

## Critical Architecture Details

### 1. Progressive Disclosure Pattern

**Problem:** Loading 47 MCP tools consumes ~150K tokens (47 × ~3K tokens/tool).

**Solution:** Expose only 3 tools:
- `executeTypescript` - Runs TypeScript in Deno sandbox
- `executePython` - Runs Python in subprocess (optional)
- `health` - Health check endpoint

**How it works:**
1. LLM calls `executeTypescript` with code + tool allowlist
2. Code executes in sandbox with `callMCPTool(name, params)` injected
3. Proxy validates tool against allowlist, routes to MCP client pool
4. Results returned to sandbox → LLM

**Token savings:** Only load tool definitions when code actually uses them.

### 2. Multi-Layer Security Model (Defense in Depth)

Ordered by reliability:

**Layer 1: Deno Sandbox (PRIMARY BOUNDARY)**
- Explicit permissions: `--allow-read`, `--allow-write`, `--allow-net`
- Environment isolation: `--no-env` (blocks secret leakage, v1.2.0+)
- Memory limits: `--v8-flags=--max-old-space-size=128` (v1.2.0+)
- ⚠️ **Vulnerable to Deno CVEs** - keep Deno updated

**Layer 2: MCP Tool Allowlist (CRITICAL)**
- Only explicitly allowed tools callable via `callMCPTool()`
- Pattern: `mcp__<server>__<tool>` (e.g., `mcp__zen__codereview`)
- ⚠️ **Tool chaining risk** - allowed tools can be combined for attacks

**Layer 3: Filesystem Path Validation**
- Read/write paths validated against `allowRead`/`allowWrite` config
- ⚠️ **Symlink traversal risk** - needs canonical path resolution

**Layer 4: Rate Limiting**
- Token bucket algorithm (default: 30 req/min)
- Defense-in-depth, not security boundary

**Layer 5: Pattern-Based Blocking (⚠️ NOT A SECURITY BOUNDARY)**
- Regex patterns block `eval()`, `require()`, `exec()`, etc.
- **EASILY BYPASSED** via string concatenation/unicode
- Used only for audit trail and defense-in-depth
- **DO NOT RELY ON THIS FOR SECURITY**

### 3. Configuration Discovery

Search order (first found wins):
1. `CODE_EXECUTOR_CONFIG_PATH` env var
2. `./.code-executor.json` (project root)
3. `~/.code-executor.json` (user home)
4. `~/.config/code-executor/config.json` (XDG)

**Secret management:** Use `env:VAR_NAME` pattern in config files:
```json
{
  "security": {
    "allowRead": ["env:PROJECT_ROOT"],
    "auditLogPath": "env:AUDIT_LOG_PATH"
  }
}
```

### 4. MCP Client Pool (Multi-Transport)

Connects to other MCP servers via two transport types:

**STDIO Transport (Local Servers):**
```json
{
  "mcpServers": {
    "zen": {
      "command": "npx",
      "args": ["-y", "zen-mcp-server"],
      "env": { "GEMINI_API_KEY": "your-key" }
    }
  }
}
```

**HTTP/SSE Transport (Remote Servers):**
```json
{
  "mcpServers": {
    "linear": {
      "type": "http",
      "url": "https://mcp.linear.app/mcp",
      "headers": { "Authorization": "Bearer token" }
    }
  }
}
```

**Implementation:** `MCPClientPool` (src/mcp-client-pool.ts):
- Auto-discovers servers from `.mcp.json` (configured via `mcpConfigPath`)
- Creates `Client` instances with appropriate transport
- Routes `callTool()` requests to correct server
- Filters out `code-executor` to prevent circular dependency

### 5. Sandbox Execution Flow

**TypeScript (src/sandbox-executor.ts):**
1. Start `MCPProxyServer` (HTTP, random port, auth token)
2. Optionally start `StreamingProxy` for real-time output (WebSocket)
3. Spawn Deno with:
   - `--allow-read`, `--allow-write`, `--allow-net` from permissions
   - `--no-env` (block environment leakage)
   - `--v8-flags=--max-old-space-size=128` (memory limit)
4. Inject `callMCPTool()` function via template string
5. Write code + boilerplate to temp file
6. Execute with timeout (SIGTERM → SIGKILL)
7. Stop proxy, return results + tool calls made

**Python (src/python-executor.ts):**
- Similar flow but spawns `python3` subprocess
- Injects `call_mcp_tool()` function
- Less secure (no env isolation) - disabled by default

### 6. Key Source Files

**Entry point:**
- `src/index.ts` - Main MCP server, tool handlers (`executeTypescript`, `executePython`, `health`)

**Core execution:**
- `src/sandbox-executor.ts` - Deno sandbox execution with MCP proxy
- `src/python-executor.ts` - Python subprocess execution (optional)
- `src/mcp-proxy-server.ts` - HTTP server for callMCPTool() routing

**MCP integration:**
- `src/mcp-client-pool.ts` - Manages connections to 47+ MCP servers
- `src/streaming-proxy.ts` - WebSocket for real-time output streaming

**Configuration:**
- `src/config-discovery.ts` - Searches for `.code-executor.json`
- `src/config.ts` - Merges config from files + env vars
- `src/config-types.ts` - Zod schemas for validation

**Security:**
- `src/security.ts` - Pattern validation (defense-in-depth only)
- `src/rate-limiter.ts` - Token bucket rate limiting
- `src/connection-pool.ts` - Limits concurrent executions (max 100)

**Utilities:**
- `src/utils.ts` - Error formatting, sanitization, normalization
- `src/proxy-helpers.ts` - Allowlist validation, tool call tracking
- `src/schemas.ts` - Zod schemas for MCP tool inputs
- `src/types.ts` - TypeScript type definitions

## Important Constraints & Gotchas

### Security

1. **Pattern blocking is NOT security** - see SECURITY.md
   - `eval()`, `require()`, etc. easily bypassed via string concatenation
   - Assume code can execute anything within sandbox permissions

2. **SSRF risk via HTTP tools** - CRITICAL vulnerability
   - If allowlist includes `mcp__fetcher__fetch_url`, code can attack localhost services
   - **Mitigation:** Don't allow fetcher/HTTP tools for untrusted code

3. **Environment variable leakage** - FIXED in v1.2.0
   - `--no-env` flag prevents access to parent process env vars
   - No API keys/secrets leaked to sandbox

4. **Memory exhaustion DoS** - MITIGATED in v1.2.0
   - V8 heap limit: 128MB (`--max-old-space-size=128`)
   - Still vulnerable to fork bombs (no process count limits)

### Configuration

1. **MCP config must be project-level** - code-executor reads `.mcp.json` from project, NOT user-level configs like `~/.config/claude/claude_desktop_config.json`

2. **Circular dependency prevention** - `MCPClientPool` filters out `code-executor` server when initializing to prevent infinite loops

3. **Secret management** - Use `env:VAR_NAME` pattern to avoid hardcoding API keys in config files

### Testing

- **Target: 90%+ coverage** on business logic (current: 90%+)
- **122 tests passing** (as of v1.2.0)
- Mock external dependencies (MCP servers, file system, network)
- Use Vitest globals (`describe`, `it`, `expect`, `vi`)

## Development Workflow

### Adding New Security Checks

**DO NOT** add pattern-based validation unless for audit logging only.

**DO** add:
- Deno permission flags (e.g., `--no-hrtime` to block high-res timing attacks)
- Path canonicalization (prevent symlink traversal)
- Network policy enforcement (block private IPs)

### Adding New MCP Tool Support

1. Update `MCPClientPool.connectToServer()` if new transport type
2. Add transport type to `MCPServerConfig` union (src/types.ts)
3. Add type guard (e.g., `isWebSocketConfig()`)
4. Test with `tests/mcp-client-pool.test.ts`

### Modifying Sandbox Execution

**Key files:** `src/sandbox-executor.ts`, `src/python-executor.ts`

**Critical sections:**
- Template string injection (lines ~70-120 in sandbox-executor.ts)
- Deno permission flags (lines ~90-110)
- Timeout handling (SIGTERM → SIGKILL logic)
- Proxy lifecycle (start before exec, stop after)

**Testing:** Always test with malicious code samples (see tests/security.test.ts)

## Testing Philosophy

Follow TDD (Test-Driven Development):
1. Write failing test first (RED)
2. Write minimal code to pass (GREEN)
3. Refactor while keeping tests green (REFACTOR)

**Security tests are mandatory** for:
- Pattern blocking bypasses (string concat, unicode, etc.)
- Path traversal attempts (symlinks, `../`, absolute paths)
- Tool allowlist violations
- Timeout enforcement
- Rate limiting

## Common Tasks

### Update Security Hardening

1. Review SECURITY.md for latest threats
2. Add Deno flags to `sandbox-executor.ts:~95`
3. Update SECURITY.md with mitigation
4. Add test to `tests/security.test.ts`
5. Update version in package.json

### Add New Executor Type (e.g., Rust)

1. Create `src/rust-executor.ts` (copy pattern from `python-executor.ts`)
2. Add schema to `src/schemas.ts` (e.g., `ExecuteRustInputSchema`)
3. Add tool handler to `src/index.ts:~80`
4. Add config flag to `src/config-types.ts`
5. Add tests to `tests/rust-executor.test.ts`

### Debug MCP Client Connection Issues

1. Check `MCPClientPool.initialize()` logs (stderr)
2. Verify `.mcp.json` path resolution (run `getMCPConfigPath()`)
3. Test STDIO vs HTTP transport separately
4. Check server process spawning (logs in `connectToServer()`)
5. Validate tool discovery (`listTools()` call)

## Version History Context

- **v1.2.0 (2025-01-09):** Security hardening (`--no-env`, memory limits)
- **v1.1.0:** Initial release with pattern blocking
- **v1.0.0:** MVP with progressive disclosure pattern

## Built for Claude Code Only

⚠️ This MCP server was developed and tested **exclusively with Claude Code**. No testing has been performed on other MCP clients (Claude Desktop, Cline, Roo, etc.). Use with other clients at your own risk.
