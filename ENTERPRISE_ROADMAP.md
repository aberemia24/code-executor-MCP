# Code Executor MCP: Enterprise Roadmap & Commercial Strategy

This document outlines the strategy for evolving `code-executor-mcp` from a local developer tool into a commercially viable enterprise platform using the **"Open Core" model**.

---

## 1. The Split: Public vs. Private

We follow the **"Engine vs. Dashboard"** rule. The Engine (execution) is free; the Dashboard (control, observability, scale) is paid.

| Feature | Repository | Why? |
| :--- | :--- | :--- |
| **Tamper-Evident Logs** | **Public (Core)** | **Trust.** Auditors must be able to verify the hashing algorithm publicly. Drives adoption of the core tool. |
| **Private Registries** | **Public (Core)** | **Usability.** Essential for any developer behind a corporate firewall. Without this, the tool is unusable in enterprise environments. |
| **SIEM Integration** | **Private (Enterprise)** 💰 | **Compliance.** Enterprises *must* stream logs to Splunk/Datadog to deploy. This is the primary "Pay Gate." |
| **Distributed Rate Limiting** | **Private (Enterprise)** 💰 | **Scale.** Required for high-availability clusters (Kubernetes) sharing state via Redis. |
| **OPA Policy Engine** | **Private (Enterprise)** 💰 | **Governance.** Complex, logic-based rules (e.g., "Finance team can't use Python") are purely an enterprise concern. |
| **SSO / Gateway** | **Private (Enterprise)** 💰 | **Control.** A separate "Manager" product (Phase 3) for identity and approval workflows. |

---

## 2. Technical Architecture: The Plugin System

We will use a **Plugin Architecture** with **Dynamic Loading**. This avoids maintaining two separate codebases for the main server.

### Step A: Define Interfaces (Public Repo)
Refactor concrete classes into interfaces to allow runtime swapping.

```typescript
// src/core/interfaces.ts
export interface IAuditLogger {
  log(entry: any): Promise<void>;
}

export interface IRateLimiter {
  checkLimit(clientId: string): Promise<boolean>;
}
```

### Step B: Implement Defaults (Public Repo)
*   `FileAuditLogger` (JSONL)
*   `MemoryRateLimiter` (In-Memory Map)

### Step C: Enterprise Package (Private Repo)
A scoped NPM package `@code-executor/enterprise` containing:
*   `SplunkAuditLogger` (HTTP to Splunk HEC)
*   `RedisRateLimiter` (Redis-backed)

### Step D: Dynamic Loader (Public Repo)
The public server attempts to load the enterprise plugin at startup.

```typescript
// src/factory.ts
export async function createServices() {
  try {
    // Dynamic import - only succeeds if customer installed the private package
    const Enterprise = await import('@code-executor/enterprise');
    console.log('✨ Enterprise Edition Loaded');
    return {
      logger: new Enterprise.SplunkAuditLogger(process.env.SPLUNK_URL),
      limiter: new Enterprise.RedisRateLimiter(process.env.REDIS_URL)
    };
  } catch (e) {
    console.log('🚀 Open Core Edition Loaded');
    return {
      logger: new FileAuditLogger(),
      limiter: new MemoryRateLimiter()
    };
  }
}
```

---

## 3. Execution Roadmap

### Phase 1: The Hardened Runner (Public Repo)
*Focus: Making the core tool secure enough for banking/healthcare usage.*

1.  **Tamper-Evident Logging:** Implement Log Chaining (SHA-256 hash of Entry N included in Entry N+1).
2.  **Enterprise Dependency Management:** Support `deno.json` and `pip.conf` configuration for private Artifactory/Nexus registries.
3.  **Advanced PII Redaction:** Integrate robust regex/library-based redaction for sensitive data.

### Phase 2: The Cluster (Private Repo - Enterprise)
*Focus: Monetization features for Scale and Compliance.*

1.  **SIEM Drivers:** Implement `SplunkAuditLogger` and `DatadogAuditLogger`.
2.  **Redis Backend:** Implement `RedisRateLimiter` for clustering.
3.  **Create Private Package:** Set up `@code-executor/enterprise` repository and build pipeline.

### Phase 3: The Gateway (New Product)
*Focus: Centralized Management (Long-term).*

*   Build a separate "Control Plane" server for SSO (Okta/SAML), Billing, and Approval Workflows.

---

## 4. Delivery Model

*   **Public User:** Runs `npx code-executor-mcp`. Gets local files and memory limits.
*   **Enterprise Customer:** Gets a `.npmrc` token to install `@code-executor/enterprise` and builds a custom Docker image:
    ```dockerfile
    FROM aberemia24/code-executor-mcp:latest
    RUN npm install @code-executor/enterprise
    ENV SPLUNK_URL="..."
    ```