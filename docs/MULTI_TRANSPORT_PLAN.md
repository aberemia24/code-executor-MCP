# Multi-Transport MCP Support Implementation Plan

**Status:** Planning Phase
**Target:** v1.1.0
**Date:** 2025-01-09
**Research Date:** 2025 MCP Specification

## Executive Summary

Extend code-executor-mcp to support **all 3 MCP transport types** (stdio, SSE, Streamable HTTP) with **OAuth 2.1 authentication**, enabling connections to authenticated MCP servers like Linear while maintaining backward compatibility.

**Current State:** Only supports stdio transport, no authentication
**Target State:** Universal MCP client supporting stdio, SSE, and Streamable HTTP with OAuth 2.1

---

## Research Findings (2025 MCP Specification)

### 1. MCP Transport Evolution

**2024-11-05:** HTTP+SSE transport
**2025-03-26:** **Streamable HTTP replaces HTTP+SSE** (current standard)
**Current:** Two primary transports:
- **stdio** - Local child processes (current implementation)
- **Streamable HTTP** - Remote servers with optional SSE fallback

### 2. Authentication Standards (March 2025 Update)

**Major Change:** MCP specification now mandates **OAuth 2.1** for HTTP-based transports.

**Key Features:**
- **PKCE mandatory** for all clients (prevents authorization code interception)
- **Dynamic client registration** (automated OAuth credential provisioning)
- **Metadata discovery** via `/.well-known/oauth-authorization-server`
- **Bearer token authentication** in `Authorization` header
- **stdio exemption** - SHOULD retrieve credentials from environment

**Security Baseline:**
- All tokens in `Authorization: Bearer <token>` header (NEVER in query strings)
- Token validation required on every request
- HTTP 401 on invalid tokens

### 3. Transport Type Implementations

#### A. StdioClientTransport (Current)
```typescript
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-linear'],
  env: {
    LINEAR_API_TOKEN: process.env.LINEAR_API_TOKEN // Environment-based auth
  }
});
```

**Characteristics:**
- Node.js only (uses `child_process`)
- No OAuth flow (environment variables for credentials)
- Local execution
- Current implementation ✅

#### B. SSEClientTransport (Legacy, still supported)
```typescript
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const transport = new SSEClientTransport({
  url: 'https://api.example.com/mcp',
  headers: {
    'Authorization': `Bearer ${accessToken}` // OAuth token
  }
});
```

**Characteristics:**
- Server-Sent Events for server→client streaming
- HTTP POST for client→server
- OAuth 2.1 required
- Browser-compatible
- Being replaced by Streamable HTTP

#### C. StreamableHTTPClientTransport (2025 Standard)
```typescript
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport({
  url: 'https://api.example.com/v1/mcp',
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
```

**Characteristics:**
- Modern HTTP streaming (replaces SSE)
- Backward compatible (fallback to SSE if needed)
- OAuth 2.1 required
- Full-duplex over single HTTP connection
- **Recommended for new implementations**

### 4. Real-World Examples

#### Linear MCP Server (Official)
**Transport:** Streamable HTTP + OAuth 2.1
**Auth:** OAuth with dynamic client registration
**Endpoints:**
```
Server: https://linear.app/api/mcp
Discovery: https://linear.app/.well-known/oauth-authorization-server
```

**Configuration Pattern:**
```json
{
  "mcpServers": {
    "linear": {
      "type": "streamableHttp",
      "url": "https://linear.app/api/mcp",
      "auth": {
        "type": "oauth2.1",
        "authorizationUrl": "https://linear.app/oauth/authorize",
        "tokenUrl": "https://linear.app/oauth/token",
        "clientId": "dynamically-registered",
        "scopes": ["read", "write"],
        "pkce": true
      }
    }
  }
}
```

#### Linear MCP Server (Community stdio)
**Transport:** stdio
**Auth:** Environment variable
**Configuration:**
```json
{
  "mcpServers": {
    "linear": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-linear"],
      "env": {
        "LINEAR_API_TOKEN": "env:LINEAR_API_TOKEN"
      }
    }
  }
}
```

---

## Implementation Roadmap

### Phase 1: Configuration Schema Extension (1-2 days)

**Goal:** Extend `.mcp.json` schema to support multiple transport types and authentication.

#### 1.1 Update TypeScript Types

**File:** `src/types.ts`

