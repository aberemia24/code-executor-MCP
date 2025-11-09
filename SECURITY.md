# Security Policy

## Supported Versions

We release security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Security Model

Code Executor MCP Server is designed with security as the top priority. The security model follows the **Principle of Least Privilege** with multiple layers of defense:

### Defense in Depth

1. **Code Pattern Validation** - Blocks dangerous patterns before execution
2. **Sandbox Isolation** - Deno (TypeScript) and subprocess (Python) provide OS-level isolation
3. **Path Validation** - File system access restricted to explicitly allowed directories
4. **Network Restrictions** - Default: localhost only
5. **Tool Allowlist** - Each execution explicitly lists allowed MCP tools
6. **Rate Limiting** - Optional token bucket algorithm prevents abuse
7. **Audit Logging** - All executions logged with code hash and metadata

### Default Security Posture

**Safe by Default:**
- ❌ No write access (default: `allowWrite: false`)
- ❌ No network access except localhost (default: `allowNetwork: ['localhost', '127.0.0.1']`)
- ❌ No process spawning (dangerous patterns blocked)
- ❌ No dynamic code evaluation (eval, Function, etc. blocked)
- ✅ 30 second timeout (configurable, max 5 minutes)
- ✅ Empty tool allowlist (must explicitly enable each tool)

### Dangerous Patterns Blocked

**JavaScript/TypeScript:**
- `eval()`, `Function()`, `new Function()`, `.constructor.constructor()`
- `require()`, `import()` (dynamic imports)
- `child_process`, `Deno.run`, `Deno.Command`
- `setTimeout('code')`, `setInterval('code')`
- `exec()`, `execSync()`, `execFile()`

**Python:**
- `exec()`, `__import__()`, `compile()`
- `pickle.loads()` - deserialization RCE vulnerability
- `os.system()`, `subprocess.run/call/Popen/check_output`
- `globals()`, `locals()`, `__builtins__` - scope access
- `open(..., 'w')` - write mode file operations

### Audit Trail

When `enableAuditLog: true`, all executions are logged:
- Timestamp (ISO 8601)
- Executor type (typescript/python)
- Code hash (SHA-256)
- Code length (bytes)
- Allowed tools (whitelist)
- Tools called (actual usage)
- Execution time (milliseconds)
- Memory usage (bytes)
- Success/error status
- Client identifier

## Reporting a Vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

### Responsible Disclosure

If you discover a security vulnerability, please follow these steps:

1. **Email us privately** at security@beehiveinnovations.com
2. **Provide details:**
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)
3. **Allow time for fix** - We aim to respond within 48 hours
4. **Coordinate disclosure** - We'll work with you on disclosure timing

### What to Report

**Please report:**
- ✅ Sandbox escape vulnerabilities
- ✅ Path traversal attacks
- ✅ Code injection bypasses
- ✅ Dangerous pattern detection bypasses
- ✅ Authentication/authorization issues
- ✅ Denial of service vulnerabilities
- ✅ Information disclosure vulnerabilities

**No need to report:**
- ❌ Issues in third-party dependencies (report to upstream)
- ❌ Theoretical vulnerabilities without proof of concept
- ❌ Social engineering attacks
- ❌ Physical security issues

### Response Timeline

- **Initial Response:** Within 48 hours
- **Vulnerability Assessment:** Within 1 week
- **Fix Development:** Within 2-4 weeks (depending on severity)
- **Public Disclosure:** After fix is released and users have time to update

### Severity Levels

**Critical (24-48 hour fix):**
- Remote code execution outside sandbox
- Privilege escalation
- Authentication bypass

**High (1 week fix):**
- Sandbox escape
- Path traversal allowing sensitive file access
- Dangerous pattern detection bypass

**Medium (2 weeks fix):**
- Denial of service
- Information disclosure
- Rate limit bypass

**Low (Next release):**
- Minor security improvements
- Defense-in-depth enhancements

## Security Best Practices

### For Administrators

1. **Restrict File Access**
   ```json
   {
     "security": {
       "allowRead": ["/specific/project/path"],
       "allowWrite": false
     }
   }
   ```

2. **Enable Audit Logging**
   ```json
   {
     "security": {
       "enableAuditLog": true,
       "auditLogPath": "/var/log/code-executor.log"
     }
   }
   ```

3. **Enable Rate Limiting**
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

4. **Monitor Audit Logs**
   - Review logs regularly for suspicious activity
   - Set up alerts for failed executions
   - Track tool usage patterns

5. **Keep Updated**
   - Subscribe to security advisories
   - Update to latest version promptly
   - Review changelog for security fixes

### For Developers

1. **Validate All Inputs**
   - Use Zod schemas for runtime validation
   - Never trust user-provided code paths
   - Sanitize error messages

2. **Follow Least Privilege**
   - Only request necessary permissions
   - Use smallest possible tool allowlist
   - Set appropriate timeouts

3. **Test Security Assumptions**
   - Write tests for security boundaries
   - Test with malicious inputs
   - Verify sandbox isolation

4. **Review Dependencies**
   - Run `npm audit` regularly
   - Update dependencies promptly
   - Review security advisories

## Security Hardening Checklist

- [ ] Set `allowRead` to specific project paths (not home directory)
- [ ] Set `allowWrite: false` unless absolutely necessary
- [ ] Set `allowNetwork` to specific hosts (not `true`)
- [ ] Enable `enableAuditLog: true`
- [ ] Enable `rateLimit.enabled: true`
- [ ] Set `maxTimeoutMs` to reasonable value (not maximum)
- [ ] Review audit logs regularly
- [ ] Update to latest version
- [ ] Run with least privilege user account
- [ ] Use environment variables for secrets (`env:VAR_NAME`)
- [ ] Monitor for suspicious patterns in audit logs

## Known Security Considerations

### 1. Localhost MCP Servers

The MCP proxy server binds to `localhost` only. This is by design - MCP servers are intended to run on the same machine as the LLM client.

**Not a vulnerability:** The proxy server is only accessible from the local machine.

### 2. Code Execution by Design

This server executes arbitrary code by design. The security model assumes:
- Code is provided by trusted LLM
- Sandbox isolation prevents escape
- Pattern detection blocks dangerous operations
- Path validation restricts file access

**Not a vulnerability:** Executing code is the core feature.

### 3. Deno Permissions

Deno sandbox permissions are enforced at the OS level. However:
- Permissions are specified per execution
- User is responsible for setting appropriate permissions
- No permission escalation is possible

**User responsibility:** Configure appropriate Deno permissions.

### 4. Python Subprocess

Python execution uses subprocess, which has fewer isolation guarantees than Deno:
- Python is disabled by default
- Pattern detection blocks dangerous imports
- File system access limited by user permissions
- No network access except localhost

**Recommendation:** Keep Python executor disabled unless required.

## Security Updates

Security updates will be released as:
- **Critical:** Immediate patch release (1.x.1)
- **High:** Patch release within 1 week (1.x.x)
- **Medium:** Minor release within 2 weeks (1.x.0)
- **Low:** Next regular release (1.x.0)

Subscribe to GitHub releases for notifications.

## Hall of Fame

We thank the following security researchers for responsible disclosure:

*(No reports yet - be the first!)*

## Contact

- **Security Email:** security@beehiveinnovations.com
- **General Issues:** https://github.com/beehiveinnovations/code-executor-mcp/issues
- **Documentation:** https://github.com/beehiveinnovations/code-executor-mcp#readme

---

**Security is a shared responsibility.** Thank you for helping keep Code Executor MCP Server secure!
