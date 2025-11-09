# code-executor-mcp

**Universal MCP server for executing TypeScript/Python with progressive disclosure**

Execute code in secure sandboxes with access to MCP tools. Achieve **98% token savings** via progressive disclosure pattern.

## Features

✅ **Progressive Disclosure** - 1,600 tokens vs 150,000 (98% reduction)
✅ **TypeScript + Python** - Execute both languages in Deno/Python sandboxes
✅ **Secure by Default** - Path validation, code pattern analysis, rate limiting
✅ **Connection Pooling** - Limit concurrent executions (max 100)
✅ **MCP Tool Access** - `callMCPTool()` function available in sandbox
✅ **WebSocket Streaming** - Real-time output for long-running tasks
✅ **Audit Logging** - Track all executions for security
✅ **Type Safe** - Full TypeScript definitions, Zod validation

## Quick Start

### 1. Install

```bash
npm install -g code-executor-mcp
```

### 2. Configure MCP

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "code-executor": {
      "command": "code-executor-mcp",
      "env": {
        "ALLOWED_PROJECTS": "/path/to/your/project",
        "ENABLE_AUDIT_LOG": "true"
      }
    }
  }
}
```

### 3. Use in Claude Code

```typescript
// Execute TypeScript with MCP tool access
await mcp__code-executor__executeTypescript({
  code: `
    const result = await callMCPTool('mcp__zen__codereview', {
      code: 'function foo() { return 42; }',
      language: 'typescript'
    });
    console.log(result);
  `,
  allowedTools: ['mcp__zen__codereview'],
  timeoutMs: 60000
});
```

## Examples

### TypeScript Execution

```typescript
await mcp__code-executor__executeTypescript({
  code: `
    // Read file
    const content = await callMCPTool('mcp__filesystem__read_text_file', {
      path: './package.json'
    });

    // Process
    const pkg = JSON.parse(content);
    console.log('Package name:', pkg.name);

    // Write result
    await callMCPTool('mcp__filesystem__write_file', {
      path: './output.txt',
      content: \`Name: \${pkg.name}\`
    });
  `,
  allowedTools: [
    'mcp__filesystem__read_text_file',
    'mcp__filesystem__write_file'
  ],
  timeoutMs: 5000
});
```

### Python Execution (Coming Soon)

```python
await mcp__code-executor__executePython({
  code: """
    import json

    # Call MCP tool from Python
    result = call_mcp_tool('mcp__zen__thinkdeep', {
      'problem': 'How to optimize this algorithm?',
      'model': 'gemini-2.5-pro'
    })

    print(json.dumps(result, indent=2))
  """,
  allowedTools: ['mcp__zen__thinkdeep'],
  timeoutMs: 120000
});
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DENO_PATH` | `deno` | Path to Deno executable |
| `MCP_CONFIG_PATH` | `./.mcp.json` | Path to MCP configuration |
| `ALLOWED_PROJECTS` | `process.cwd()` | Colon-separated paths for file access |
| `ENABLE_AUDIT_LOG` | `false` | Enable audit logging |
| `AUDIT_LOG_PATH` | `./audit.log` | Audit log file path |

### Security Defaults

- **Timeout:** 30s (configurable up to 5 minutes)
- **Output Limit:** 25,000 characters
- **Connection Pool:** Max 100 concurrent executions
- **Code Validation:** Blocks dangerous patterns (eval, Function, etc.)

## Architecture

```
┌─────────────────────────────────────────┐
│ Claude Code (User)                      │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ code-executor-mcp                       │
│ ├─ Connection Pool (max 100)            │
│ ├─ Security Validator                   │
│ └─ Sandbox Executor                     │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ Deno Sandbox (TypeScript)               │
│ └─ callMCPTool() → MCP Client Pool      │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ MCP Servers (zen, filesystem, etc.)     │
└─────────────────────────────────────────┘
```

## Progressive Disclosure Pattern

**Traditional Approach (❌ 150,000 tokens):**
- Load all 47 MCP tool definitions upfront
- Wasted context on unused tools

**Progressive Disclosure (✅ 1,600 tokens):**
- Load only code-executor definition
- Tools loaded on-demand via `callMCPTool()`
- 98% token savings

## Development

### Setup

```bash
git clone https://github.com/beehiveinnovations/code-executor-mcp.git
cd code-executor-mcp
npm install
```

### Commands

```bash
npm run build       # Build TypeScript
npm test            # Run tests (105 tests)
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

**Current Status:** 105 tests passing, 90%+ coverage

## Security

### Code Pattern Validation

Blocks dangerous patterns:
- `eval()`, `Function()`, `new Function()`
- `require()`, `import()`
- `child_process`, `Deno.run`
- `setTimeout`/`setInterval` with string arguments

### Path Validation

- Validates all file paths against `ALLOWED_PROJECTS`
- Prevents directory traversal attacks
- Separator checking (prevents `/home/user` matching `/home/username`)

### Audit Logging

When enabled, logs all executions:
```json
{
  "timestamp": "2025-11-09T10:00:00Z",
  "codeHash": "sha256...",
  "toolsAllowed": ["mcp__zen__codereview"],
  "toolsCalled": ["mcp__zen__codereview"],
  "executionTimeMs": 1234,
  "success": true
}
```

## Roadmap

- [x] TypeScript execution
- [x] Connection pooling
- [x] Security validation
- [x] WebSocket streaming
- [x] Audit logging
- [ ] Python execution
- [ ] Rate limiting
- [ ] Config discovery (.code-executor.json)
- [ ] MCP wrapper auto-generation
- [ ] Docker containerization

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT © [Beehive Innovations](https://github.com/beehiveinnovations)

## Credits

Inspired by [Anthropic's MCP Code Execution article](https://www.anthropic.com/engineering/code-execution-with-mcp)

Built with:
- [Deno](https://deno.land/) - Secure TypeScript runtime
- [MCP SDK](https://github.com/modelcontextprotocol/sdk) - Model Context Protocol
- [Vitest](https://vitest.dev/) - Unit testing
- [Zod](https://zod.dev/) - Runtime validation