```typescript
/**
 * MCP Transport types
 */
export type MCPTransportType = 'stdio' | 'sse' | 'streamableHttp';

/**
 * OAuth 2.1 configuration
 */
export interface OAuth21Config {
  type: 'oauth2.1';
  /** Authorization endpoint (or use metadata discovery) */
  authorizationUrl?: string;
  /** Token endpoint (or use metadata discovery) */
  tokenUrl?: string;
  /** Registration endpoint (or use metadata discovery) */
  registrationUrl?: string;
  /** Client ID (if manually registered) */
  clientId?: string;
  /** Client secret (if manually registered) */
  clientSecret?: string;
  /** OAuth scopes */
  scopes?: string[];
  /** Enable PKCE (default: true) */
  pkce?: boolean;
  /** Use metadata discovery (default: true) */
  useDiscovery?: boolean;
}

/**
 * Bearer token authentication (for simple API tokens)
 */
export interface BearerTokenAuth {
  type: 'bearer';
  /** Token value or env:VAR_NAME reference */
  token: string;
}

/**
 * Authentication configuration
 */
export type AuthConfig = OAuth21Config | BearerTokenAuth;

/**
 * stdio transport configuration
 */
export interface StdioTransportConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** No auth field - use env vars */
}

/**
 * SSE/Streamable HTTP transport configuration
 */
export interface HttpTransportConfig {
  type: 'sse' | 'streamableHttp';
  url: string;
  /** Authentication configuration */
  auth?: AuthConfig;
  /** Additional headers */
  headers?: Record<string, string>;
}

/**
 * Unified server configuration
 */
export type MCPServerConfig = StdioTransportConfig | HttpTransportConfig;

/**
 * MCP configuration file (.mcp.json)
 */
export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}
```

#### 1.2 Schema Validation with Zod

**File:** `src/config-types.ts`

```typescript
import { z } from 'zod';

// OAuth 2.1 schema
const OAuth21Schema = z.object({
  type: z.literal('oauth2.1'),
  authorizationUrl: z.string().url().optional(),
  tokenUrl: z.string().url().optional(),
  registrationUrl: z.string().url().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  pkce: z.boolean().default(true),
  useDiscovery: z.boolean().default(true),
});

// Bearer token schema
const BearerTokenSchema = z.object({
  type: z.literal('bearer'),
  token: z.string(), // Can be env:VAR_NAME
});

// Auth config union
const AuthConfigSchema = z.union([OAuth21Schema, BearerTokenSchema]);

// stdio transport
const StdioTransportSchema = z.object({
  type: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

// HTTP transport (SSE or Streamable HTTP)
const HttpTransportSchema = z.object({
  type: z.enum(['sse', 'streamableHttp']),
  url: z.string().url(),
  auth: AuthConfigSchema.optional(),
  headers: z.record(z.string()).optional(),
});

// Unified server config
export const MCPServerConfigSchema = z.union([
  StdioTransportSchema,
  HttpTransportSchema,
]);

// MCP config file
export const MCPConfigSchema = z.object({
  mcpServers: z.record(MCPServerConfigSchema),
});

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;
export type MCPConfig = z.infer<typeof MCPConfigSchema>;
```

#### 1.3 Backward Compatibility

**Current format (implicit stdio):**
```json
{
  "mcpServers": {
    "zen": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-zen"]
    }
  }
}
```

**Strategy:** Auto-detect and convert to new format:
```typescript
function normalizeServerConfig(config: unknown): MCPServerConfig {
  // If has 'command' but no 'type', it's legacy stdio
  if (typeof config === 'object' && config !== null && 'command' in config && !('type' in config)) {
    return {
      type: 'stdio',
      ...config,
    } as StdioTransportConfig;
  }
  return MCPServerConfigSchema.parse(config);
}
```

---

### Phase 2: OAuth 2.1 Client Implementation (3-5 days)

**Goal:** Implement OAuth 2.1 flow with PKCE and dynamic registration.

#### 2.1 OAuth Client Module

**File:** `src/oauth-client.ts`

