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
    // IPv6 private ranges
    /^fd[0-9a-f]{2}:/i,                 // IPv6 ULA (Unique Local Address) fc00::/7
    /^fc[0-9a-f]{2}:/i,                 // IPv6 ULA (Unique Local Address) fc00::/7
    /^fe80:/i,                          // IPv6 Link-local fe80::/10
    /^fec0:/i,                          // IPv6 Site-local (deprecated) fec0::/10
    /^ff[0-9a-f]{2}:/i,                 // IPv6 Multicast ff00::/8
  ],

  // Cloud metadata endpoints
  cloudMetadata: [
    /^169\.254\.169\.254$/,  // AWS/GCP/Azure/DigitalOcean metadata
    /^metadata\.google\.internal$/i,
    /^169\.254\.169\.253$/,  // OpenStack metadata
    /^fd00:ec2::254$/i,      // AWS IMDSv2 IPv6
    /^instance-data\.ec2\.internal$/i, // AWS metadata hostname
  ],

  // Link-local addresses
  linkLocal: [
    /^169\.254\.\d+\.\d+$/,  // IPv4 link-local
  ],
} as const;

/**
 * Normalize alternative IP encodings to standard dotted-decimal format
 *
 * SECURITY: Prevents SSRF bypass via decimal/octal/hex IP encodings
 *
 * @param host - IP address that may use alternative encoding
 * @returns Normalized IP address in standard dotted-decimal format
 *
 * @example
 * normalizeIPEncoding('2130706433') // '127.0.0.1' (decimal)
 * normalizeIPEncoding('0177.0.0.1') // '127.0.0.1' (octal)
 * normalizeIPEncoding('0x7f.0.0.1') // '127.0.0.1' (hex)
 * normalizeIPEncoding('0x7f000001') // '127.0.0.1' (full hex)
 * normalizeIPEncoding('127.1') // '127.0.0.1' (shorthand)
 * normalizeIPEncoding('google.com') // 'google.com' (unchanged)
 */
function normalizeIPEncoding(host: string): string {
  // Input validation
  if (!host || typeof host !== 'string') {
    return host || '';
  }

  // Decimal IP (e.g., 2130706433 = 127.0.0.1, 16777216 = 1.0.0.0)
  // 1-10 digits to handle all valid decimal IPs including short forms
  if (/^\d{1,10}$/.test(host)) {
    const num = parseInt(host, 10);
    // Validate it's in valid IP range (0 to 4294967295)
    if (num >= 0 && num <= 0xFFFFFFFF) {
      return `${(num >>> 24) & 0xFF}.${(num >>> 16) & 0xFF}.${(num >>> 8) & 0xFF}.${num & 0xFF}`;
    }
  }

  // Full hex IP (e.g., 0x7f000001 = 127.0.0.1, 0x7f = 0.0.0.127)
  // 1-8 hex digits to handle all valid hex IPs including short forms
  if (/^0x[0-9a-f]{1,8}$/i.test(host)) {
    const num = parseInt(host, 16);
    if (num >= 0 && num <= 0xFFFFFFFF) {
      return `${(num >>> 24) & 0xFF}.${(num >>> 16) & 0xFF}.${(num >>> 8) & 0xFF}.${num & 0xFF}`;
    }
  }

  // Dotted notation with octal (e.g., 0177.0.0.1 = 127.0.0.1)
  if (/^0[0-7]/.test(host) && host.includes('.')) {
    try {
      const parts = host.split('.');
      const normalized = parts.map(octet => {
        // Octal notation starts with 0
        if (octet.startsWith('0') && octet.length > 1 && /^[0-7]+$/.test(octet.substring(1))) {
          return String(parseInt(octet, 8));
        }
        return octet;
      });
      return normalized.join('.');
    } catch {
      return host;
    }
  }

  // Dotted notation with hex (e.g., 0x7f.0.0.1 = 127.0.0.1)
  if (/^0x[0-9a-f]/i.test(host) && host.includes('.')) {
    try {
      const parts = host.split('.');
      const normalized = parts.map(octet => {
        if (octet.toLowerCase().startsWith('0x')) {
          return String(parseInt(octet, 16));
        }
        return octet;
      });
      return normalized.join('.');
    } catch {
      return host;
    }
  }

  // Shorthand notation (e.g., 127.1 = 127.0.0.1)
  // Only process if it looks like an IP (starts with digit, has dot, ends with digit)
  if (/^\d+\./.test(host) && /\.\d+$/.test(host)) {
    const parts = host.split('.');
    // Shorthand IPs have 1-3 parts (e.g., "127.1", "10.1", "192.168.1")
    if (parts.length > 0 && parts.length < 4) {
      try {
        const octets: number[] = [];
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          if (part === undefined) continue;
          octets.push(parseInt(part, 10));
        }
        // Last part represents remaining bytes
        const lastPart = parts[parts.length - 1];
        if (lastPart === undefined) return host;
        const lastNum = parseInt(lastPart, 10);
        const remainingBytes = 4 - octets.length;

        if (remainingBytes === 3) {
          // e.g., "127.1" -> "127.0.0.1"
          octets.push((lastNum >>> 16) & 0xFF);
          octets.push((lastNum >>> 8) & 0xFF);
          octets.push(lastNum & 0xFF);
        } else if (remainingBytes === 2) {
          // e.g., "192.168.1" -> "192.168.0.1"
          octets.push((lastNum >>> 8) & 0xFF);
          octets.push(lastNum & 0xFF);
        } else if (remainingBytes === 1) {
          octets.push(lastNum & 0xFF);
        }

        if (octets.length === 4 && octets.every(o => o >= 0 && o <= 255)) {
          return octets.join('.');
        }
      } catch {
        return host;
      }
    }
  }

  return host;
}

