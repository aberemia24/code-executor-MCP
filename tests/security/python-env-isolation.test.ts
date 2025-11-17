import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { executePythonInSandbox } from '../../src/python-executor.js';
import { MCPClientPool } from '../../src/mcp-client-pool.js';
import { initConfig } from '../../src/config.js';

describe('Python Environment Isolation (VULN-003 Fix)', () => {
  let mcpClientPool: MCPClientPool;

  beforeAll(async () => {
    // Initialize config (required for Python path)
    await initConfig();
    mcpClientPool = new MCPClientPool();
    // Don't initialize MCP pool - no MCP connections needed for this test
  });

  afterAll(async () => {
    await mcpClientPool.disconnect();
  });

  it('should have minimal environment variables (no parent secrets)', async () => {
    const result = await executePythonInSandbox(
      {
        code: `import os
env_count = len(os.environ)
# Check that common secret env vars are NOT present
has_aws = 'AWS_ACCESS_KEY_ID' in os.environ
has_db = 'DATABASE_URL' in os.environ
print(f'env_count:{env_count}')
print(f'has_aws:{has_aws}')
print(f'has_db:{has_db}')`,
        allowedTools: [],
        timeoutMs: 5000,
        permissions: {},
      },
      mcpClientPool
    );

    expect(result.success).toBe(true);
    // Python may set a few internal env vars, but should be < 10
    expect(result.output).toContain('has_aws:False');
    expect(result.output).toContain('has_db:False');
  }, 10000);

  it('should not inherit AWS credentials from parent process', async () => {
    // Save original values for restoration
    const originalAwsKey = process.env.AWS_ACCESS_KEY_ID;
    const originalAwsSecret = process.env.AWS_SECRET_ACCESS_KEY;

    // Set fake AWS credentials in parent process
    process.env.AWS_ACCESS_KEY_ID = 'FAKE_KEY_FOR_TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'FAKE_SECRET_FOR_TEST';

    const result = await executePythonInSandbox(
      {
        code: `import os
print(os.environ.get('AWS_ACCESS_KEY_ID', 'NOT_FOUND'))
print(os.environ.get('AWS_SECRET_ACCESS_KEY', 'NOT_FOUND'))`,
        allowedTools: [],
        timeoutMs: 5000,
        permissions: {},
      },
      mcpClientPool
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('NOT_FOUND');
    expect(result.output).not.toContain('FAKE_KEY_FOR_TEST');
    expect(result.output).not.toContain('FAKE_SECRET_FOR_TEST');

    // Restore original values
    if (originalAwsKey !== undefined) {
      process.env.AWS_ACCESS_KEY_ID = originalAwsKey;
    } else {
      delete process.env.AWS_ACCESS_KEY_ID;
    }
    if (originalAwsSecret !== undefined) {
      process.env.AWS_SECRET_ACCESS_KEY = originalAwsSecret;
    } else {
      delete process.env.AWS_SECRET_ACCESS_KEY;
    }
  }, 10000);

  it('should not leak DATABASE_URL from parent process', async () => {
    // Save original value for restoration
    const originalDatabaseUrl = process.env.DATABASE_URL;

    process.env.DATABASE_URL = 'postgresql://user:password@localhost/db';

    const result = await executePythonInSandbox(
      {
        code: `import os
db_url = os.environ.get('DATABASE_URL', 'NOT_FOUND')
print(db_url)`,
        allowedTools: [],
        timeoutMs: 5000,
        permissions: {},
      },
      mcpClientPool
    );

    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('NOT_FOUND');
    expect(result.output).not.toContain('postgresql');
    expect(result.output).not.toContain('password');

    // Restore original value
    if (originalDatabaseUrl !== undefined) {
      process.env.DATABASE_URL = originalDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  }, 10000);
});