```typescript
import * as crypto from 'crypto';
import * as http from 'http';
import type { OAuth21Config } from './types.js';

/**
 * OAuth 2.1 client with PKCE support
 */
export class OAuth21Client {
  private codeVerifier: string = '';
  private codeChallenge: string = '';

  constructor(private config: OAuth21Config) {}

  /**
   * Discover OAuth endpoints via metadata
   */
  async discoverEndpoints(baseUrl: string): Promise<{
    authorizationUrl: string;
    tokenUrl: string;
    registrationUrl?: string;
  }> {
    const discoveryUrl = new URL('/.well-known/oauth-authorization-server', baseUrl);

    const response = await fetch(discoveryUrl.toString(), {
      headers: {
        'MCP-Protocol-Version': '2025-03-26',
      },
    });

    if (response.status === 404) {
      // Fallback to default endpoints
      const base = new URL(baseUrl);
      return {
        authorizationUrl: new URL('/authorize', base).toString(),
        tokenUrl: new URL('/token', base).toString(),
        registrationUrl: new URL('/register', base).toString(),
      };
    }

    if (!response.ok) {
      throw new Error(`Metadata discovery failed: ${response.statusText}`);
    }

    const metadata = await response.json();
    return {
      authorizationUrl: metadata.authorization_endpoint,
      tokenUrl: metadata.token_endpoint,
      registrationUrl: metadata.registration_endpoint,
    };
  }

  /**
   * Generate PKCE challenge
   */
  private generatePKCE(): { verifier: string; challenge: string } {
    // Generate cryptographically secure random verifier (43-128 chars)
    const verifier = crypto.randomBytes(32).toString('base64url');

    // Create SHA-256 challenge
    const challenge = crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64url');

    return { verifier, challenge };
  }

  /**
   * Dynamic client registration
   */
  async registerClient(registrationUrl: string): Promise<{
    clientId: string;
    clientSecret?: string;
  }> {
    const response = await fetch(registrationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_name: 'code-executor-mcp',
        redirect_uris: ['http://localhost:3000/oauth/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none', // Public client
      }),
    });

    if (!response.ok) {
      throw new Error(`Client registration failed: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      clientId: data.client_id,
      clientSecret: data.client_secret,
    };
  }

  /**
   * Start authorization flow
   *
   * Opens browser and waits for callback with authorization code
   */
  async authorize(authorizationUrl: string, clientId: string): Promise<string> {
    // Generate PKCE
    const { verifier, challenge } = this.generatePKCE();
    this.codeVerifier = verifier;
    this.codeChallenge = challenge;

    // Build authorization URL
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: 'http://localhost:3000/oauth/callback',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: (this.config.scopes || []).join(' '),
    });

    const url = `${authorizationUrl}?${params.toString()}`;

    // Start local callback server
    const authCode = await this.startCallbackServer();

    // Open browser
    console.error(`\n🔐 Opening browser for authorization...\n${url}\n`);
    const { default: open } = await import('open');
    await open(url);

    return authCode;
  }

  /**
   * Start local HTTP server to receive OAuth callback
   */
  private async startCallbackServer(): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url || '', 'http://localhost:3000');

        if (url.pathname === '/oauth/callback') {
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(400);
            res.end(`Authorization failed: ${error}`);
            server.close();
            reject(new Error(`OAuth error: ${error}`));
            return;
          }

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body>
                  <h1>✅ Authorization successful!</h1>
                  <p>You can close this window and return to the terminal.</p>
                </body>
              </html>
            `);
            server.close();
            resolve(code);
            return;
          }
        }

        res.writeHead(404);
        res.end('Not found');
      });

      server.listen(3000, () => {
        console.error('📡 Listening for OAuth callback on http://localhost:3000');
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('OAuth authorization timeout (5 minutes)'));
      }, 300000);
    });
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCode(
    tokenUrl: string,
    clientId: string,
    authCode: string
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }> {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: 'http://localhost:3000/oauth/callback',
        client_id: clientId,
        code_verifier: this.codeVerifier, // PKCE verification
      }).toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  /**
   * Refresh access token
   */
  async refreshToken(
    tokenUrl: string,
    clientId: string,
    refreshToken: string
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }> {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn: data.expires_in,
    };
  }
}
```

#### 2.2 Token Storage

**File:** `src/token-storage.ts`

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';

/**
 * Secure token storage
 *
 * Tokens stored in ~/.code-executor/tokens.json with restricted permissions
 */
export class TokenStorage {
  private tokenPath: string;

  constructor() {
    this.tokenPath = path.join(homedir(), '.code-executor', 'tokens.json');
  }

