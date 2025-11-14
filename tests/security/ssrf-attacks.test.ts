/**
 * Security Regression Tests: SSRF (Server-Side Request Forgery) Attacks
 *
 * P0 Security Issue: Verify network-security.ts properly blocks attempts to access:
 * - AWS/GCP/Azure metadata endpoints (169.254.169.254, metadata.google.internal)
 * - Localhost addresses (127.0.0.1, localhost, ::1)
 * - Private IP ranges (10.0.0.0/8, 192.168.0.0/16, 172.16.0.0/12)
 * - Alternative IP encodings (decimal, octal, hex)
 * - IPv4-mapped IPv6 addresses (::ffff:127.0.0.1)
 *
 * These are E2E tests that verify the complete security validation flow.
 */

import { describe, it, expect } from 'vitest';
import { validateUrl, isBlockedHost } from '../../src/network-security.js';

describe('SSRF Attack Protection (P0 Security)', () => {
  describe('AWS Metadata Endpoint Attacks', () => {
    it('should_block_standardAWSMetadataEndpoint', () => {
      const result = validateUrl('http://169.254.169.254/latest/meta-data/');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cloud metadata endpoint');
      expect(result.reason).toContain('SSRF protection');
    });

    it('should_block_AWSIMDSv2IPv6Endpoint', () => {
      const result = validateUrl('http://[fd00:ec2::254]/latest/meta-data/');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('SSRF protection');
    });

    it('should_block_AWSMetadataHostname', () => {
      const result = validateUrl('http://instance-data.ec2.internal/latest/meta-data/');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cloud metadata endpoint');
    });

    it('should_block_decimalEncodedAWSMetadata', () => {
      // 169.254.169.254 in decimal = 2852039166
      const blocked = isBlockedHost('2852039166');

      expect(blocked).toBe(true);
    });

    it('should_block_hexEncodedAWSMetadata', () => {
      // 169.254.169.254 in hex = 0xa9fea9fe
      const blocked = isBlockedHost('0xa9fea9fe');

      expect(blocked).toBe(true);
    });

    it('should_block_octalEncodedAWSMetadata', () => {
      // 169.254.169.254 in octal = 0251.0376.0251.0376
      const blocked = isBlockedHost('0251.0376.0251.0376');

      expect(blocked).toBe(true);
    });
  });

  describe('GCP/Azure Metadata Endpoint Attacks', () => {
    it('should_block_GCPMetadataEndpoint', () => {
      const result = validateUrl('http://metadata.google.internal/computeMetadata/v1/');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cloud metadata endpoint');
    });

    it('should_block_OpenStackMetadataEndpoint', () => {
      const result = validateUrl('http://169.254.169.253/openstack/latest/meta_data.json');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cloud metadata endpoint');
    });
  });

  describe('Localhost Access Attacks', () => {
    it('should_block_localhost', () => {
      const result = validateUrl('http://localhost:8080/admin');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('localhost');
      expect(result.reason).toContain('SSRF protection');
    });

    it('should_block_127_0_0_1', () => {
      const result = validateUrl('http://127.0.0.1:3000/');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('localhost');
    });

    it('should_block_127_x_x_x_range', () => {
      // Test various addresses in 127.0.0.0/8
      const addresses = [
        'http://127.0.0.2/',
        'http://127.1.1.1/',
        'http://127.255.255.255/',
      ];

      addresses.forEach(url => {
        const result = validateUrl(url);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('localhost');
      });
    });

    it('should_block_IPv6_localhost', () => {
      const result = validateUrl('http://[::1]:8080/');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('SSRF protection');
    });

    it('should_block_0_0_0_0', () => {
      const result = validateUrl('http://0.0.0.0:9000/');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('localhost');
    });
  });

  describe('Private Network Attacks (RFC 1918)', () => {
    it('should_block_10_0_0_0_8_range', () => {
      const addresses = [
        'http://10.0.0.1/',
        'http://10.1.2.3/',
        'http://10.255.255.254/',
      ];

      addresses.forEach(url => {
        const result = validateUrl(url);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('private network');
      });
    });

    it('should_block_172_16_0_0_12_range', () => {
      const addresses = [
        'http://172.16.0.1/',
        'http://172.20.50.100/',
        'http://172.31.255.255/',
      ];

      addresses.forEach(url => {
        const result = validateUrl(url);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('private network');
      });
    });

    it('should_block_192_168_0_0_16_range', () => {
      const addresses = [
        'http://192.168.0.1/',
        'http://192.168.1.254/',
        'http://192.168.255.255/',
      ];

      addresses.forEach(url => {
        const result = validateUrl(url);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('private network');
      });
    });
  });

  describe('IPv6 Private Network Attacks', () => {
    it('should_block_IPv6_UniqueLocalAddress', () => {
      const addresses = [
        'http://[fc00::1]/',
        'http://[fd12:3456:789a:1::1]/',
        'http://[fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]/',
      ];

      addresses.forEach(url => {
        const result = validateUrl(url);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('SSRF protection');
      });
    });

    it('should_block_IPv6_LinkLocal', () => {
      const addresses = [
        'http://[fe80::1]/',
        'http://[fe80::1234:5678:9abc:def0]/',
      ];

      addresses.forEach(url => {
        const result = validateUrl(url);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('SSRF protection');
      });
    });

    it('should_block_IPv6_SiteLocal_deprecated', () => {
      const result = validateUrl('http://[fec0::1]/');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('SSRF protection');
    });

    it('should_block_IPv6_Multicast', () => {
      const addresses = [
        'http://[ff00::1]/',
        'http://[ff02::1]/',  // All-nodes multicast
        'http://[ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]/',
      ];

      addresses.forEach(url => {
        const result = validateUrl(url);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('SSRF protection');
      });
    });
  });

  describe('IPv4-Mapped IPv6 Attacks', () => {
    it('should_block_IPv4MappedIPv6_localhost', () => {
      const blocked = isBlockedHost('::ffff:127.0.0.1');

      expect(blocked).toBe(true);
    });

    it('should_block_IPv4MappedIPv6_privateNetwork', () => {
      const addresses = [
        '::ffff:10.0.0.1',
        '::ffff:192.168.1.1',
        '::ffff:172.16.0.1',
      ];

      addresses.forEach(host => {
        const blocked = isBlockedHost(host);
        expect(blocked).toBe(true);
      });
    });

    it('should_block_IPv4MappedIPv6_metadata', () => {
      const blocked = isBlockedHost('::ffff:169.254.169.254');

      expect(blocked).toBe(true);
    });
  });

  describe('Link-Local Address Attacks', () => {
    it('should_block_169_254_x_x_range', () => {
      const addresses = [
        'http://169.254.0.1/',
        'http://169.254.100.50/',
        'http://169.254.255.255/',
      ];

      addresses.forEach(url => {
        const result = validateUrl(url);
        expect(result.allowed).toBe(false);
        // Link-local addresses are blocked for SSRF protection
        expect(result.reason).toContain('SSRF protection');
      });
    });
  });

  describe('Alternative Encoding Bypass Attempts', () => {
    it('should_block_decimalEncodedIP', () => {
      // 127.0.0.1 in decimal = 2130706433
      const blocked = isBlockedHost('2130706433');

      expect(blocked).toBe(true);
    });

    it('should_block_mixedEncodingIP', () => {
      // Mixed decimal, hex, octal (127.0.0.1)
      const blocked = isBlockedHost('0x7f.0.0.1');

      expect(blocked).toBe(true);
    });

    it('should_block_partialOctalIP', () => {
      // 127.0.0.1 with octal first octet
      const blocked = isBlockedHost('0177.0.0.1');

      expect(blocked).toBe(true);
    });
  });

  describe('Bypass Attempt Variations', () => {
    it('should_block_URLWithUserInfo', () => {
      // Attempt to bypass with user:pass@host
      const result = validateUrl('http://user:pass@169.254.169.254/');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cloud metadata endpoint');
    });

    it('should_block_URLWithPort', () => {
      // Metadata endpoint with non-standard port
      const result = validateUrl('http://169.254.169.254:8080/');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cloud metadata endpoint');
    });

    it('should_block_URLWithPath', () => {
      // Long path to disguise intent
      const result = validateUrl('http://169.254.169.254/a/b/c/d/e/f/g/h');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cloud metadata endpoint');
    });

    it('should_block_URLWithQueryString', () => {
      // Query string to disguise intent
      const result = validateUrl('http://localhost?redirect=https://google.com');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('localhost');
    });

    it('should_block_URLWithFragment', () => {
      // Fragment to disguise intent
      const result = validateUrl('http://127.0.0.1#section');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('localhost');
    });
  });

  describe('Safe URLs (Sanity Check)', () => {
    it('should_allow_legitimatePublicURL', () => {
      const result = validateUrl('https://api.anthropic.com/v1/messages');

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should_allow_legitimateCDN', () => {
      const result = validateUrl('https://cdn.jsdelivr.net/npm/package');

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should_allow_publicIPAddress', () => {
      // Public IP (e.g., Google DNS)
      const result = validateUrl('http://8.8.8.8/');

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });

  describe('Invalid URL Handling', () => {
    it('should_reject_malformedURL', () => {
      const result = validateUrl('not-a-valid-url');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Invalid URL format');
    });

    it('should_reject_emptyURL', () => {
      const result = validateUrl('');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Invalid URL format');
    });

    it('should_reject_URLWithoutProtocol', () => {
      const result = validateUrl('169.254.169.254');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Invalid URL format');
    });
  });
});
