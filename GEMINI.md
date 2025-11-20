# Gemini Project Context: Code Executor MCP

This document provides a comprehensive overview of the `code-executor-mcp` project for Gemini, including its purpose, architecture, and development conventions.

## 1. Project Overview

`code-executor-mcp` is a sophisticated, security-focused proxy server built with TypeScript and Node.js. It operates within the Model-driven Code Protocol (MCP) ecosystem.

Its primary purpose is to solve the "context exhaustion" problem that occurs when AI models are given access to a large number of tools. Instead of exposing dozens of tools (consuming vast amounts of tokens), this server exposes only two primary tools: `executeTypescript` and `executePython`.

The AI model can then request the execution of code, and within that secure, sandboxed environment, the code can dynamically discover and call any number of other MCP tools (like filesystem, git, web browsers, etc.). This "progressive disclosure" mechanism reduces initial token load by up to 98%, enabling complex, multi-tool workflows that would otherwise be impossible.

### Key Technologies

*   **Language:** TypeScript (strict mode)
*   **Platform:** Node.js (v22.0.0+)
*   **Module System:** ES Modules (`"type": "module"`)
*   **Sandboxing:**
    *   **TypeScript/JavaScript:** [Deno](https://deno.land/) runtime, leveraging V8 isolates for secure, permission-based execution.
    *   **Python:** [Pyodide](https://pyodide.org/), which runs Python in a WebAssembly sandbox.
*   **Testing:** [Vitest](https://vitest.dev/) for unit and integration testing.
*   **Linting:** [ESLint](https://eslint.org/) with TypeScript-specific rules.
*   **Schema Validation:** [AJV](https://ajv.js.org/) and [Zod](https://zod.dev/) for robust validation of tool inputs.

### Architecture

The core of the project is the `CodeExecutorServer` class (`src/index.ts`), which sets up an MCP server that communicates over `stdin`/`stdout`.

1.  **Server Initialization:** The server starts, loads configuration from `.mcp.json` files, and checks for dependencies like the Deno runtime.
2.  **Tool Registration:** It registers the `executeTypescript` and `executePython` tools. The Python tool includes a crucial security gate (`PYTHON_SANDBOX_READY`) to prevent use of the older, insecure implementation.
3.  **Request Handling:** When the server receives a request to execute code:
    a.  **Rate Limiting:** The request is checked against a rate limiter.
    b.  **Validation:** The input is validated against a Zod schema.
    c.  **Security Checks:** The code and its requested permissions are passed through a `SecurityValidator`, which checks for dangerous patterns, validates tool allowlists, and ensures path traversal protection.
    d.  **Connection Pooling:** The request is handed to a `ConnectionPool` to manage concurrency.
    e.  **Sandboxed Execution:** The code is executed in the appropriate sandbox (Deno or Pyodide). The sandbox environment has helper functions like `callMCPTool` and `discoverMCPTools` injected into its scope.
    f.  **Tool Orchestration:** From within the sandbox, `callMCPTool` calls are routed through the `MCPClientPool`, which manages connections to all other configured MCP servers.
    g.  **Auditing:** An audit log is written upon completion.
4.  **Graceful Shutdown:** The server listens for `SIGINT`/`SIGTERM` signals to shut down gracefully, allowing in-flight requests to complete.

## 2. Building and Running

The project uses `npm` for dependency management and scripts.

### Key Commands

*   **Install Dependencies:**
    ```bash
    npm install
    ```

*   **Build (Compile TypeScript):**
    ```bash
    npm run build
    ```
    *(Source in `src/` is compiled to `dist/`)*

*   **Run Tests:**
    ```bash

    npm test
    ```

*   **Run Tests in Watch Mode:**
    ```bash
    npm run test:watch
    ```

*   **Run Linting:**
    ```bash
    npm run lint
    ```

*   **Run Type Checking:**
    ```bash
    npm run typecheck
    ```

*   **Run the Server (for development):**
    This command builds the project first, then starts the server.
    ```bash
    npm run server
    ```

## 3. Development Conventions

*   **Code Style:** The project follows standard TypeScript best practices, enforced by ESLint and Prettier. The configuration can be found in `eslint.config.mjs`.
*   **Testing:**
    *   Tests are co-located in the `tests/` directory and use the `.test.ts` extension.
    *   The project uses `vitest`.
    *   Tests are comprehensive, covering unit, integration, and edge cases. Mocking is used extensively (`vi.fn()`) to isolate components.
    *   Test names are descriptive (e.g., `should_completeWithin500ms_when_discoverMCPToolsCalled`).
    *   Many tests are linked directly to User Stories (e.g., "US6") or bug reports in comments, providing excellent context.
*   **Commits & PRs:** While not explicitly defined in the browsed files, the high quality of the code and tests suggests a convention of well-tested, focused PRs.
*   **Error Handling:** The code makes extensive use of `try...catch` blocks and formats errors consistently using `formatErrorResponse`. It distinguishes between different error types (`VALIDATION`, `EXECUTION`).
*   **Security:** Security is a primary concern. This is evident from:
    *   The secure-by-default design (e.g., the `PYTHON_SANDBOX_READY` gate).
    *   Multiple layers of validation (Zod, AJV, custom security validator).
    *   Explicit sandboxing with Deno and Pyodide.
    *   Detailed audit logging.
    *   Graceful handling of failures.
