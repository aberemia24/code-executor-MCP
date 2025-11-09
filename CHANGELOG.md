# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2024-11-09

### Added
- ✨ **HTTP/SSE Transport Support** - Connect to remote MCP servers (Linear, GitHub, etc.)
  - StreamableHTTP transport (modern, bidirectional)
  - SSE (Server-Sent Events) transport fallback
  - Authentication via HTTP headers (Bearer tokens, custom headers)
  - Automatic transport fallback (StreamableHTTP → SSE)
- ✨ **Multi-Transport Architecture** - Unified dispatcher for STDIO and HTTP transports
- ✨ **Process Cleanup** - Graceful shutdown for STDIO servers (SIGTERM → SIGKILL)

### Changed
- 🔧 **Type System** - Split `MCPServerConfig` into `StdioServerConfig` and `HttpServerConfig`
- 🔧 **Client Pool** - Enhanced connection logic with transport-specific handlers
- 📖 **Documentation** - Added HTTP/SSE configuration examples to README

### Technical Details
- **Transports**: STDIO (local processes) + StreamableHTTP/SSE (remote servers)
- **Authentication**: Full HTTP header support for OAuth/token-based auth
- **Fallback**: Automatic StreamableHTTP → SSE transition
- **Cleanup**: Graceful process termination with 2-second timeout

## [1.0.0] - 2024-11-09

### Added
- ✨ **TypeScript Executor** - Deno sandbox with fine-grained permissions
- ✨ **Python Executor** - Subprocess execution with MCP access (optional)
- ✨ **Progressive Disclosure** - 98% token savings (1,600 vs 150,000 tokens)
- ✨ **Configuration Discovery** - Auto-search .code-executor.json in 4 locations
- ✨ **Rate Limiting** - Token bucket algorithm (30 req/min default)
- ✨ **Security Hardening** - Dangerous pattern detection (JS/TS + Python)
- ✨ **Enhanced Audit Logging** - Code hash, length, memory usage, executor type
- ✨ **Connection Pooling** - Max 100 concurrent executions
- ✨ **Secret Management** - env:VAR_NAME pattern for secure config
- ✨ **MCP Proxy Server** - Shared between TypeScript and Python executors

### Security
- 🔒 Sandbox isolation (Deno for TypeScript, subprocess for Python)
- 🔒 Tool allowlist validation
- 🔒 Path validation (read/write restrictions)
- 🔒 Network restrictions (localhost-only default)
- 🔒 Dangerous pattern blocking (eval, exec, __import__, pickle.loads, etc.)
- 🔒 Comprehensive audit trail

### Documentation
- 📖 Comprehensive README (484 lines)
- 📖 Security policy (SECURITY.md) - Responsible disclosure
- 📖 Contributing guidelines (CONTRIBUTING.md) - Code quality standards
- 📖 License (MIT)
- 📖 Release guide (RELEASE.md)

### Testing
- ✅ 105 tests passing
- ✅ 90%+ code coverage
- ✅ TypeScript strict mode
- ✅ GitHub Actions CI/CD
- ✅ Automated npm publishing

### Technical Details
- **Node.js**: 22.x or higher required
- **Deno**: Required for TypeScript execution
- **Python**: 3.9+ (optional, for Python execution)
- **Dependencies**: @modelcontextprotocol/sdk, zod, ws
- **Build**: TypeScript 5.x with strict mode
- **Tests**: Vitest 4.0

### Architecture
- Config discovery with priority chain
- Token bucket rate limiter
- Security validator with pattern detection
- MCP client pool with graceful degradation
- Connection pooling with FIFO queue
- Shared MCP proxy server (DRY principle)

### Breaking Changes
None - Initial release

### Migration Guide
First release - no migration needed.

See installation instructions in [README.md](README.md).

---

## Release Process

See [RELEASE.md](RELEASE.md) for the complete release process.

## Support

- **Issues**: https://github.com/aberemia24/code-executor-MCP/issues
- **Email**: aberemia@gmail.com
- **Documentation**: https://github.com/aberemia24/code-executor-MCP#readme
