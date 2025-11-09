# Docker Container Testing Guide

## Prerequisites

1. **Install Docker Desktop** (Windows/Mac) or Docker Engine (Linux)
   ```bash
   # Check Docker is installed
   docker --version
   docker-compose --version
   ```

2. **Ensure Docker is running**
   ```bash
   docker info
   ```

---

## Build the Container

### Option 1: Using docker-compose (RECOMMENDED)

```bash
cd /home/alexandrueremia/projects/code-executor-mcp

# Build the image
docker-compose build

# Start the container
docker-compose up -d

# Check container is running
docker-compose ps

# View logs
docker-compose logs -f code-executor
```

### Option 2: Using docker build directly

```bash
cd /home/alexandrueremia/projects/code-executor-mcp

# Build the image
docker build -t code-executor-mcp:1.3.0 .

# Run the container with security settings
docker run -d \
  --name code-executor-mcp \
  --memory=512m \
  --cpus=1.0 \
  --pids-limit=50 \
  --read-only \
  --tmpfs /tmp:mode=1777,size=100M,noexec \
  --cap-drop=ALL \
  --security-opt=no-new-privileges:true \
  --security-opt=seccomp=./seccomp-profile.json \
  -e ENABLE_AUDIT_LOG=true \
  -v $(pwd)/logs:/app/logs \
  code-executor-mcp:1.3.0

# Check container is running
docker ps

# View logs
docker logs -f code-executor-mcp
```

---

## Testing Security Features

### 1. Verify Non-Root User

```bash
# Should show uid=1001(codeexec) gid=1001(codeexec)
docker exec code-executor-mcp id
```

**Expected Output:**
```
uid=1001(codeexec) gid=1001(codeexec) groups=1001(codeexec)
```

---

### 2. Test Resource Limits

```bash
# Check memory limit
docker stats code-executor-mcp --no-stream

# Try to exceed memory limit (should be killed)
docker exec code-executor-mcp node -e "const a = []; while(true) a.push(new Array(1e6));"
```

**Expected:** Process should be killed when hitting 512MB limit

---

### 3. Test Read-Only Filesystem

```bash
# Should fail - filesystem is read-only
docker exec code-executor-mcp touch /test-file

# Should succeed - /tmp is writable
docker exec code-executor-mcp touch /tmp/test-file
```

**Expected Output:**
```
touch: cannot touch '/test-file': Read-only file system
```

---

### 4. Test SSRF Protection

Create a test configuration:

```bash
mkdir -p config
cat > config/.mcp.json << 'EOF'
{
  "mcpServers": {}
}
EOF
```

Create test code that attempts SSRF:

```typescript
// test-ssrf.ts
const response = await callMCPTool('mcp__fetcher__fetch_url', {
  url: 'http://169.254.169.254/latest/meta-data'
});
console.log(response);
```

Execute via MCP:
```bash
# This should FAIL with SSRF protection error
# Test would be done through MCP client (Claude Code, etc.)
```

**Expected:** Error about blocked cloud metadata endpoint

---

### 5. Test HTTP Proxy Authentication

Create test that tries to bypass authentication:

```bash
# Get container's proxy port (dynamically assigned)
PROXY_PORT=$(docker exec code-executor-mcp netstat -tuln | grep LISTEN | grep 127.0.0.1 | awk '{print $4}' | cut -d: -f2 | head -1)

# Try to call proxy without auth token (should fail with 401)
docker exec code-executor-mcp curl -X POST http://127.0.0.1:$PROXY_PORT \
  -H "Content-Type: application/json" \
  -d '{"toolName":"mcp__zen__thinkdeep","params":{}}' \
  -v
```

**Expected Output:**
```
< HTTP/1.1 401 Unauthorized
{"error":"Unauthorized - invalid or missing authentication token"}
```

---

### 6. Test Path Traversal Protection

Create symlink attack test:

```bash
# Create allowed directory
docker exec code-executor-mcp mkdir -p /tmp/allowed-dir

# Create symlink to sensitive file
docker exec code-executor-mcp ln -s /etc/passwd /tmp/allowed-dir/secrets

# Try to read via symlink (should be blocked)
# This would be tested via executeTypescript with permissions: { read: ['/tmp/allowed-dir/secrets'] }
```

**Expected:** Path validation should reject the symlink escape

---

### 7. Test Temp File Integrity

This is automatically tested during every code execution. To verify:

```bash
# Check audit log for integrity checks
docker exec code-executor-mcp tail -f /app/logs/audit.log
```

Look for entries with successful execution - no integrity errors should appear.

---

### 8. Test Process Limits

```bash
# Try fork bomb (should be limited to 50 processes)
docker exec code-executor-mcp sh -c 'for i in {1..100}; do sleep 100 & done'

# Check process count
docker exec code-executor-mcp ps aux | wc -l
```

**Expected:** Should not exceed 50 processes

---

### 9. Verify Seccomp Profile

```bash
# Check seccomp is loaded
docker inspect code-executor-mcp | grep -A 5 "SeccompProfile"

# Try blocked syscall (e.g., mount)
docker exec code-executor-mcp mount
```

**Expected Output:**
```
Operation not permitted (or similar seccomp block message)
```

---

### 10. Test Network Isolation

```bash
# Check network configuration
docker inspect code-executor-mcp | grep -A 10 "Networks"

# Try to access host network (should be isolated)
docker exec code-executor-mcp curl http://host.docker.internal:3000
```

**Expected:** Should only be able to reach allowed networks

---

## Health Check

```bash
# Check container health
docker inspect code-executor-mcp | grep -A 10 "Health"

# Manual health check
docker exec code-executor-mcp node -e "process.exit(0)"
```

---

## Cleanup

```bash
# Using docker-compose
docker-compose down

# Or manually
docker stop code-executor-mcp
docker rm code-executor-mcp

# Remove image
docker rmi code-executor-mcp:1.3.0

# Clean up volumes
docker volume prune
```

---

## Troubleshooting

### Container won't start

```bash
# Check logs
docker logs code-executor-mcp

# Check events
docker events --filter container=code-executor-mcp

# Inspect container
docker inspect code-executor-mcp
```

### Build fails

```bash
# Clean build cache
docker builder prune

# Rebuild without cache
docker-compose build --no-cache
```

### Permission issues

```bash
# Check file ownership
docker exec code-executor-mcp ls -la /app

# Check user
docker exec code-executor-mcp whoami
```

---

## Production Deployment Checklist

- [ ] Docker image built successfully
- [ ] Container runs as non-root user (uid 1001)
- [ ] Resource limits verified (512MB RAM, 1 CPU, 50 PIDs)
- [ ] Read-only filesystem working (only /tmp writable)
- [ ] Seccomp profile loaded
- [ ] Network isolation confirmed
- [ ] SSRF protection tested
- [ ] HTTP proxy authentication working
- [ ] Path traversal protection verified
- [ ] Audit logging enabled and accessible
- [ ] Health checks passing

---

**Once all tests pass, the container is ready for production deployment!**
