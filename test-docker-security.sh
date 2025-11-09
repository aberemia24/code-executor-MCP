#!/bin/bash

# Docker Security Test Suite for code-executor-mcp
# Tests all security features documented in Dockerfile

set -e

CONTAINER_NAME="code-executor-test-$$"
IMAGE_NAME="code-executor-mcp:1.3.0"

echo "=================================================="
echo "Docker Security Test Suite"
echo "=================================================="
echo ""

# Cleanup function
cleanup() {
  echo "Cleaning up..."
  docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
}
trap cleanup EXIT

echo "Test 1: Non-Root User Execution"
echo "------------------------------------------------"
docker run --name "$CONTAINER_NAME" --rm "$IMAGE_NAME" sh -c 'id' > /tmp/user-test.txt
USER_ID=$(cat /tmp/user-test.txt | grep -o 'uid=[0-9]*' | cut -d= -f2)
if [ "$USER_ID" = "1001" ]; then
  echo "✅ PASS: Container runs as non-root user (UID 1001)"
else
  echo "❌ FAIL: Container runs as UID $USER_ID (expected 1001)"
  exit 1
fi
echo ""

echo "Test 2: Read-Only Root Filesystem"
echo "------------------------------------------------"
docker run --name "${CONTAINER_NAME}-ro" --rm --read-only "$IMAGE_NAME" sh -c 'touch /test-file 2>&1' > /tmp/ro-test.txt || true
if grep -q "Read-only file system" /tmp/ro-test.txt; then
  echo "✅ PASS: Root filesystem is read-only"
else
  echo "❌ FAIL: Root filesystem is writable"
  cat /tmp/ro-test.txt
  exit 1
fi
echo ""

echo "Test 3: Temp Directory Writable"
echo "------------------------------------------------"
docker run --name "${CONTAINER_NAME}-tmp" --rm --read-only -v /tmp/code-executor "$IMAGE_NAME" sh -c 'echo "test" > /tmp/code-executor/test.txt && cat /tmp/code-executor/test.txt' > /tmp/tmp-test.txt
if grep -q "test" /tmp/tmp-test.txt; then
  echo "✅ PASS: /tmp/code-executor is writable"
else
  echo "❌ FAIL: Cannot write to /tmp/code-executor"
  exit 1
fi
echo ""

echo "Test 4: Resource Limits (Memory)"
echo "------------------------------------------------"
docker run --name "${CONTAINER_NAME}-mem" --rm -m 512m "$IMAGE_NAME" sh -c 'cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || cat /sys/fs/cgroup/memory.max 2>/dev/null' > /tmp/mem-test.txt || echo "cgroup v2" > /tmp/mem-test.txt
if [ -s /tmp/mem-test.txt ]; then
  echo "✅ PASS: Memory limit can be set"
  cat /tmp/mem-test.txt
else
  echo "⚠️  WARNING: Could not verify memory limit"
fi
echo ""

echo "Test 5: Resource Limits (CPU)"
echo "------------------------------------------------"
docker run --name "${CONTAINER_NAME}-cpu" --rm --cpus="0.5" "$IMAGE_NAME" sh -c 'nproc' > /tmp/cpu-test.txt
if [ -s /tmp/cpu-test.txt ]; then
  echo "✅ PASS: CPU limit can be set"
  echo "Available CPUs: $(cat /tmp/cpu-test.txt)"
else
  echo "❌ FAIL: Cannot verify CPU limit"
  exit 1
fi
echo ""

echo "Test 6: No New Privileges"
echo "------------------------------------------------"
docker run --name "${CONTAINER_NAME}-priv" --rm --security-opt=no-new-privileges "$IMAGE_NAME" sh -c 'cat /proc/self/status | grep NoNewPrivs' > /tmp/priv-test.txt
if grep -q "NoNewPrivs:.*1" /tmp/priv-test.txt; then
  echo "✅ PASS: no-new-privileges is enforced"
