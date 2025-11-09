#!/bin/bash
#
# Security Verification Test Suite for code-executor-mcp
#
# Tests:
# 1. Resource limits (memory, CPU, PIDs)
# 2. Network isolation
# 3. Non-root user execution
# 4. Read-only filesystem
# 5. Seccomp profile validation
#

# Don't exit on errors - continue testing
# set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

# Container name
CONTAINER_NAME="${1:-code-executor-test}"

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓ PASS]${NC} $1"
    ((TESTS_PASSED++))
    ((TESTS_TOTAL++))
}

log_fail() {
    echo -e "${RED}[✗ FAIL]${NC} $1"
    ((TESTS_FAILED++))
    ((TESTS_TOTAL++))
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_section() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

# Check if container exists
check_container_exists() {
    if ! docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo -e "${RED}Error: Container '${CONTAINER_NAME}' not found${NC}"
        echo "Usage: $0 [container_name]"
        exit 1
    fi
}

# Check if container is running
check_container_running() {
    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_warn "Container '${CONTAINER_NAME}' is not running. Starting it..."
        docker start "${CONTAINER_NAME}" 2>/dev/null || true
        sleep 2
    fi
}

#
# Test 1: Resource Limits
#
test_resource_limits() {
    log_section "TEST 1: Resource Limits (Memory, CPU, PIDs)"

    # Get container inspect data
    INSPECT_DATA=$(docker inspect "${CONTAINER_NAME}")

    # Test 1.1: Memory limit
    log_info "Testing memory limit..."
    MEMORY_LIMIT=$(echo "${INSPECT_DATA}" | jq -r '.[0].HostConfig.Memory')
    if [ "${MEMORY_LIMIT}" != "0" ] && [ "${MEMORY_LIMIT}" != "null" ]; then
        MEMORY_MB=$((MEMORY_LIMIT / 1024 / 1024))
        log_success "Memory limit is set: ${MEMORY_MB}MB"
    else
        log_warn "Memory limit not set (unbounded)"
    fi

    # Test 1.2: CPU limit
    log_info "Testing CPU limit..."
    CPU_QUOTA=$(echo "${INSPECT_DATA}" | jq -r '.[0].HostConfig.CpuQuota')
    CPU_PERIOD=$(echo "${INSPECT_DATA}" | jq -r '.[0].HostConfig.CpuPeriod')
    if [ "${CPU_QUOTA}" != "0" ] && [ "${CPU_QUOTA}" != "null" ]; then
        CPU_CORES=$(echo "scale=2; ${CPU_QUOTA} / ${CPU_PERIOD}" | bc)
        log_success "CPU limit is set: ${CPU_CORES} cores"
    else
        log_warn "CPU limit not set (unbounded)"
    fi

    # Test 1.3: PID limit
    log_info "Testing PID limit..."
    PID_LIMIT=$(echo "${INSPECT_DATA}" | jq -r '.[0].HostConfig.PidsLimit')
    if [ "${PID_LIMIT}" != "0" ] && [ "${PID_LIMIT}" != "null" ] && [ "${PID_LIMIT}" != "-1" ]; then
        log_success "PID limit is set: ${PID_LIMIT} processes"
    else
        log_warn "PID limit not set (unbounded)"
    fi

    # Test 1.4: Actual process count
    log_info "Testing actual process count..."
    PROCESS_COUNT=$(docker exec "${CONTAINER_NAME}" ps aux 2>/dev/null | wc -l)
    if [ $? -eq 0 ]; then
        log_success "Current process count: $((PROCESS_COUNT - 1)) processes"
    else
        log_fail "Could not get process count"
    fi

    # Test 1.5: Fork bomb protection
    log_info "Testing fork bomb protection..."
    FORK_TEST=$(docker exec "${CONTAINER_NAME}" sh -c '
        ulimit -u 2>/dev/null || echo "unlimited"
    ' 2>/dev/null)
    if [ "${FORK_TEST}" != "unlimited" ] && [ -n "${FORK_TEST}" ]; then
        log_success "User process limit (ulimit -u): ${FORK_TEST}"
    else
        log_warn "No user process limit set"
    fi
}

#
# Test 2: Network Isolation
#
test_network_isolation() {
    log_section "TEST 2: Network Isolation"

    # Test 2.1: External network access
    log_info "Testing external network access (should fail for isolated container)..."
    if docker exec "${CONTAINER_NAME}" sh -c 'ping -c 1 -W 2 8.8.8.8 2>/dev/null' >/dev/null 2>&1; then
        log_warn "External network access is ALLOWED (can reach 8.8.8.8)"
    else
        log_success "External network access is BLOCKED (cannot reach 8.8.8.8)"
    fi

    # Test 2.2: DNS resolution
    log_info "Testing DNS resolution..."
    if docker exec "${CONTAINER_NAME}" sh -c 'nslookup google.com 2>/dev/null' >/dev/null 2>&1; then
        log_warn "DNS resolution works (network not fully isolated)"
    else
        log_success "DNS resolution blocked (network isolated)"
    fi

    # Test 2.3: Localhost access
    log_info "Testing localhost access..."
    if docker exec "${CONTAINER_NAME}" sh -c 'curl -s -m 2 http://localhost:3000 2>/dev/null' >/dev/null 2>&1; then
        log_success "Localhost access works (expected for MCP proxy)"
    else
        log_success "Localhost access blocked or no service on port 3000"
    fi

    # Test 2.4: Network mode
    log_info "Testing network mode..."
    NETWORK_MODE=$(docker inspect "${CONTAINER_NAME}" | jq -r '.[0].HostConfig.NetworkMode')
    if [ "${NETWORK_MODE}" == "none" ]; then
        log_success "Network mode: none (fully isolated)"
    elif [ "${NETWORK_MODE}" == "bridge" ]; then
        log_warn "Network mode: bridge (limited isolation)"
    else
        log_info "Network mode: ${NETWORK_MODE}"
    fi
}

#
# Test 3: Non-root User Execution
#
test_nonroot_user() {
    log_section "TEST 3: Non-root User Execution"

    # Test 3.1: User ID
    log_info "Testing current user ID..."
    USER_ID=$(docker exec "${CONTAINER_NAME}" id -u)
    if [ "${USER_ID}" != "0" ]; then
        log_success "Running as non-root user (UID: ${USER_ID})"
    else
        log_fail "Running as root user (UID: 0) - SECURITY RISK!"
    fi

    # Test 3.2: User name
    log_info "Testing current username..."
    USERNAME=$(docker exec "${CONTAINER_NAME}" whoami)
    if [ "${USERNAME}" != "root" ]; then
        log_success "Running as user: ${USERNAME}"
    else
        log_fail "Running as root - SECURITY RISK!"
    fi

    # Test 3.3: Group ID
    log_info "Testing current group ID..."
    GROUP_ID=$(docker exec "${CONTAINER_NAME}" id -g)
    if [ "${GROUP_ID}" != "0" ]; then
        log_success "Running as non-root group (GID: ${GROUP_ID})"
    else
        log_fail "Running as root group (GID: 0) - SECURITY RISK!"
    fi

    # Test 3.4: Sudo access
    log_info "Testing sudo access..."
    if docker exec "${CONTAINER_NAME}" sh -c 'sudo -n true 2>/dev/null' >/dev/null 2>&1; then
        log_fail "User has sudo access - SECURITY RISK!"
    else
        log_success "No sudo access (expected)"
    fi

    # Test 3.5: Root escalation attempt
    log_info "Testing privilege escalation protection..."
    if docker exec "${CONTAINER_NAME}" sh -c 'su - 2>/dev/null' >/dev/null 2>&1; then
        log_fail "User can switch to root - SECURITY RISK!"
    else
        log_success "Cannot escalate to root (expected)"
    fi
}

#
# Test 4: Read-only Filesystem
#
test_readonly_filesystem() {
    log_section "TEST 4: Read-only Filesystem"

    # Test 4.1: Root filesystem
    log_info "Testing read-only root filesystem..."
    READONLY_ROOTFS=$(docker inspect "${CONTAINER_NAME}" | jq -r '.[0].HostConfig.ReadonlyRootfs')
    if [ "${READONLY_ROOTFS}" == "true" ]; then
        log_success "Root filesystem is read-only"
    else
        log_warn "Root filesystem is NOT read-only"
    fi

    # Test 4.2: Write to root
    log_info "Testing write to / (should fail)..."
    if docker exec "${CONTAINER_NAME}" sh -c 'touch /test.txt 2>/dev/null' >/dev/null 2>&1; then
        log_fail "Can write to / - SECURITY RISK!"
    else
        log_success "Cannot write to / (expected)"
    fi

    # Test 4.3: Write to /tmp
    log_info "Testing write to /tmp (should succeed)..."
    if docker exec "${CONTAINER_NAME}" sh -c 'touch /tmp/test.txt 2>/dev/null' >/dev/null 2>&1; then
        log_success "Can write to /tmp (expected)"
        docker exec "${CONTAINER_NAME}" rm /tmp/test.txt 2>/dev/null || true
    else
        log_fail "Cannot write to /tmp - may cause execution failures!"
    fi

    # Test 4.4: Write to /tmp/code-executor
    log_info "Testing write to /tmp/code-executor (should succeed)..."
    if docker exec "${CONTAINER_NAME}" sh -c 'touch /tmp/code-executor/test.txt 2>/dev/null' >/dev/null 2>&1; then
        log_success "Can write to /tmp/code-executor (expected)"
        docker exec "${CONTAINER_NAME}" rm /tmp/code-executor/test.txt 2>/dev/null || true
    else
        log_warn "Cannot write to /tmp/code-executor - may cause execution failures!"
    fi

    # Test 4.5: Write to /app
    log_info "Testing write to /app (should fail)..."
    if docker exec "${CONTAINER_NAME}" sh -c 'touch /app/test.txt 2>/dev/null' >/dev/null 2>&1; then
        log_fail "Can write to /app - SECURITY RISK!"
        docker exec "${CONTAINER_NAME}" rm /app/test.txt 2>/dev/null || true
    else
        log_success "Cannot write to /app (expected)"
    fi

    # Test 4.6: Tmpfs mounts
    log_info "Testing tmpfs mounts..."
    TMPFS_COUNT=$(docker inspect "${CONTAINER_NAME}" | jq -r '.[0].HostConfig.Tmpfs | length')
    if [ "${TMPFS_COUNT}" != "null" ] && [ "${TMPFS_COUNT}" -gt 0 ]; then
        log_success "Tmpfs mounts configured: ${TMPFS_COUNT}"
    else
        log_warn "No tmpfs mounts configured"
    fi
}

#
# Test 5: Seccomp Profile Validation
#
test_seccomp_profile() {
    log_section "TEST 5: Seccomp Profile Validation"

    # Test 5.1: Seccomp mode
    log_info "Testing seccomp profile..."
    SECCOMP_PROFILE=$(docker inspect "${CONTAINER_NAME}" | jq -r '.[0].HostConfig.SecurityOpt[]? | select(startswith("seccomp="))')
    if [ -n "${SECCOMP_PROFILE}" ]; then
        log_success "Seccomp profile is configured: ${SECCOMP_PROFILE}"
    else
        SECCOMP_DEFAULT=$(docker inspect "${CONTAINER_NAME}" | jq -r '.[0].HostConfig.SecurityOpt[]? | select(. == "seccomp=unconfined")')
        if [ -n "${SECCOMP_DEFAULT}" ]; then
            log_fail "Seccomp is DISABLED (unconfined) - SECURITY RISK!"
        else
            log_warn "Using default seccomp profile (not custom)"
        fi
    fi

    # Test 5.2: AppArmor profile
    log_info "Testing AppArmor profile..."
    APPARMOR_PROFILE=$(docker inspect "${CONTAINER_NAME}" | jq -r '.[0].HostConfig.SecurityOpt[]? | select(startswith("apparmor="))')
    if [ -n "${APPARMOR_PROFILE}" ]; then
        log_success "AppArmor profile is configured: ${APPARMOR_PROFILE}"
    else
        log_warn "No custom AppArmor profile configured"
    fi

    # Test 5.3: No new privileges
    log_info "Testing no-new-privileges flag..."
    NO_NEW_PRIVS=$(docker inspect "${CONTAINER_NAME}" | jq -r '.[0].HostConfig.SecurityOpt[]? | select(. == "no-new-privileges:true")')
    if [ -n "${NO_NEW_PRIVS}" ]; then
        log_success "no-new-privileges is enabled"
    else
        log_fail "no-new-privileges is NOT enabled - SECURITY RISK!"
    fi

    # Test 5.4: Capabilities
    log_info "Testing dropped capabilities..."
    CAP_DROP=$(docker inspect "${CONTAINER_NAME}" | jq -r '.[0].HostConfig.CapDrop[]?' | head -5)
    if [ -n "${CAP_DROP}" ]; then
        log_success "Capabilities dropped:"
        echo "${CAP_DROP}" | while read cap; do
            echo "    - ${cap}"
        done
    else
        log_warn "No capabilities dropped"
    fi

    # Test 5.5: Capabilities added
    log_info "Testing added capabilities..."
    CAP_ADD=$(docker inspect "${CONTAINER_NAME}" | jq -r '.[0].HostConfig.CapAdd[]?' | head -5)
    if [ -z "${CAP_ADD}" ] || [ "${CAP_ADD}" == "null" ]; then
        log_success "No capabilities added (good)"
    else
        log_warn "Capabilities added:"
        echo "${CAP_ADD}" | while read cap; do
            echo "    - ${cap}"
        done
    fi

    # Test 5.6: Privileged mode
    log_info "Testing privileged mode..."
    PRIVILEGED=$(docker inspect "${CONTAINER_NAME}" | jq -r '.[0].HostConfig.Privileged')
    if [ "${PRIVILEGED}" == "false" ]; then
        log_success "Privileged mode is DISABLED"
    else
        log_fail "Privileged mode is ENABLED - CRITICAL SECURITY RISK!"
    fi
}

#
# Additional Security Tests
#
test_additional_security() {
    log_section "ADDITIONAL SECURITY CHECKS"

    # Test: Container image
    log_info "Checking container image..."
    IMAGE_NAME=$(docker inspect "${CONTAINER_NAME}" | jq -r '.[0].Config.Image')
    log_info "Image: ${IMAGE_NAME}"

    # Test: Deno availability
    log_info "Testing Deno availability..."
    if docker exec "${CONTAINER_NAME}" sh -c 'deno --version 2>/dev/null' >/dev/null 2>&1; then
        DENO_VERSION=$(docker exec "${CONTAINER_NAME}" deno --version | head -1)
        log_success "Deno available: ${DENO_VERSION}"
    else
        log_fail "Deno not available - execution will fail!"
    fi

    # Test: Python availability
    log_info "Testing Python availability..."
    if docker exec "${CONTAINER_NAME}" sh -c 'python3 --version 2>/dev/null' >/dev/null 2>&1; then
        PYTHON_VERSION=$(docker exec "${CONTAINER_NAME}" python3 --version)
        log_success "Python available: ${PYTHON_VERSION}"
    else
        log_warn "Python not available (optional)"
    fi

    # Test: Environment variables
    log_info "Testing environment variable isolation..."
    ENV_COUNT=$(docker exec "${CONTAINER_NAME}" env | wc -l)
    log_info "Environment variables exposed: ${ENV_COUNT}"

    # Check for sensitive env vars
    SENSITIVE_FOUND=0
    for var in AWS_ACCESS_KEY AWS_SECRET_KEY DATABASE_URL REDIS_URL API_KEY TOKEN SECRET PASSWORD; do
        if docker exec "${CONTAINER_NAME}" sh -c "env | grep -i ${var} 2>/dev/null" >/dev/null 2>&1; then
            log_warn "Potentially sensitive env var found: ${var}"
            ((SENSITIVE_FOUND++))
        fi
    done

    if [ ${SENSITIVE_FOUND} -eq 0 ]; then
        log_success "No obvious sensitive environment variables exposed"
    fi
}

#
# Main execution
#
main() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║  Code Executor MCP - Security Verification Test Suite     ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"

    log_info "Testing container: ${CONTAINER_NAME}"

    # Pre-flight checks
    check_container_exists
    check_container_running

    # Run test suites
    test_resource_limits
    test_network_isolation
    test_nonroot_user
    test_readonly_filesystem
    test_seccomp_profile
    test_additional_security

    # Summary
    log_section "TEST SUMMARY"
    echo -e "Total tests: ${TESTS_TOTAL}"
    echo -e "${GREEN}Passed: ${TESTS_PASSED}${NC}"
    echo -e "${RED}Failed: ${TESTS_FAILED}${NC}"
    echo ""

    if [ ${TESTS_FAILED} -eq 0 ]; then
        echo -e "${GREEN}✓ All security tests passed!${NC}"
        exit 0
    else
        echo -e "${RED}✗ Some security tests failed. Review the output above.${NC}"
        exit 1
    fi
}

# Check for required tools
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: docker is not installed${NC}"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq is not installed${NC}"
    echo "Install with: sudo apt-get install jq"
    exit 1
fi

# Run main
main