  /**
   * Initialize storage directory
   */
  private async ensureDirectory(): Promise<void> {
    const dir = path.dirname(this.tokenPath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 }); // Owner-only
  }

  /**
   * Save token for server
   */
  async saveToken(
    serverName: string,
    token: {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
    }
  ): Promise<void> {
    await this.ensureDirectory();

    let tokens: Record<string, unknown> = {};

    try {
      const content = await fs.readFile(this.tokenPath, 'utf-8');
      tokens = JSON.parse(content);
    } catch {
      // File doesn't exist yet
    }

    tokens[serverName] = token;

    // Write with owner-only permissions
    await fs.writeFile(
      this.tokenPath,
      JSON.stringify(tokens, null, 2),
      { mode: 0o600 }
    );
  }

  /**
   * Load token for server
   */
  async loadToken(serverName: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  } | null> {
    try {
      const content = await fs.readFile(this.tokenPath, 'utf-8');
      const tokens = JSON.parse(content);
      return tokens[serverName] || null;
    } catch {
      return null;
    }
  }

  /**
   * Delete token for server
   */
  async deleteToken(serverName: string): Promise<void> {
    try {
      const content = await fs.readFile(this.tokenPath, 'utf-8');
      const tokens = JSON.parse(content);
      delete tokens[serverName];
      await fs.writeFile(this.tokenPath, JSON.stringify(tokens, null, 2));
    } catch {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Check if token is expired
   */
  isTokenExpired(token: { expiresAt?: number }): boolean {
    if (!token.expiresAt) return false;
    return Date.now() >= token.expiresAt;
  }
}
```

---

### Phase 3: Transport Factory (2-3 days)

**Goal:** Create transport factory that instantiates correct transport type with authentication.

#### 3.1 Transport Factory

**File:** `src/transport-factory.ts`

```typescript
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { OAuth21Client } from './oauth-client.js';
import { TokenStorage } from './token-storage.js';
import type { MCPServerConfig, AuthConfig } from './types.js';

/**
 * Creates appropriate MCP transport based on configuration
 */
export class TransportFactory {
  private tokenStorage = new TokenStorage();

  /**
   * Create transport for server configuration
   */
  async createTransport(
    serverName: string,
    config: MCPServerConfig
  ): Promise<StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport> {
    switch (config.type) {
      case 'stdio':
        return this.createStdioTransport(config);

      case 'sse':
      case 'streamableHttp':
        return await this.createHttpTransport(serverName, config);

      default:
        throw new Error(`Unknown transport type: ${(config as { type: string }).type}`);
    }
  }

  /**
   * Create stdio transport
   */
  private createStdioTransport(config: StdioTransportConfig): StdioClientTransport {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: {
        ...(process.env as Record<string, string>),
        ...config.env,
      },
    });
  }

  /**
   * Create HTTP transport (SSE or Streamable HTTP)
   */
  private async createHttpTransport(
    serverName: string,
    config: HttpTransportConfig
  ): Promise<SSEClientTransport | StreamableHTTPClientTransport> {
    // Get authorization headers
    const headers = await this.getAuthHeaders(serverName, config);

    // Merge with custom headers
    const allHeaders = {
      ...headers,
      ...config.headers,
    };

    // Create transport based on type
    if (config.type === 'sse') {
      return new SSEClientTransport({
        url: config.url,
        headers: allHeaders,
      });
    } else {
      return new StreamableHTTPClientTransport({
        url: config.url,
        headers: allHeaders,
      });
    }
  }

  /**
   * Get authorization headers for HTTP transport
   */
  private async getAuthHeaders(
    serverName: string,
    config: HttpTransportConfig
  ): Promise<Record<string, string>> {
    if (!config.auth) {
      return {};
    }

    switch (config.auth.type) {
      case 'bearer':
        return this.getBearerTokenHeaders(config.auth);

      case 'oauth2.1':
        return await this.getOAuth21Headers(serverName, config.url, config.auth);

      default:
        throw new Error(`Unknown auth type: ${(config.auth as { type: string }).type}`);
    }
  }

  /**
   * Get bearer token headers (simple API token)
   */
  private getBearerTokenHeaders(auth: BearerTokenAuth): Record<string, string> {
    // Resolve env:VAR_NAME references
    let token = auth.token;
    const envMatch = token.match(/^env:([A-Z_][A-Z0-9_]*)$/);
    if (envMatch && envMatch[1]) {
      const envVar = process.env[envMatch[1]];
      if (!envVar) {
        throw new Error(`Environment variable ${envMatch[1]} not found`);
      }
      token = envVar;
    }

    return {
      'Authorization': `Bearer ${token}`,
    };
  }

  /**
   * Get OAuth 2.1 headers (with token refresh)
   */
  private async getOAuth21Headers(
    serverName: string,
    serverUrl: string,
    auth: OAuth21Config
  ): Promise<Record<string, string>> {
    const oauthClient = new OAuth21Client(auth);

    // Try to load existing token
    let token = await this.tokenStorage.loadToken(serverName);

    // Check if token expired
    if (token && this.tokenStorage.isTokenExpired(token)) {
      console.error(`🔄 Token expired for ${serverName}, refreshing...`);

      if (token.refreshToken) {
        // Discover endpoints
        const endpoints = await oauthClient.discoverEndpoints(serverUrl);

        // Refresh token
        const refreshed = await oauthClient.refreshToken(
          endpoints.tokenUrl,
          auth.clientId || 'dynamic',
          token.refreshToken
        );

        token = {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresIn ? Date.now() + refreshed.expiresIn * 1000 : undefined,
        };

        await this.tokenStorage.saveToken(serverName, token);
      } else {
        // No refresh token, need to re-authorize
        token = null;
      }
    }

    // If no token, perform OAuth flow
    if (!token) {
      console.error(`🔐 No token for ${serverName}, starting OAuth flow...`);
      token = await this.performOAuthFlow(serverName, serverUrl, auth);
    }

    return {
      'Authorization': `Bearer ${token.accessToken}`,
    };
  }

  /**
   * Perform complete OAuth 2.1 flow
   */
  private async performOAuthFlow(
    serverName: string,
    serverUrl: string,
    auth: OAuth21Config
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  }> {
    const oauthClient = new OAuth21Client(auth);

    // 1. Discover endpoints (if enabled)
    const endpoints = await oauthClient.discoverEndpoints(serverUrl);

    // 2. Register client (if needed)
    let clientId = auth.clientId;
    let clientSecret = auth.clientSecret;

    if (!clientId && endpoints.registrationUrl) {
      console.error(`📝 Registering OAuth client for ${serverName}...`);
      const registration = await oauthClient.registerClient(endpoints.registrationUrl);
      clientId = registration.clientId;
      clientSecret = registration.clientSecret;
    }

    if (!clientId) {
      throw new Error('No client ID available. Configure clientId or enable dynamic registration.');
    }

    // 3. Authorize (opens browser)
    const authCode = await oauthClient.authorize(endpoints.authorizationUrl, clientId);

    // 4. Exchange code for token
    const tokenResponse = await oauthClient.exchangeCode(
      endpoints.tokenUrl,
      clientId,
      authCode
    );

    // 5. Save token
    const token = {
      accessToken: tokenResponse.accessToken,
      refreshToken: tokenResponse.refreshToken,
      expiresAt: tokenResponse.expiresIn ? Date.now() + tokenResponse.expiresIn * 1000 : undefined,
    };

    await this.tokenStorage.saveToken(serverName, token);

    console.error(`✅ OAuth flow complete for ${serverName}`);

    return token;
  }
}
```

---

### Phase 4: Update MCPClientPool (1-2 days)

**Goal:** Refactor MCPClientPool to use TransportFactory.

#### 4.1 Updated MCPClientPool

**File:** `src/mcp-client-pool.ts` (refactored)

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import * as fs from 'fs/promises';
import { getMCPConfigPath } from './config.js';
import { TransportFactory } from './transport-factory.js';
import { MCPConfigSchema } from './config-types.js';
import type { MCPConfig, ToolInfo } from './types.js';

export class MCPClientPool {
  private clients: Map<string, Client> = new Map();
  private toolCache: Map<string, ToolInfo> = new Map();
  private initialized = false;
  private transportFactory = new TransportFactory();

  async initialize(configPath?: string): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const resolvedPath = configPath ?? await getMCPConfigPath();
      const configContent = await fs.readFile(resolvedPath, 'utf-8');
      const rawConfig = JSON.parse(configContent);

      // Validate with Zod
      const config: MCPConfig = MCPConfigSchema.parse(rawConfig);

      // Filter out self
      const filteredServers = Object.entries(config.mcpServers).filter(
        ([serverName]) => serverName !== 'code-executor'
      );

      console.error(`🔌 Initializing MCP client pool (${filteredServers.length} servers)`);

      // Connect to each server
      const connections = filteredServers.map(
        ([serverName, serverConfig]) =>
          this.connectToServer(serverName, serverConfig)
      );

      const results = await Promise.allSettled(connections);

      // Handle failures
      const failures = results.filter(r => r.status === 'rejected');

      if (failures.length === filteredServers.length) {
        throw new Error('All MCP server connections failed');
      }

      if (failures.length > 0) {
        console.warn(`⚠️  ${failures.length} servers failed to connect`);
      }

      // Cache tools
      await this.cacheToolListings();

      this.initialized = true;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Connect to server using appropriate transport
   */
  private async connectToServer(
    serverName: string,
    config: MCPServerConfig
  ): Promise<void> {
    // Create client
    const client = new Client(
      {
        name: 'code-executor-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    // Create transport using factory
    const transport = await this.transportFactory.createTransport(serverName, config);

    // Connect
    await client.connect(transport);

    // Store
    this.clients.set(serverName, client);

    console.error(`  ✓ ${serverName} (${config.type})`);
  }

  // ... rest of methods unchanged
}
```