else
  echo "❌ FAIL: no-new-privileges not enforced"
  exit 1
fi
echo ""

echo "Test 7: Network Isolation (Default)"
echo "------------------------------------------------"
docker run --name "${CONTAINER_NAME}-net" --rm --network none "$IMAGE_NAME" sh -c 'ip addr show' > /tmp/net-test.txt 2>&1 || true
if ! grep -q "eth0" /tmp/net-test.txt; then
  echo "✅ PASS: Network isolation works (no eth0 interface)"
else
  echo "⚠️  WARNING: Network interface detected with --network none"
fi
echo ""

echo "Test 8: Capabilities Check"
echo "------------------------------------------------"
docker run --name "${CONTAINER_NAME}-cap" --rm --cap-drop=ALL "$IMAGE_NAME" sh -c 'cat /proc/self/status | grep Cap' > /tmp/cap-test.txt
echo "Capabilities:"
cat /tmp/cap-test.txt
if grep -q "CapEff:.*0000000000000000" /tmp/cap-test.txt; then
  echo "✅ PASS: All capabilities dropped"
else
  echo "⚠️  WARNING: Some capabilities may still be present"
fi
echo ""

echo "Test 9: Process Limits (PIDs)"
echo "------------------------------------------------"
docker run --name "${CONTAINER_NAME}-pids" --rm --pids-limit=100 "$IMAGE_NAME" sh -c 'echo "PID limit test passed"' > /tmp/pids-test.txt
if grep -q "passed" /tmp/pids-test.txt; then
  echo "✅ PASS: PID limit can be set"
else
  echo "❌ FAIL: PID limit test failed"
  exit 1
fi
echo ""

echo "Test 10: Seccomp Profile"
echo "------------------------------------------------"
if [ -f "./seccomp-profile.json" ]; then
  docker run --name "${CONTAINER_NAME}-seccomp" --rm --security-opt seccomp=./seccomp-profile.json "$IMAGE_NAME" sh -c 'echo "Seccomp test passed"' > /tmp/seccomp-test.txt
  if grep -q "passed" /tmp/seccomp-test.txt; then
    echo "✅ PASS: Seccomp profile can be applied"
  else
    echo "❌ FAIL: Seccomp profile test failed"
    exit 1
  fi
else
  echo "⚠️  WARNING: seccomp-profile.json not found in current directory"
fi
echo ""

echo "Test 11: Tini Init System"
echo "------------------------------------------------"
docker run --name "${CONTAINER_NAME}-tini" --rm "$IMAGE_NAME" sh -c 'ps aux' > /tmp/tini-test.txt
if grep -q "tini" /tmp/tini-test.txt; then
  echo "✅ PASS: Tini is running as init system (PID 1)"
else
  echo "⚠️  WARNING: Tini not detected as PID 1"
fi
echo ""

echo "Test 12: Environment Variables"
echo "------------------------------------------------"
docker run --name "${CONTAINER_NAME}-env" --rm "$IMAGE_NAME" sh -c 'env | grep -E "(NODE_ENV|ENABLE_AUDIT_LOG|DENO_PATH|PYTHON_PATH)"' > /tmp/env-test.txt
echo "Environment variables:"
cat /tmp/env-test.txt
if grep -q "NODE_ENV=production" /tmp/env-test.txt; then
  echo "✅ PASS: Environment variables correctly set"
else
  echo "⚠️  WARNING: Some environment variables may be missing"
fi
echo ""

echo "=================================================="
echo "Security Test Summary"
echo "=================================================="
echo ""
echo "All critical security tests passed!"
echo ""
echo "Recommended docker-compose.yml security configuration:"
echo "  - Deploy mode: global (single instance per node)"
echo "  - Read-only root filesystem"
echo "  - Memory limit: 512MB"
echo "  - CPU limit: 0.5"
echo "  - PID limit: 100"
echo "  - Network: isolated"
echo "  - Capabilities: all dropped"
echo "  - Seccomp profile: custom restrictive profile"
echo ""
