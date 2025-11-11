# Architecture Documentation

**Project:** Code Executor MCP
**Version:** 0.4.0
**Last Updated:** 2025-11-11

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Core Components](#core-components)
3. [Progressive Disclosure Architecture](#progressive-disclosure-architecture)
4. [Security Architecture](#security-architecture)
5. [Discovery System](#discovery-system)
6. [Data Flow](#data-flow)
7. [Concurrency & Performance](#concurrency--performance)
8. [Design Decisions](#design-decisions)

---

## 1. System Overview

Code Executor MCP is a **universal MCP orchestration server** that implements the **progressive disclosure pattern** to eliminate context bloat from exposing multiple MCP servers' tool schemas.

### Problem Statement

Exposing 47 MCP tools directly to an AI agent consumes 141k tokens just for schemas, exhausting context before any work begins.

### Solution

**Two-tier access model:**
- **Tier 1 (Top-level):** 3 lightweight tools (~560 tokens)
  - `executeTypescript` - Execute TypeScript code in Deno sandbox
  - `executePython` - Execute Python code in Pyodide sandbox
  - `health` - Server health check

- **Tier 2 (On-demand):** All MCP tools accessible via code execution
  ```typescript
  // Inside sandbox, access any MCP tool on-demand
  const result = await callMCPTool('mcp__zen__codereview', {...});
  ```

**Result:** 98% token reduction (141k → 1.6k tokens)

---

## 2. Core Components

### 2.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        AI Agent (Claude)                    │
│                     (MCP Client Context)                    │
└────────────────┬────────────────────────────────────────────┘
                 │ MCP Protocol (STDIO)
                 │ Top-level tools: 3 tools, ~560 tokens
                 ▼
┌─────────────────────────────────────────────────────────────┐
│              Code Executor MCP Server (Node.js)             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         MCP Proxy Server (HTTP Localhost)            │  │
│  │  • POST / (callMCPTool endpoint)                     │  │
│  │  • GET /mcp/tools (discovery endpoint - NEW v0.4.0)  │  │
│  │  • Bearer token authentication                       │  │
│  │  • Rate limiting (30 req/60s)                        │  │
│  │  • Audit logging (AsyncLock mutex)                   │  │
│  └──────────────┬───────────────────────────────────────┘  │
│                 │                                           │
│  ┌──────────────▼───────────────────────────────────────┐  │
│  │            MCP Client Pool                           │  │
│  │  • Manages connections to multiple MCP servers       │  │
│  │  • Parallel queries (Promise.all)                    │  │
│  │  • Resilient aggregation (partial failure handling)  │  │
│  │  • In-memory tool list (listAllTools)                │  │
│  └──────────────┬───────────────────────────────────────┘  │
│                 │                                           │
│  ┌──────────────▼───────────────────────────────────────┐  │
│  │            Schema Cache                              │  │
│  │  • LRU cache (max 1000 entries)                      │  │
│  │  • Disk persistence (~/.code-executor/cache.json)    │  │
│  │  • 24h TTL with stale-on-error fallback              │  │
│  │  • AsyncLock mutex (thread-safe writes)              │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │     Sandbox Executors (Deno/Pyodide subprocesses)    │  │
│  │  • Isolated execution context                        │  │
│  │  • Injected globals:                                 │  │
│  │    - callMCPTool(name, params)                       │  │
│  │    - discoverMCPTools(options) - NEW v0.4.0          │  │
│  │    - getToolSchema(toolName) - NEW v0.4.0            │  │
│  │    - searchTools(query, limit) - NEW v0.4.0          │  │
│  │  • Restricted permissions (allowlist, network, fs)   │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────┬────────────────────────────────────────────┘
                 │ MCP Protocol (STDIO)
                 │ External MCP Servers (parallel queries)
                 ▼
┌─────────────────────────────────────────────────────────────┐
│    External MCP Servers (filesystem, zen, linear, etc.)     │
│    • Queried in parallel via Promise.all (O(1) amortized)   │
│    • Each returns tools/list and tools/call responses        │
│    • Discovery: 50-100ms first call, <5ms cached             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Component Responsibilities

| Component | Responsibility (SRP) | Pattern | Concurrency Safe |
|-----------|---------------------|---------|------------------|
| MCP Proxy Server | Route HTTP requests, enforce auth/rate limiting, audit log | Proxy | Yes (AsyncLock on audit logs) |
| MCP Client Pool | Manage MCP connections, parallel query aggregation | Pool | Yes (read-only queries, write-once at startup) |
| Schema Cache | Cache tool schemas, disk persistence, LRU eviction | Cache | Yes (AsyncLock on disk writes) |
| Sandbox Executor | Execute untrusted code in isolated environment | Sandbox | Yes (independent subprocesses) |
| Discovery Functions | Provide in-sandbox tool discovery (v0.4.0) | Wrapper | Yes (stateless HTTP calls) |

---

## 3. Progressive Disclosure Architecture

### 3.1 Token Budget Preservation

**Design Goal:** Maintain ~1.6k tokens for top-level tools (98% reduction from 141k baseline)

**Achievement (v0.4.0):**
- **Tool count:** 3 tools (no increase from v0.3.x)
- **Token usage:** ~560 tokens (well below 1.6k budget)
- **Discovery functions:** Hidden from top-level (injected in sandbox only)

### 3.2 Two-Tier Access Model

**Tier 1: Top-Level Tools (Exposed to AI Agent)**
```typescript
// AI agent sees only these in context:
- executeTypescript(code, allowedTools?, timeoutMs?, permissions?)
- executePython(code, allowedTools?, timeoutMs?, permissions?)
- health()
```

**Tier 2: On-Demand Tools (Accessible Inside Sandbox)**
```typescript
// Inside executeTypescript code, AI agent can:

// 1. Execute any MCP tool (existing v0.3.x)
const result = await callMCPTool('mcp__zen__codereview', {
  step: 'Analysis',
  relevant_files: ['/path/to/file.ts'],
  // ... other params
});

// 2. Discover available tools (NEW v0.4.0)
const allTools = await discoverMCPTools();
// Returns: ToolSchema[] (name, description, parameters)

// 3. Search tools by keyword (NEW v0.4.0)
const fileTools = await searchTools('file read write', 10);
// Returns: Top 10 tools matching keywords (OR logic, case-insensitive)

// 4. Inspect tool schema (NEW v0.4.0)
const schema = await getToolSchema('mcp__filesystem__read_file');
// Returns: Full JSON Schema for tool parameters
```

---

## 4. Security Architecture

### 4.1 Security Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│ Security Boundary 1: MCP Proxy Server (Auth + Rate Limit)   │
│  • Bearer token authentication (per-execution, 32-byte)      │
│  • Rate limiting (30 req/60s per client)                     │
│  • Query validation (max 100 chars, alphanumeric+safe chars) │
│  • Audit logging (all requests, success/failure)             │
└─────────────────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────────────┐
│ Security Boundary 2: Tool Allowlist (Execution Gating)      │
│  • Enforced by executeTypescript allowedTools parameter      │
│  • Discovery bypasses allowlist (read-only metadata)         │
│  • Execution still enforced (callMCPTool checks allowlist)   │
│  • Trade-off documented: discovery = read, execution = write │
└─────────────────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────────────┐
│ Security Boundary 3: Sandbox Isolation (Code Execution)     │
│  • Deno sandbox with restricted permissions                  │
│  • No filesystem access (unless explicitly allowed)          │
│  • No network access (except localhost proxy)                │
│  • No environment variable access                            │
│  • Memory limits enforced                                    │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Security Trade-Off: Discovery Allowlist Bypass

**Decision (v0.4.0):** Discovery functions bypass tool allowlist for read-only metadata access.

**Rationale:**
- **Problem:** AI agents get stuck without knowing what tools exist (blind execution)
- **Solution:** Allow discovery of tool schemas (read-only metadata)
- **Mitigation:** Execution still enforces allowlist (two-tier security model)
- **Risk Assessment:** LOW - schemas are non-sensitive metadata, no execution without allowlist

**Security Model:**
| Operation | Allowlist Check | Auth Required | Rate Limited | Audit Logged |
|-----------|----------------|---------------|--------------|--------------|
| Discovery (discoverMCPTools) | ❌ Bypassed | ✅ Required | ✅ Yes (30/60s) | ✅ Yes |
| Execution (callMCPTool) | ✅ Enforced | ✅ Required | ✅ Yes (30/60s) | ✅ Yes |

**Constitutional Alignment:** This intentional exception is documented in spec.md Section 2 (Constitutional Exceptions) as BY DESIGN per Principle 2 (Security Zero Tolerance).

---

## 5. Discovery System (NEW v0.4.0)

### 5.1 Discovery Architecture

**Design Goal:** Enable AI agents to discover, search, and inspect MCP tools without manual documentation lookup.

```
┌─────────────────────────────────────────────────────────────┐
│ Discovery Flow (Single Round-Trip)                          │
│                                                              │
│  AI Agent executes ONE TypeScript call:                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ const tools = await discoverMCPTools();             │   │
│  │ const schema = await getToolSchema('tool_name');    │   │
│  │ const result = await callMCPTool('tool_name', {...});│  │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  No context switching, variables persist across steps       │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Sandbox → Proxy: HTTP GET /mcp/tools                        │
│  • 500ms timeout (fast fail, no hanging)                    │
│  • Bearer token in Authorization header                     │
│  • Optional ?q=keyword1+keyword2 search                     │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Proxy → MCP Servers: Parallel Queries (Promise.all)         │
│  • Query all MCP servers simultaneously (O(1) amortized)    │
│  • Use Schema Cache for schemas (24h TTL, disk-persisted)   │
│  • Resilient aggregation (partial failures handled)         │
│  • Performance: First call 50-100ms, cached <5ms            │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Response: ToolSchema[] (JSON)                               │
│  [                                                           │
│    {                                                         │
│      "name": "mcp__filesystem__read_file",                  │
│      "description": "Read file contents",                   │
│      "parameters": { /* JSON Schema */ }                    │
│    },                                                        │
│    ...                                                       │
│  ]                                                           │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Discovery Functions

#### discoverMCPTools(options?)
**Purpose:** Fetch all available tool schemas from connected MCP servers

**Signature:**
```typescript
interface DiscoveryOptions {
  search?: string[]; // Optional keyword array (OR logic, case-insensitive)
}

async function discoverMCPTools(
  options?: DiscoveryOptions
): Promise<ToolSchema[]>
```

**Implementation:**
- Injected into sandbox as `globalThis.discoverMCPTools`
- Calls `GET /mcp/tools` endpoint (localhost proxy)
- 500ms timeout via `AbortSignal.timeout(500)`
- Returns full tool schemas with JSON Schema parameters

**Performance:**
- First call: 50-100ms (populates schema cache)
- Subsequent calls: <5ms (from cache, 24h TTL)
- Parallel queries across 3+ MCP servers: <100ms P95

#### getToolSchema(toolName)
**Purpose:** Retrieve full JSON Schema for a specific tool

**Signature:**
```typescript
async function getToolSchema(
  toolName: string
): Promise<ToolSchema | null>
```

**Implementation:**
- Wrapper over `discoverMCPTools()` (DRY principle)
- Finds tool by name using `Array.find()`
- Returns `null` if tool not found (no exceptions)

#### searchTools(query, limit?)
**Purpose:** Search tools by keywords with result limiting

**Signature:**
```typescript
async function searchTools(
  query: string,
  limit?: number // Default: 10
): Promise<ToolSchema[]>
```

**Implementation:**
- Splits query by whitespace: `query.split(/\s+/)`
- Calls `discoverMCPTools({ search: keywords })`
- Applies result limit via `Array.slice(0, limit)`
- OR logic: matches if ANY keyword found in name/description

### 5.3 Parallel Query Pattern

**Design Decision:** Query all MCP servers in parallel using `Promise.all` for O(1) amortized latency.

**Sequential vs Parallel:**
```typescript
// ❌ Sequential (3 servers × 30ms each = 90ms)
for (const client of mcpClients) {
  const tools = await client.listTools(); // Wait for each
  allTools.push(...tools);
}

// ✅ Parallel (max 30ms, O(1) amortized)
const queries = mcpClients.map(client => client.listTools());
const results = await Promise.all(queries); // All at once
const allTools = results.flat();
```

**Resilient Aggregation:**
```typescript
// Handle partial failures gracefully
const queries = mcpClients.map(async client => {
  try {
    return await client.listTools();
  } catch (error) {
    console.error(`MCP server ${client.name} failed:`, error);
    return { tools: [] }; // Return empty, don't block others
  }
});
```

**Performance Benefit:**
- 1 MCP server: 30ms (baseline)
- 3 MCP servers (sequential): 90ms (3× slower)
- 3 MCP servers (parallel): 35ms (O(1) amortized)
- 10 MCP servers (parallel): 50ms (still O(1))

**Target Met:** P95 latency <100ms for 3 MCP servers (spec.md NFR-2)

### 5.4 Timeout Strategy

**Design Decision:** 500ms timeout for proxy→sandbox communication (fast fail, no retries).

**Rationale:**
- AI agents prefer fast failure over hanging
- 500ms allows parallel queries (100ms + network overhead)
- No retries: discovery errors should surface immediately
- Clear error messages guide AI agent to retry if transient

**Implementation:**
```typescript
// Sandbox side (fetch with timeout)
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 500);

try {
  const response = await fetch(url, {
    signal: controller.signal,
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return await response.json();
} catch (error) {
  if (error.name === 'AbortError') {
    throw new Error('Discovery timeout (500ms exceeded). MCP servers may be slow.');
  }
  throw error;
} finally {
  clearTimeout(timeoutId);
}
```

---

## 6. Data Flow

### 6.1 Tool Execution Flow (Existing v0.3.x)

```
1. AI Agent → executeTypescript(code)
2. Sandbox spawned (Deno subprocess)
3. Code executes: callMCPTool('tool_name', params)
4. Sandbox → HTTP POST localhost:PORT/
5. Proxy validates: Bearer token, rate limit, allowlist
6. Proxy → MCP Client Pool → External MCP Server
7. MCP Server executes tool, returns result
8. Result → Proxy → Sandbox → AI Agent
```

### 6.2 Tool Discovery Flow (NEW v0.4.0)

```
1. AI Agent → executeTypescript(code with discoverMCPTools())
2. Sandbox executes: discoverMCPTools({ search: ['file'] })
3. Sandbox → HTTP GET localhost:PORT/mcp/tools?q=file
4. Proxy validates: Bearer token, rate limit, query (<100 chars)
5. Proxy → MCP Client Pool.listAllToolSchemas(schemaCache)
6. Client Pool queries all MCP servers in parallel (Promise.all)
7. Schema Cache provides cached schemas (<5ms) or fetches (50ms)
8. Proxy filters by keywords (OR logic, case-insensitive)
9. Proxy audits: { action: 'discovery', searchTerms: ['file'], count: 5 }
10. Result → Sandbox → AI Agent (ToolSchema[] JSON)
```

### 6.3 Schema Caching Flow

```
1. First discovery call: Cache miss
   → Query MCP servers (50-100ms)
   → Store in LRU cache (in-memory, max 1000 entries)
   → Persist to disk (~/.code-executor/schema-cache.json, AsyncLock)
   → Return schemas

2. Subsequent calls (within 24h): Cache hit
   → Retrieve from LRU cache (<5ms)
   → No network calls
   → Return cached schemas

3. After 24h TTL: Cache expired
   → Re-query MCP servers (background refresh)
   → Update cache
   → Return fresh schemas

4. MCP server failure: Stale-on-error
   → Use expired cache entry (better than failure)
   → Log warning
   → Return stale schemas
```

---

## 7. Concurrency & Performance

### 7.1 Concurrency Safety (AsyncLock)

**Shared Resources Protected:**

| Resource | Lock Name | Why Protected | Performance Impact |
|----------|-----------|---------------|-------------------|
| Schema Cache Disk Writes | `schema-cache-write` | Prevent file corruption from concurrent updates | Negligible (writes rare, 24h TTL) |
| Audit Log Appends | `audit-log-write` | Prevent interleaved log entries | Negligible (<1ms lock hold) |

**AsyncLock Pattern:**
```typescript
import AsyncLock from 'async-lock';
const lock = new AsyncLock();

// Schema cache writes
await lock.acquire('schema-cache-write', async () => {
  await fs.writeFile(cachePath, JSON.stringify(cache));
});

// Audit log appends
await lock.acquire('audit-log-write', async () => {
  await fs.appendFile(auditLogPath, logEntry + '\n');
});
```

### 7.2 Performance Characteristics

| Operation | First Call | Cached Call | Target | Actual (v0.4.0) |
|-----------|-----------|-------------|--------|-----------------|
| discoverMCPTools (1 server) | 30ms | <5ms | <50ms | ✅ 30ms / 3ms |
| discoverMCPTools (3 servers) | 50-100ms | <5ms | <100ms P95 | ✅ 60ms / 4ms |
| discoverMCPTools (10 servers) | 80-150ms | <10ms | <150ms P95 | ✅ 120ms / 8ms |
| getToolSchema (specific tool) | 50ms | <5ms | N/A | ✅ Same as discover |
| searchTools (keyword filter) | 50ms | <5ms | N/A | ✅ Same as discover |

**Key Optimizations:**
- ✅ Parallel queries (Promise.all) → O(1) amortized complexity
- ✅ Schema Cache with 24h TTL → 20× faster (100ms → 5ms)
- ✅ In-memory LRU cache (max 1000 entries) → No disk I/O on hits
- ✅ Disk persistence → Survives restarts, no re-fetching
- ✅ Stale-on-error fallback → Resilient to transient failures

### 7.3 Memory & Storage

**Memory Footprint:**
- Schema Cache (in-memory): ~1-2MB (1000 schemas × ~1-2KB each)
- MCP Client connections: ~100KB per server
- Sandbox subprocesses: ~50MB per execution (isolated, cleaned up)

**Disk Storage:**
- Schema Cache: `~/.code-executor/schema-cache.json` (~500KB-1MB)
- Audit Logs: `~/.code-executor/audit-logs/*.jsonl` (append-only, rotated daily)

---

## 8. Design Decisions

### 8.1 Why Progressive Disclosure?

**Problem:** Exposing all MCP tool schemas exhausts context budget.

**Decision:** Hide tools behind code execution, load on-demand.

**Trade-offs:**
- ✅ **Benefit:** 98% token reduction (141k → 1.6k)
- ✅ **Benefit:** Zero context overhead for unused tools
- ❌ **Cost:** Two-step process (discover → execute)
- ✅ **Mitigation (v0.4.0):** Single round-trip workflow (discover + execute in one call)

### 8.2 Why Parallel Queries?

**Problem:** Sequential MCP queries scale linearly (3 servers = 3× latency).

**Decision:** Query all MCP servers in parallel using `Promise.all`.

**Trade-offs:**
- ✅ **Benefit:** O(1) amortized latency (max of all queries, not sum)
- ✅ **Benefit:** Meets <100ms P95 target for 3 servers
- ❌ **Cost:** More complex error handling (partial failures)
- ✅ **Mitigation:** Resilient aggregation (one failure doesn't block others)

### 8.3 Why 500ms Timeout?

**Problem:** Slow MCP servers cause AI agents to hang indefinitely.

**Decision:** 500ms timeout on sandbox→proxy discovery calls.

**Trade-offs:**
- ✅ **Benefit:** Fast fail (AI agent gets immediate feedback)
- ✅ **Benefit:** Allows parallel queries (100ms + 400ms network/overhead)
- ❌ **Cost:** May timeout on legitimately slow servers (10+)
- ✅ **Mitigation:** Clear error message guides retry, stale-on-error fallback

### 8.4 Why Bypass Allowlist for Discovery?

**Problem:** AI agents stuck without knowing what tools exist.

**Decision:** Discovery bypasses allowlist, execution still enforced.

**Trade-offs:**
- ✅ **Benefit:** AI agents can self-discover tools (no manual docs)
- ✅ **Benefit:** Read-only metadata, no execution without allowlist
- ❌ **Risk:** Information disclosure (tool names/descriptions visible)
- ✅ **Mitigation:** Two-tier security (discovery=read, execution=write), auth + rate limit + audit log

**Risk Assessment:** LOW - tool schemas are non-sensitive metadata, no code execution without allowlist enforcement.

### 8.5 Why Schema Cache with 24h TTL?

**Problem:** Querying MCP servers on every discovery call wastes 50-100ms.

**Decision:** Disk-persisted LRU cache with 24h TTL.

**Trade-offs:**
- ✅ **Benefit:** 20× faster (100ms → 5ms) on cache hits
- ✅ **Benefit:** Survives server restarts (disk persistence)
- ❌ **Cost:** Stale schemas if MCP servers update within 24h
- ✅ **Mitigation:** Smart refresh on validation failures, manual cache clear available

---

## Architecture Validation Checklist

### Constitutional Compliance

- [x] **Principle 1 (Progressive Disclosure):** Token impact 0% (3 tools maintained, ~560 tokens)
- [x] **Principle 2 (Security):** Zero tolerance met (auth, rate limit, audit, validation, intentional exception documented)
- [x] **Principle 3 (TDD):** Red-Green-Refactor followed, 95%+ discovery coverage, 90%+ overall
- [x] **Principle 4 (Type Safety):** TypeScript strict mode, no `any` types (use `unknown` + guards)
- [x] **Principle 5 (SOLID):** SRP verified (each component single purpose), DIP via abstractions
- [x] **Principle 6 (Concurrency):** AsyncLock on shared resources (cache writes, audit logs)
- [x] **Principle 7 (Fail-Fast):** Descriptive errors with schemas, no silent failures
- [x] **Principle 8 (Performance):** Measurement-driven (<100ms P95 met), parallel queries O(1)
- [x] **Principle 9 (Documentation):** Self-documenting code, WHY comments, architecture.md complete

### Quality Metrics

- **Test Coverage:** 95%+ (discovery endpoint), 90%+ (overall), 85%+ (integration)
- **Performance:** P95 <100ms (3 MCP servers), <5ms cached
- **Security:** Auth + rate limit + audit log + validation all enforced
- **Token Usage:** 3 tools, ~560 tokens (within 1.6k budget, 98% reduction maintained)

---

**Document Version:** 1.0.0 (Initial architecture documentation for v0.4.0 release)
**Contributors:** Alexandru Eremia
**Last Review:** 2025-11-11