---

### Phase 5: Testing & Documentation (2-3 days)

#### 5.1 Test Cases

**File:** `tests/transport-factory.test.ts`

```typescript
describe('TransportFactory', () => {
  it('should_create_stdio_transport', async () => {
    const factory = new TransportFactory();
    const transport = await factory.createTransport('test', {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'test-server'],
    });
    expect(transport).toBeInstanceOf(StdioClientTransport);
  });

  it('should_create_sse_transport_with_bearer_token', async () => {
    const factory = new TransportFactory();
    const transport = await factory.createTransport('test', {
      type: 'sse',
      url: 'https://api.example.com/mcp',
      auth: {
        type: 'bearer',
        token: 'test-token',
      },
    });
    expect(transport).toBeInstanceOf(SSEClientTransport);
  });

  it('should_resolve_env_variables_in_bearer_token', async () => {
    process.env.TEST_TOKEN = 'secret-token';
    const factory = new TransportFactory();
    const headers = await factory['getBearerTokenHeaders']({
      type: 'bearer',
      token: 'env:TEST_TOKEN',
    });
    expect(headers['Authorization']).toBe('Bearer secret-token');
  });

  it('should_use_cached_oauth_token_if_not_expired', async () => {
    // Test token caching and refresh logic
  });
});
```

