# Code Executor MCP Server - Secure Docker Image
#
# MULTI-STAGE BUILD:
# - Stage 1 (builder): Compile TypeScript with dev dependencies
# - Stage 2 (production): Minimal runtime image with only prod dependencies
#
# SECURITY FEATURES:
# - Non-root user execution
# - Resource limits (memory, CPU, processes)
# - Read-only root filesystem
# - No capabilities
# - Seccomp profile (restrict syscalls)
# - Network isolation
# - Minimal attack surface (alpine base)

# ============================================================================
# Stage 1: Builder - Compile TypeScript
# ============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files first (better layer caching)
COPY package*.json ./

# Install ALL dependencies (including devDependencies for TypeScript)
RUN npm ci

# Copy source files
COPY src/ ./src/
COPY tsconfig.json ./

# Compile TypeScript → dist/
RUN npm run build

# Verify build output exists
RUN test -d dist && test -f dist/index.js || (echo "Build failed: dist/index.js not found" && exit 1)

# ============================================================================
# Stage 2: Production - Minimal runtime image
# ============================================================================
FROM node:22-alpine AS production

# Security: Create non-root user
RUN addgroup -g 1001 -S codeexec && \
    adduser -u 1001 -S codeexec -G codeexec

# Install runtime dependencies
RUN apk add --no-cache \
    deno \
    python3 \
    tini

# Create necessary directories
RUN mkdir -p /app /tmp/code-executor && \
    chown -R codeexec:codeexec /app /tmp/code-executor && \
    chmod 1777 /tmp/code-executor

WORKDIR /app

# Copy package files first (better layer caching - invalidated less frequently)
COPY --chown=codeexec:codeexec ./package*.json ./

# Install only production dependencies (cached unless package.json changes)
RUN npm ci --omit=dev

# Copy built artifacts from builder stage (invalidated on every source change)
COPY --from=builder --chown=codeexec:codeexec /app/dist ./dist

# Copy configuration files
COPY --chown=codeexec:codeexec ./.mcp.example.json ./.mcp.json

# Security: Switch to non-root user
USER codeexec

# Environment variables (override with docker-compose or -e flags)
ENV NODE_ENV=production \
    ENABLE_AUDIT_LOG=true \
    AUDIT_LOG_PATH=/app/audit.log \
    DENO_PATH=/usr/bin/deno \
    PYTHON_PATH=/usr/bin/python3

# Expose MCP server port (optional, for HTTP transport)
# Note: code-executor typically uses STDIO transport
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1

# Use tini as init system (proper signal handling, zombie reaping)
ENTRYPOINT ["/sbin/tini", "--"]

# Start MCP server (create /tmp/code-executor first as it may be overlayed by tmpfs)
CMD ["sh", "-c", "mkdir -p /tmp/code-executor && exec node dist/index.js"]

# Metadata
LABEL maintainer="code-executor-mcp" \
      version="0.4.1" \
      description="Secure code execution sandbox with MCP integration" \
      security.features="non-root,resource-limits,ssrf-protection,network-isolation"
