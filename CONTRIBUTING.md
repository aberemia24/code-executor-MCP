# Contributing to Code Executor MCP Server

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to the project.

## 🎯 Code of Conduct

Be respectful, inclusive, and professional. We're building tools for the community.

## 🚀 Getting Started

### Prerequisites

- **Node.js** 22.x or higher
- **npm** (comes with Node.js)
- **Deno** (for TypeScript execution testing)
- **Python** 3.9+ (optional, for Python execution testing)
- **Git**

### Setup

1. **Fork the repository** on GitHub

2. **Clone your fork:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/code-executor-MCP.git
   cd code-executor-MCP
   ```

3. **Add upstream remote:**
   ```bash
   git remote add upstream https://github.com/aberemia24/code-executor-MCP.git
   ```

4. **Install dependencies:**
   ```bash
   npm install
   ```

5. **Run tests to verify setup:**
   ```bash
   npm test
   ```

## 🔧 Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-number-description
```

**Branch naming:**
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `refactor/` - Code refactoring
- `test/` - Test improvements

### 2. Make Changes

**Follow these standards:**
- ✅ TypeScript strict mode
- ✅ No `any` types (use `unknown` with type guards)
- ✅ Explicit return types on public functions
- ✅ ESLint rules (no disabling without explanation)
- ✅ Meaningful variable/function names
- ✅ JSDoc comments on public APIs

**Code style:**
```typescript
// ✅ GOOD
export function validateCode(code: string): CodeValidationResult {
  const errors: string[] = [];

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      errors.push(`Dangerous pattern detected: ${pattern.source}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
  };
}

// ❌ BAD
export function validateCode(code: any) {  // No 'any' types
  let errors = [];  // Missing type annotation
  // Missing return type
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) errors.push(`Bad: ${pattern.source}`);  // Use descriptive messages
  }
  return { valid: errors.length === 0, errors };
}
```

### 3. Write Tests

**Test coverage requirements:**
- ✅ 90%+ coverage on business logic
- ✅ Test happy path and edge cases
- ✅ Test error handling
- ✅ Descriptive test names: `should_X_when_Y`

**Example:**
```typescript
import { describe, it, expect } from 'vitest';
import { validateCode } from '../src/security.js';