#### 5.2 Documentation

**File:** `docs/AUTHENTICATION.md`

Complete guide on:
- Configuring OAuth 2.1 servers
- Using bearer tokens
- Environment variable patterns
- Token management
- Security best practices

**File:** `docs/TRANSPORTS.md`

Complete guide on:
- stdio vs SSE vs Streamable HTTP
- When to use each transport
- Configuration examples
- Troubleshooting

**File:** `README.md` (update)

Add examples for:
- Linear MCP (OAuth)
- Custom API token servers
- Mixed transport configurations

---

## Configuration Examples

### Example 1: Linear (Official, OAuth 2.1)

```json
{
  "mcpServers": {
    "linear": {
      "type": "streamableHttp",
      "url": "https://linear.app/api/mcp",
      "auth": {
        "type": "oauth2.1",
        "scopes": ["read", "write"],
        "pkce": true,
        "useDiscovery": true
      }
    }
  }
}
```

**First run:** Opens browser for OAuth authorization
**Subsequent runs:** Uses cached token (auto-refreshes if expired)

### Example 2: Linear (Community, stdio + API token)

```json
{
  "mcpServers": {
    "linear": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-linear"],
      "env": {
        "LINEAR_API_TOKEN": "env:LINEAR_API_TOKEN"
      }
    }
  }
}
```

**Setup:**
```bash
export LINEAR_API_TOKEN="lin_api_xxx"
```

### Example 3: Custom API with Bearer Token

```json
{
  "mcpServers": {
    "my-api": {
      "type": "streamableHttp",
      "url": "https://api.mycompany.com/mcp",
      "auth": {
        "type": "bearer",
        "token": "env:MY_API_TOKEN"
      }
    }
  }
}
```

### Example 4: Mixed Environment