/**
 * Check if a hostname or IP address is blocked for security reasons
 *
 * @param host - Hostname or IP address to check
 * @returns True if the host is blocked (unsafe), false if allowed (safe)
 *
 * @example
 * isBlockedHost('localhost') // true - blocked
 * isBlockedHost('127.0.0.1') // true - blocked
 * isBlockedHost('2130706433') // true - blocked (decimal encoding)
 * isBlockedHost('0177.0.0.1') // true - blocked (octal encoding)
 * isBlockedHost('0x7f.0.0.1') // true - blocked (hex encoding)
 * isBlockedHost('10.0.0.1') // true - blocked (private network)
 * isBlockedHost('169.254.169.254') // true - blocked (AWS metadata)
 * isBlockedHost('::1') // true - blocked (IPv6 localhost)
 * isBlockedHost('fe80::1') // true - blocked (IPv6 link-local)
 * isBlockedHost('google.com') // false - allowed
 * isBlockedHost('api.github.com') // false - allowed
 */
export function isBlockedHost(host: string): boolean {
  let hostname = host;

  // Handle IPv6 with brackets [::1] or [::1]:port
  if (host.includes('[')) {
    // Extract content between brackets
    const match = host.match(/\[([^\]]+)\]/);
    hostname = match?.[1] ?? host.replace(/[\[\]]/g, '');
  } else if (isIPv6Format(host)) {
    // IPv6 without brackets - extract address (handle ports)
    hostname = extractIPv6(host);
  } else {
    // IPv4 or hostname - remove port if present
    hostname = host.split(':')[0] ?? host;

    // SECURITY: Normalize alternative IP encodings (decimal/octal/hex)
    // This prevents SSRF bypass via encoded IPs
    hostname = normalizeIPEncoding(hostname);
  }

  // Check all blocked patterns
  for (const category of Object.values(BLOCKED_IP_PATTERNS)) {
    for (const pattern of category) {
      if (pattern.test(hostname)) {
        return true;
      }
    }
  }

  // Additional IPv6 checks
  if (isIPv6Format(hostname)) {
    return isBlockedIPv6(hostname);
  }

  return false;
}

/**
 * Check if string looks like IPv6 format
 */
function isIPv6Format(str: string): boolean {
  return str.includes(':') && (str.includes('::') || str.match(/:[0-9a-f]/i) !== null);
}

