/**
 * Docker Environment Detection (FR-10)
 *
 * Detects if code is running inside a Docker container to use appropriate
 * networking configuration (host.docker.internal vs localhost).
 *
 * **Detection Methods:**
 * 1. Check for /.dockerenv file (created by Docker runtime)
 * 2. Check DOCKER_CONTAINER environment variable (set by user/CI)
 *
 * **WHY This Matters:**
 * - Docker containers cannot access localhost on the host machine
 * - host.docker.internal is Docker's special DNS name for host access
 * - Sampling bridge server runs on host, Deno sandbox in container needs to reach it
 *
 * @see specs/001-mcp-sampling/spec.md (FR-10)
 */

import { existsSync } from 'fs';
import { getDockerContainer } from './config.js';

/**
 * Check if running inside Docker container
 *
 * **Detection Logic:**
 * 1. Check for /.dockerenv file (most reliable, created by Docker)
 * 2. Check DOCKER_CONTAINER env var (set by user or CI pipeline)
 *
 * **Security:**
 * - existsSync() is safe (read-only check)
 * - No file system writes
 * - No command execution
 *
 * @returns true if running in Docker, false otherwise
 */
export function isDockerEnvironment(): boolean {
  // Method 1: Check for /.dockerenv file (created by Docker runtime)
  // WHY: Most reliable indicator, automatically created by Docker
  if (existsSync('/.dockerenv')) {
    return true;
  }

  // Method 2: Check DOCKER_CONTAINER environment variable
  // WHY: Allows explicit override for custom Docker setups
  // SECURITY: Use validated config getter (Constitutional Principle 4)
  const dockerEnv = getDockerContainer();
  if (dockerEnv === 'true' || dockerEnv === '1') {
    return true;
  }

  return false;
}

/**
 * Get bridge URL hostname based on environment
 *
 * **Logic:**
 * - Docker: Use host.docker.internal (special Docker DNS)
 * - Host: Use localhost (direct access)
 *
 * **WHY Not Always host.docker.internal?**
 * - host.docker.internal only exists in Docker environments
 * - Using it on host machine would cause DNS resolution failure
 *
 * @returns Hostname for bridge server (localhost or host.docker.internal)
 */
export function getBridgeHostname(): string {
  return isDockerEnvironment() ? 'host.docker.internal' : 'localhost';
}

/**
 * Get full bridge URL with port
 *
 * @param port - Bridge server port number
 * @returns Full HTTP URL (e.g., http://localhost:53241 or http://host.docker.internal:53241)
 */
export function getBridgeUrl(port: number): string {
  const hostname = getBridgeHostname();
  return `http://${hostname}:${port}`;
}