```json
{
  "mcpServers": {
    "zen": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-zen"]
    },
    "linear": {
      "type": "streamableHttp",
      "url": "https://linear.app/api/mcp",
      "auth": {
        "type": "oauth2.1",
        "scopes": ["read", "write"]
      }
    },
    "github": {
      "type": "sse",
      "url": "https://api.github.com/mcp",
      "auth": {
        "type": "bearer",
        "token": "env:GITHUB_TOKEN"
      }
    }
  }
}
```

---

## Security Considerations

### 1. Token Storage
- **Location:** `~/.code-executor/tokens.json`
- **Permissions:** `0600` (owner read/write only)
- **Format:** JSON with per-server tokens
- **Encryption:** Consider encrypting at rest (future enhancement)

### 2. OAuth Security
- **PKCE:** Always enabled (prevents code interception)
- **State parameter:** Prevents CSRF attacks
- **Redirect URI validation:** Only localhost:3000
- **Token refresh:** Automatic with refresh tokens
- **Token expiry:** Checked before each request

### 3. Environment Variables
- **Never log tokens** in error messages or audit logs
- **Validate env:VAR_NAME** references before use
- **Document required** environment variables

### 4. Audit Logging
**Update:** `src/security.ts`

```typescript
// Redact tokens in audit logs
function sanitizeForAudit(params: unknown): unknown {
  // Deep clone and redact Authorization headers, tokens, etc.
  // Log: "Authorization: Bearer ***REDACTED***"
}
```

---

## Backward Compatibility

### Breaking Changes: NONE ✅

**Strategy:**
1. Auto-detect legacy format (has `command`, no `type`)
2. Convert to `{ type: 'stdio', ...config }`
3. Warn users to update config (deprecation notice)

**Migration Path:**
```
v1.0.0: stdio only (current)
v1.1.0: Add SSE/HTTP support, auto-convert legacy configs
v1.2.0: Deprecation warning for legacy format
v2.0.0: Remove auto-conversion (require explicit type)
```

---

## Dependencies

### New Dependencies

```json
{
  "dependencies": {
    "open": "^10.0.0"  // Open browser for OAuth flow
  }
}
```

**Already have:**
- `@modelcontextprotocol/sdk` - Has SSE and Streamable HTTP transports
- `ws` - WebSocket (not currently used)
- `zod` - Schema validation

---

## Timeline Estimate

| Phase | Duration | Effort |
|-------|----------|--------|
| Phase 1: Config Schema | 1-2 days | Medium |
| Phase 2: OAuth Client | 3-5 days | High |
| Phase 3: Transport Factory | 2-3 days | Medium |
| Phase 4: MCPClientPool | 1-2 days | Low |
| Phase 5: Testing & Docs | 2-3 days | Medium |
| **TOTAL** | **9-15 days** | **High** |

**Complexity:** High (OAuth flows, token management, browser interaction)
**Risk:** Medium (OAuth security critical, multiple transport types)
**Value:** Very High (unlocks authenticated MCP servers like Linear)

---

## Open Questions

1. **Browser-based OAuth callback** - Use localhost HTTP server or system browser?
   - **Recommendation:** localhost:3000 HTTP server (current plan)

2. **Token encryption** - Encrypt tokens.json at rest?
   - **Recommendation:** Phase 2 (future enhancement)

3. **Multi-user support** - Different users on same machine?
   - **Recommendation:** Per-user token storage in `~/.code-executor/`

4. **OAuth prompt handling** - Auto-open browser or print URL?
   - **Recommendation:** Auto-open with fallback URL printing

5. **Token refresh UI** - Silent or notify user?
   - **Recommendation:** Silent with console message

6. **Dynamic vs Static client registration** - Prefer which?
   - **Recommendation:** Dynamic (auto-register), fallback to static

---

## Success Criteria

- ✅ Support stdio, SSE, and Streamable HTTP transports
- ✅ OAuth 2.1 with PKCE implementation
- ✅ Dynamic client registration
- ✅ Token caching and auto-refresh
- ✅ Backward compatible with v1.0.0 configs
- ✅ Linear MCP server working example
- ✅ Bearer token authentication
- ✅ 90%+ test coverage for new code
- ✅ Security audit passed
- ✅ Documentation complete

---

## Next Steps

1. **Review this plan** with stakeholders
2. **Create GitHub issues** for each phase
3. **Set up project board** for tracking
4. **Begin Phase 1** (config schema extension)
5. **Weekly progress reviews**

---

**Author:** Claude Code
**Reviewer:** TBD
**Approval:** TBD
**Implementation Start:** TBD