/**
 * Extract IPv6 address from string with optional port
 * e.g., "fe80::1:8080" -> "fe80::1"
 *
 * Note: Only attempts to strip ports for clearly formatted cases.
 * For ambiguous cases (like ::1 where 1 could be part of address),
 * returns the original string.
 *
 * SECURITY FIX: Use lastIndexOf + substring to preserve consecutive colons
 */
function extractIPv6(str: string): string {
  // Remove brackets
  str = str.replace(/[\[\]]/g, '');

  // Find last colon (potential port separator)
  const lastColonIdx = str.lastIndexOf(':');

  if (lastColonIdx !== -1) {
    const afterLastColon = str.substring(lastColonIdx + 1);

    // If last segment is 4-5 digits and looks like a port
    if (/^\d{4,5}$/.test(afterLastColon)) {
      const portNum = parseInt(afterLastColon, 10);
      // Port range 1000-65535 (avoid mistaking ::1 as ::1 with port 1)
      if (portNum >= 1000 && portNum <= 65535) {
        // Remove port (everything after last colon)
        // This preserves consecutive colons (e.g., ::ffff:127.0.0.1:8080 -> ::ffff:127.0.0.1)
        return str.substring(0, lastColonIdx);
      }
    }
  }

  return str;
}

/**
 * Check if IPv6 address is in a blocked range
 */
function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  // ::1 - Loopback (already covered by pattern)
  if (lower === '::1' || lower.startsWith('0000:0000:0000:0000:0000:0000:0000:0001')) {
    return true;
  }

  // ::ffff:0:0/96 - IPv4-mapped IPv6
  if (lower.startsWith('::ffff:')) {
    // Extract IPv4 part and check against ALL blocked patterns
    const ipv4Part = lower.substring(7);
    // Normalize the IPv4 part (in case it uses decimal/octal/hex encoding)
    const normalizedIPv4 = normalizeIPEncoding(ipv4Part);
    // Check if IPv4 part matches ANY blocked patterns
    return BLOCKED_IP_PATTERNS.localhost.some(p => p.test(normalizedIPv4)) ||
           BLOCKED_IP_PATTERNS.privateNetworks.some(p => p.test(normalizedIPv4)) ||
           BLOCKED_IP_PATTERNS.linkLocal.some(p => p.test(normalizedIPv4)) ||
           BLOCKED_IP_PATTERNS.cloudMetadata.some(p => p.test(normalizedIPv4));
  }

  // fe80::/10 - Link-local (already covered by pattern)
  if (lower.startsWith('fe8') || lower.startsWith('fe9') ||
      lower.startsWith('fea') || lower.startsWith('feb')) {
    return true;
  }

  // fc00::/7 and fd00::/8 - Unique local addresses (already covered by pattern)
  if (lower.startsWith('fc') || lower.startsWith('fd')) {
    return true;
  }

  // ff00::/8 - Multicast (already covered by pattern)
  if (lower.startsWith('ff')) {
    return true;
  }

  // ::/128 - Unspecified address
  if (lower === '::' || lower === '0000:0000:0000:0000:0000:0000:0000:0000') {
    return true;
  }

  // ::ffff:0:0:0/96 - IPv4-compatible IPv6 (deprecated)
  if (lower.startsWith('::ffff:0:')) {
    return true;
  }

  // 64:ff9b::/96 - IPv4/IPv6 translation (may be used for NAT64)
  // Block to prevent potential SSRF via NAT64
  if (lower.startsWith('64:ff9b:')) {
    return true;
  }

  // 2001::/32 - TEREDO tunneling
  // Block to prevent tunneling attacks
  if (lower.startsWith('2001:0:')) {
    return true;
  }

  // 2001:db8::/32 - Documentation addresses
  // Block as they should not be routable
  if (lower.startsWith('2001:db8:')) {
    return true;
  }

  // 2002::/16 - 6to4 addressing
  // Block to prevent tunneling attacks
  if (lower.startsWith('2002:')) {
    return true;
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