describe('validateCode', () => {
  it('should_detect_eval_usage', () => {
    const code = 'eval("alert(1)")';
    const result = validateCode(code);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Dangerous pattern detected: eval');
  });

  it('should_allow_safe_code', () => {
    const code = 'console.log("Hello world")';
    const result = validateCode(code);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
```

### 4. Run Tests and Checks

```bash
# Type check
npm run typecheck

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Build
npm run build

# All checks (run before committing)
npm run typecheck && npm test && npm run build
```

**All must pass before submitting PR.**

### 5. Commit Changes

**Commit message format:**
```
type(scope): subject

body (optional)

footer (optional)
```

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `refactor` - Code refactoring
- `test` - Test improvements
- `chore` - Build/tooling changes

**Examples:**
```bash
git commit -m "feat(python): add Python executor with subprocess isolation"
git commit -m "fix(security): block pickle.loads() deserialization RCE"
git commit -m "docs(readme): add Python execution examples"
git commit -m "test(rate-limiter): add token bucket algorithm tests"
```

### 6. Push and Create PR

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub.

## 📝 Pull Request Guidelines

### PR Description Template

```markdown
## Description
Brief description of changes

## Motivation
Why are these changes needed?

## Changes
- Change 1
- Change 2

## Testing
- [ ] All tests passing
- [ ] New tests added for new functionality
- [ ] Manual testing completed

## Checklist
- [ ] TypeScript strict mode compliance
- [ ] No `any` types
- [ ] ESLint passing
- [ ] Tests passing (105+)
- [ ] Documentation updated
- [ ] CHANGELOG.md updated (if user-facing change)
```

### Review Process

1. **Automated Checks** - CI must pass
2. **Code Review** - At least one maintainer approval
3. **Testing** - Manual testing if needed
4. **Merge** - Squash and merge (maintainers)

## 🧪 Testing Guidelines

### Unit Tests

**Test business logic, utilities, and security functions:**

```typescript
// tests/security.test.ts
describe('SecurityValidator', () => {
  it('should_validate_allowlist', () => {
    const validator = new SecurityValidator();
    const tools = ['mcp__zen__codereview', 'mcp__filesystem__read_file'];

    expect(() => validator.validateAllowlist(tools)).not.toThrow();
  });
});
```

### Integration Tests

**Test component interactions:**

```typescript
// tests/mcp-client-pool.test.ts
describe('MCPClientPool', () => {
  it('should_connect_to_all_configured_servers', async () => {
    const pool = new MCPClientPool();
    await pool.initialize();

    const tools = pool.listAllTools();
    expect(tools.length).toBeGreaterThan(0);
  });
});
```

### Test Organization

```
tests/
├── unit/
│   ├── security.test.ts
│   ├── utils.test.ts
│   └── rate-limiter.test.ts
├── integration/
│   ├── mcp-client-pool.test.ts
│   └── sandbox-executor.test.ts
└── fixtures/
    └── mock-mcp-config.json
```

## 🏗️ Project Structure

```
code-executor-mcp/
├── src/
│   ├── index.ts              # Main server
│   ├── config.ts             # Configuration manager
│   ├── config-discovery.ts   # Config discovery service
│   ├── config-types.ts       # Zod schemas
│   ├── security.ts           # Security validator
│   ├── rate-limiter.ts       # Rate limiting
│   ├── sandbox-executor.ts   # TypeScript executor
│   ├── python-executor.ts    # Python executor
│   ├── mcp-proxy-server.ts   # Shared MCP proxy
│   ├── mcp-client-pool.ts    # MCP client management
│   ├── connection-pool.ts    # Connection pooling
│   ├── schemas.ts            # Input schemas
│   ├── types.ts              # Type definitions
│   └── utils.ts              # Utilities
├── tests/
│   ├── *.test.ts             # Unit tests
│   └── fixtures/             # Test fixtures
├── docs/                     # Documentation
├── .github/                  # GitHub Actions
└── package.json
```

## 📖 Documentation

### JSDoc Comments

**Required for:**
- Public functions
- Complex algorithms
- Security-critical code
- tRPC procedures

**Example:**
```typescript
/**
 * Validate code for dangerous patterns
 *
 * Blocks eval(), Function(), require(), import(), and other dangerous operations
 * that could lead to sandbox escape or code injection.
 *
 * @param code - Code to validate
 * @returns Validation result with errors and warnings
 *
 * @example
 * const result = validateCode('console.log("safe")');
 * if (!result.valid) {
 *   throw new Error(result.errors.join('\n'));
 * }
 */
export function validateCode(code: string): CodeValidationResult {
  // ...
}
```

### README Updates

Update README.md when adding:
- New features
- Configuration options
- Usage examples
- Breaking changes

## 🔒 Security

**Security-related contributions:**
- Follow responsible disclosure (see SECURITY.md)
- Add tests for security fixes
- Document security implications
- Update dangerous patterns list if needed

**Security review required for:**
- Changes to security validation
- Sandbox isolation changes
- Path validation changes
- MCP proxy changes

## 🐛 Bug Reports

**Good bug reports include:**
- Clear title
- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment (Node.js version, OS, etc.)
- Logs/error messages

**Template:**
```markdown
**Describe the bug**
Clear description

**To Reproduce**
1. Step 1
2. Step 2

**Expected behavior**
What should happen

**Actual behavior**
What actually happens

**Environment**
- Node.js version: 22.0.0
- OS: Ubuntu 22.04
- code-executor-mcp version: 1.0.0

**Logs**
```
error logs here
```
```

## 💡 Feature Requests

**Good feature requests include:**
- Use case description
- Proposed solution
- Alternative solutions considered
- Additional context

## 📊 Performance

**Performance improvements:**
- Include benchmarks
- Document performance impact
- Add performance tests
- Consider memory usage

**Example:**
```typescript
// Performance test
describe('Performance', () => {
  it('should_handle_100_concurrent_executions', async () => {
    const pool = new ConnectionPool(100);
    const start = Date.now();

    const promises = Array.from({ length: 100 }, () =>
      pool.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
      })
    );

    await Promise.all(promises);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(1000); // Should complete within 1s
  });
});
```

## 🎨 Code Style

**Formatting:**
- 2 spaces for indentation
- Single quotes for strings
- Semicolons required
- Trailing commas in multi-line
- Max line length: 100 characters

**Naming:**
- `camelCase` - functions, variables
- `PascalCase` - classes, types, interfaces
- `UPPER_SNAKE_CASE` - constants
- `kebab-case` - files

**Example:**
```typescript
// Constants
const MAX_TIMEOUT_MS = 300000;

// Types
interface ExecutionResult {
  success: boolean;
  output: string;
}

// Classes
class RateLimiter {
  private buckets: Map<string, TokenBucket>;

  async checkLimit(clientId: string): Promise<RateLimitResult> {
    // ...
  }
}

// Functions
export function normalizeError(error: unknown, context: string): Error {
  // ...
}
```

## 🤝 Community

- **GitHub Issues** - Bug reports, feature requests
- **GitHub Discussions** - Questions, ideas, showcase
- **Pull Requests** - Code contributions

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

## 🙏 Recognition

Contributors will be recognized in:
- README.md acknowledgments
- CHANGELOG.md entries
- GitHub contributors page

---

**Thank you for contributing to Code Executor MCP Server!** 🚀

Your contributions help make MCP development more efficient for everyone.
