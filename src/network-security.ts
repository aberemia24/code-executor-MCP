/**
 * Network Security Filtering
 *
 * SECURITY: Prevents SSRF (Server-Side Request Forgery) attacks by blocking
 * requests to private IP ranges, localhost, and cloud metadata endpoints.
 *
 * This module provides IP filtering for MCP tools that make network requests
 * (e.g., mcp__fetcher__fetch_url).
 */

/**
 * IP ranges and hosts that are blocked for security reasons
 */
const BLOCKED_IP_PATTERNS = {
  // Localhost variations
  localhost: [
    /^localhost$/i,
    /^127\.\d+\.\d+\.\d+$/,  // 127.0.0.0/8
    /^::1$/,                  // IPv6 localhost
    /^0\.0\.0\.0$/,
  ],

  // Private IP ranges (RFC 1918)
  privateNetworks: [
    /^10\.\d+\.\d+\.\d+$/,              // 10.0.0.0/8
    /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/,  // 172.16.0.0/12
    /^192\.168\.\d+\.\d+$/,             // 192.168.0.0/16
    /^fd[0-9a-f]{2}:/i,                 // IPv6 ULA (Unique Local Address)
    /^fe80:/i,                          // IPv6 Link-local
  ],

  // Cloud metadata endpoints
  cloudMetadata: [
    /^169\.254\.169\.254$/,  // AWS/GCP/Azure/DigitalOcean metadata
    /^metadata\.google\.internal$/i,
    /^169\.254\.169\.253$/,  // OpenStack metadata
  ],

  // Link-local addresses
  linkLocal: [
    /^169\.254\.\d+\.\d+$/,  // IPv4 link-local
  ],
} as const;

/**
 * Check if a hostname or IP address is blocked for security reasons
 *
 * @param host - Hostname or IP address to check
 * @returns True if the host is blocked (unsafe), false if allowed (safe)
 *
 * @example
 * isBlockedHost('localhost') // true - blocked
 * isBlockedHost('127.0.0.1') // true - blocked
 * isBlockedHost('10.0.0.1') // true - blocked (private network)
 * isBlockedHost('169.254.169.254') // true - blocked (AWS metadata)
 * isBlockedHost('google.com') // false - allowed
 * isBlockedHost('api.github.com') // false - allowed
 */
export function isBlockedHost(host: string): boolean {
  // Remove port if present
  const hostname = host.split(':')[0] ?? host;

  // Check all blocked patterns
  for (const category of Object.values(BLOCKED_IP_PATTERNS)) {
    for (const pattern of category) {
      if (pattern.test(hostname)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Extract hostname from URL
 *
 * @param url - URL to extract hostname from
 * @returns Hostname or null if invalid URL
 */
export function extractHostname(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return null;
  }
}

/**
 * Validate URL for SSRF prevention
 *
 * @param url - URL to validate
 * @returns Object with validation result and error message if blocked
 *
 * @example
 * validateUrl('http://localhost:3000')
 * // { allowed: false, reason: 'Blocked: localhost access not permitted' }
 *
 * validateUrl('http://169.254.169.254/latest/meta-data')
 * // { allowed: false, reason: 'Blocked: cloud metadata endpoint access not permitted' }
 *
 * validateUrl('https://api.github.com/repos')
 * // { allowed: true }
 */
export function validateUrl(url: string): {
  allowed: boolean;
  reason?: string;
} {
  const hostname = extractHostname(url);

  if (!hostname) {
    return {
      allowed: false,
      reason: 'Invalid URL format',
    };
  }

  if (isBlockedHost(hostname)) {
    // Determine which category was matched for better error message
    if (BLOCKED_IP_PATTERNS.localhost.some(p => p.test(hostname))) {
      return {
        allowed: false,
        reason: 'Blocked: localhost access not permitted (SSRF protection)',
      };
    }

    if (BLOCKED_IP_PATTERNS.cloudMetadata.some(p => p.test(hostname))) {
      return {
        allowed: false,
        reason: 'Blocked: cloud metadata endpoint access not permitted (SSRF protection)',
      };
    }

    if (BLOCKED_IP_PATTERNS.privateNetworks.some(p => p.test(hostname))) {
      return {
        allowed: false,
        reason: 'Blocked: private network access not permitted (SSRF protection)',
      };
    }

    return {
      allowed: false,
      reason: 'Blocked: host access not permitted (SSRF protection)',
    };
  }

  return { allowed: true };
}

/**
 * Validate network permissions for Deno sandbox
 *
 * Checks if any allowed network hosts are in the blocked list.
 * This is a pre-execution validation to catch configuration errors.
 *
 * @param netHosts - Array of network hosts from permissions.net
 * @returns Validation result with any blocked hosts identified
 */
export function validateNetworkPermissions(netHosts: string[]): {
  valid: boolean;
  blockedHosts: string[];
  warnings: string[];
} {
  const blockedHosts: string[] = [];
  const warnings: string[] = [];

  for (const host of netHosts) {
    // Skip 'localhost' and '127.0.0.1' as these are needed for MCP proxy
    // These are automatically added by sandbox-executor for MCP communication
    if (host === 'localhost' || host === '127.0.0.1') {
      continue;
    }

    if (isBlockedHost(host)) {
      blockedHosts.push(host);
    }
  }

  if (blockedHosts.length > 0) {
    warnings.push(
      `WARNING: Network permissions include blocked hosts: ${blockedHosts.join(', ')}. ` +
      'These hosts are blocked for SSRF protection and will not be accessible from sandbox code.'
    );
  }

  return {
    valid: blockedHosts.length === 0,
    blockedHosts,
    warnings,
  };
}
