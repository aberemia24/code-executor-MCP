# Test Updates Required for v1.3.0

## Changes Made
1. `isAllowedPath()` is now async (returns `Promise<boolean>`)
2. `validatePermissions()` is now async (returns `Promise<void>`)

## Tests to Update

### tests/utils.test.ts
All `isAllowedPath` tests need to be updated to use `await`:

```typescript
// Before:
expect(isAllowedPath('/home/user/project', ['/home/user'])).toBe(true);

// After:
await expect(isAllowedPath('/home/user/project', ['/home/user'])).resolves.toBe(true);
```

### tests/security.test.ts
All `validatePermissions` tests need to be updated to use `await`:

```typescript
// Before:
expect(() => validator.validatePermissions(permissions)).toThrow(/Read path not allowed/);

// After:
await expect(validator.validatePermissions(permissions)).rejects.toThrow(/Read path not allowed/);
```

## New Tests to Add

### tests/network-security.test.ts (NEW FILE)
```typescript
import { describe, it, expect } from 'vitest';
import { isBlockedHost, validateUrl, validateNetworkPermissions } from '../src/network-security';

describe('SSRF Protection', () => {
  it('should_block_localhost_variations', () => {
    expect(isBlockedHost('localhost')).toBe(true);
    expect(isBlockedHost('127.0.0.1')).toBe(true);
    expect(isBlockedHost('::1')).toBe(true);
  });

  it('should_block_private_networks', () => {
    expect(isBlockedHost('10.0.0.1')).toBe(true);
    expect(isBlockedHost('172.16.0.1')).toBe(true);
    expect(isBlockedHost('192.168.1.1')).toBe(true);
  });

  it('should_block_cloud_metadata', () => {
    expect(isBlockedHost('169.254.169.254')).toBe(true);
    expect(isBlockedHost('metadata.google.internal')).toBe(true);
  });

  it('should_allow_public_hosts', () => {
    expect(isBlockedHost('google.com')).toBe(false);
    expect(isBlockedHost('api.github.com')).toBe(false);
    expect(isBlockedHost('8.8.8.8')).toBe(false);
  });

  it('should_validate_urls_with_ssrf_protection', () => {
    const result1 = validateUrl('http://169.254.169.254/latest/meta-data');
    expect(result1.allowed).toBe(false);
    expect(result1.reason).toContain('cloud metadata');

    const result2 = validateUrl('https://api.github.com');
    expect(result2.allowed).toBe(true);
  });
});
```

### tests/security.test.ts
Add new test for network permissions:

```typescript
describe('SSRF Protection', () => {
  it('should_block_private_ip_in_network_permissions', async () => {
    const validator = new SecurityValidator();
    const permissions: SandboxPermissions = {
      net: ['10.0.0.1']
    };

    await expect(validator.validatePermissions(permissions))
      .rejects.toThrow(/blocked hosts for SSRF protection/);
  });

  it('should_allow_localhost_for_mcp_proxy', async () => {
    const validator = new SecurityValidator();
    const permissions: SandboxPermissions = {
      net: ['localhost', '127.0.0.1']
    };

    // Should not throw - localhost is allowed for MCP proxy
    await expect(validator.validatePermissions(permissions)).resolves.not.toThrow();
  });
});
```

### Integration Tests
Add tests for:
1. Path traversal prevention (create symlink, verify blocked)
2. HTTP proxy authentication (401 without token)
3. Temp file integrity (modify file, verify error)

## Run Tests
```bash
npm test
```

## Expected Results
- All 122 tests passing (105 existing + 17 new)
- 95%+ code coverage maintained
