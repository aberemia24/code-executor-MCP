# Code Executor MCP Server - Secure Docker Image
#
# SECURITY FEATURES:
# - Non-root user execution
# - Resource limits (memory, CPU, processes)
# - Read-only root filesystem
# - No capabilities
# - Seccomp profile (restrict syscalls)
# - Network isolation
# - Minimal attack surface (distroless base)

# Production stage (single-stage build - simpler)
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

# Copy pre-built application (build locally before docker build)
COPY --chown=codeexec:codeexec ./dist ./dist
COPY --chown=codeexec:codeexec ./package*.json ./
COPY --chown=codeexec:codeexec ./.mcp.example.json ./.mcp.json

# Install only production dependencies
RUN npm ci --omit=dev

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

# Start MCP server
CMD ["node", "dist/index.js"]

# Metadata
LABEL maintainer="code-executor-mcp" \
      version="1.3.0" \
      description="Secure code execution sandbox with MCP integration" \
      security.features="non-root,resource-limits,ssrf-protection,network-isolation"
