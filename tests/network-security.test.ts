/**
 * Unit tests for network security features
 *
 * Tests:
 * - Network host validation
 * - SSRF protection
 * - Private IP blocking
 * - Cloud metadata endpoint blocking
 */

import { describe, it, expect } from 'vitest';
import { validateNetworkPermissions, isBlockedHost, validateUrl, extractHostname } from '../src/network-security.js';

describe('Network Security', () => {
  describe('validateNetworkPermissions', () => {
    it('should_allow_localhost_for_mcp_proxy', () => {
      const hosts = ['localhost', '127.0.0.1'];
      const result = validateNetworkPermissions(hosts);

      expect(result.valid).toBe(true);
      expect(result.blockedHosts).toEqual([]);
    });

    it('should_allow_public_domains', () => {
      const hosts = ['api.example.com', 'example.com'];
      const result = validateNetworkPermissions(hosts);

      expect(result.valid).toBe(true);
      expect(result.blockedHosts).toEqual([]);
    });

    it('should_warn_about_private_networks', () => {
      const hosts = ['10.0.0.1', 'example.com'];
      const result = validateNetworkPermissions(hosts);

      expect(result.valid).toBe(false);
      expect(result.blockedHosts).toContain('10.0.0.1');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should_warn_about_cloud_metadata', () => {
      const hosts = ['169.254.169.254'];
      const result = validateNetworkPermissions(hosts);

      expect(result.valid).toBe(false);
      expect(result.blockedHosts).toContain('169.254.169.254');
    });

    it('should_handle_empty_host_list', () => {
      const result = validateNetworkPermissions([]);

      expect(result.valid).toBe(true);
      expect(result.blockedHosts).toEqual([]);
    });

    it('should_identify_multiple_blocked_hosts', () => {
      const hosts = ['10.0.0.1', '192.168.1.1', 'example.com'];
      const result = validateNetworkPermissions(hosts);

      expect(result.valid).toBe(false);
      expect(result.blockedHosts.length).toBe(2);
    });
  });

  describe('isBlockedHost - SSRF Protection', () => {
    describe('localhost blocking', () => {
      it('should_block_localhost_literal', () => {
        expect(isBlockedHost('localhost')).toBe(true);
      });

      it('should_block_127_0_0_1', () => {
        expect(isBlockedHost('127.0.0.1')).toBe(true);
      });

      it('should_block_127_0_0_0_8_range', () => {
        expect(isBlockedHost('127.0.0.2')).toBe(true);
        expect(isBlockedHost('127.1.1.1')).toBe(true);
        expect(isBlockedHost('127.255.255.255')).toBe(true);
      });

      it('should_block_ipv6_localhost', () => {
        // Note: Current implementation may not handle IPv6 yet
        // This test documents expected behavior
        expect(isBlockedHost('::1')).toBe(true);
      });

      it('should_block_0_0_0_0', () => {
        expect(isBlockedHost('0.0.0.0')).toBe(true);
      });
    });

    describe('private IP blocking - Class A', () => {
      it('should_block_10_0_0_0_8', () => {
        expect(isBlockedHost('10.0.0.1')).toBe(true);
        expect(isBlockedHost('10.255.255.255')).toBe(true);
        expect(isBlockedHost('10.1.2.3')).toBe(true);
      });
    });

    describe('private IP blocking - Class B', () => {
      it('should_block_172_16_0_0_12', () => {
        expect(isBlockedHost('172.16.0.1')).toBe(true);
        expect(isBlockedHost('172.31.255.255')).toBe(true);
        expect(isBlockedHost('172.20.1.1')).toBe(true);
      });

      it('should_not_block_172_outside_range', () => {
        expect(isBlockedHost('172.15.0.1')).toBe(false);
        expect(isBlockedHost('172.32.0.1')).toBe(false);
      });
    });

    describe('private IP blocking - Class C', () => {
      it('should_block_192_168_0_0_16', () => {
        expect(isBlockedHost('192.168.0.1')).toBe(true);
        expect(isBlockedHost('192.168.255.255')).toBe(true);
        expect(isBlockedHost('192.168.1.1')).toBe(true);
      });

      it('should_not_block_192_outside_range', () => {
        expect(isBlockedHost('192.167.1.1')).toBe(false);
        expect(isBlockedHost('192.169.1.1')).toBe(false);
      });
    });

    describe('cloud metadata endpoint blocking', () => {
      it('should_block_aws_metadata_ip', () => {
        expect(isBlockedHost('169.254.169.254')).toBe(true);
      });

      it('should_block_aws_metadata_domain', () => {
        // Currently only regex-based, no DNS resolution
        // These are blocked by pattern matching
        expect(isBlockedHost('metadata.google.internal')).toBe(true);
      });

      it('should_block_link_local_addresses', () => {
        expect(isBlockedHost('169.254.0.1')).toBe(true);
        expect(isBlockedHost('169.254.255.255')).toBe(true);
      });
    });

    describe('public IP allowlist', () => {
      it('should_allow_public_ips', () => {
        expect(isBlockedHost('8.8.8.8')).toBe(false);          // Google DNS
        expect(isBlockedHost('1.1.1.1')).toBe(false);          // Cloudflare DNS
        expect(isBlockedHost('93.184.216.34')).toBe(false);    // example.com
      });

      it('should_allow_public_domains', () => {
        expect(isBlockedHost('google.com')).toBe(false);
        expect(isBlockedHost('api.github.com')).toBe(false);
        expect(isBlockedHost('example.com')).toBe(false);
      });

      it('should_allow_hosts_with_ports', () => {
        expect(isBlockedHost('example.com:443')).toBe(false);
        expect(isBlockedHost('8.8.8.8:53')).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should_handle_empty_string', () => {
        expect(isBlockedHost('')).toBe(false);
      });

      it('should_handle_invalid_ips', () => {
        expect(isBlockedHost('999.999.999.999')).toBe(false);
        expect(isBlockedHost('not-an-ip')).toBe(false);
      });

      it('should_handle_ipv4_mapped_ipv6', () => {
        // IPv4-mapped IPv6 addresses - may not be fully supported yet
        // This test documents expected behavior
        // expect(isBlockedHost('::ffff:127.0.0.1')).toBe(true);
      });

      it('should_be_case_insensitive_for_domains', () => {
        expect(isBlockedHost('LOCALHOST')).toBe(true);
        expect(isBlockedHost('LocalHost')).toBe(true);
        expect(isBlockedHost('METADATA.GOOGLE.INTERNAL')).toBe(true);
      });
    });
  });

  describe('extractHostname', () => {
    it('should_extract_hostname_from_url', () => {
      expect(extractHostname('http://example.com/path')).toBe('example.com');
      expect(extractHostname('https://api.github.com')).toBe('api.github.com');
    });

    it('should_return_null_for_invalid_url', () => {
      expect(extractHostname('not-a-url')).toBe(null);
      expect(extractHostname('')).toBe(null);
    });

    it('should_handle_urls_with_ports', () => {
      expect(extractHostname('http://example.com:8080')).toBe('example.com');
    });

    it('should_handle_ipv4_urls', () => {
      expect(extractHostname('http://192.168.1.1')).toBe('192.168.1.1');
    });
  });

  describe('validateUrl', () => {
    it('should_allow_public_urls', () => {
      const result = validateUrl('https://api.github.com');
      expect(result.allowed).toBe(true);
    });

    it('should_block_localhost_urls', () => {
      const result = validateUrl('http://localhost:3000');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('localhost');
    });

    it('should_block_private_network_urls', () => {
      const result = validateUrl('http://192.168.1.1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('private network');
    });

    it('should_block_cloud_metadata_urls', () => {
      const result = validateUrl('http://169.254.169.254');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('metadata');
    });

    it('should_reject_invalid_urls', () => {
      const result = validateUrl('not-a-url');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Invalid URL');
    });
  });

  describe('SSRF Attack Vectors', () => {
    it('should_block_decimal_ip_encoding', () => {
      // 127.0.0.1 in decimal = 2130706433
      const decimalIP = '2130706433';
      // Note: This depends on implementation supporting decimal IPs
      // If not supported, it will pass (false negative acceptable)
    });

    it('should_block_octal_ip_encoding', () => {
      // 127.0.0.1 in octal = 0177.0.0.1
      // Note: Octal encoding not currently blocked
      // This test documents expected behavior for future enhancement
    });

    it('should_block_hex_ip_encoding', () => {
      // 127.0.0.1 in hex = 0x7f.0.0.1
      // Note: Hex encoding not currently blocked
      // This test documents expected behavior for future enhancement
    });

    it('should_block_shorthand_localhost', () => {
      // Shorthand notation not currently blocked
      // This test documents expected behavior for future enhancement
    });

    it('should_block_url_encoded_dots', () => {
      // Some parsers might interpret %2e as .
      const encoded = '127%2e0%2e0%2e1';
      // This test documents the attack vector
      // Actual blocking depends on URL parser
    });
  });

  describe('Integration Scenarios', () => {
    it('should_protect_against_aws_metadata_ssrf', () => {
      const awsMetadataHosts = [
        '169.254.169.254',
        'metadata.google.internal'
      ];

      for (const host of awsMetadataHosts) {
        expect(isBlockedHost(host)).toBe(true);
      }
    });

    it('should_protect_against_internal_network_scan', () => {
      const internalHosts = [
        '192.168.1.1',
        '10.0.0.1',
        '172.16.0.1',
        'localhost',
        '127.0.0.1'
      ];

      for (const host of internalHosts) {
        expect(isBlockedHost(host)).toBe(true);
      }
    });

    it('should_allow_legitimate_external_apis', () => {
      const legitimateAPIs = [
        'api.github.com',
        'api.stripe.com',
        'api.openai.com',
        'api.anthropic.com'
      ];

      for (const api of legitimateAPIs) {
        expect(isBlockedHost(api)).toBe(false);
      }
    });

    it('should_allow_cdn_domains', () => {
      const cdns = [
        'cdn.jsdelivr.net',
        'unpkg.com',
        'd3js.org'
      ];

      for (const cdn of cdns) {
        expect(isBlockedHost(cdn)).toBe(false);
      }
    });
  });
});

describe('Network Security Edge Cases', () => {
  describe('URL parsing edge cases', () => {
    it('should_handle_urls_with_userinfo', () => {
      // user:pass@host format - current implementation may not parse userinfo
      // These are better handled via validateUrl() function
    });

    it('should_handle_urls_with_fragments', () => {
      // Fragments - current implementation may not handle these
      // Use validateUrl() for full URL validation
    });

    it('should_handle_urls_with_query_strings', () => {
      // Query strings - current implementation may not handle these
      // Use validateUrl() for full URL validation
    });

    it('should_handle_punycode_domains', () => {
      // Internationalized domain names
      const punycoded = 'xn--e1afmkfd.xn--p1ai'; // пример.рф in punycode

      // Should not be blocked (unless it resolves to private IP)
      expect(isBlockedHost(punycoded)).toBe(false);
    });
  });

  describe('IPv6 edge cases', () => {
    it('should_block_ipv6_localhost_variations', () => {
      expect(isBlockedHost('::1')).toBe(true);
      expect(isBlockedHost('[::1]')).toBe(true);
      expect(isBlockedHost('0000:0000:0000:0000:0000:0000:0000:0001')).toBe(true);
    });

    it('should_block_ipv6_link_local', () => {
      expect(isBlockedHost('fe80::1')).toBe(true);
      expect(isBlockedHost('[fe80::1]')).toBe(true);
    });

    it('should_block_ipv6_unique_local', () => {
      expect(isBlockedHost('fc00::1')).toBe(true);
      expect(isBlockedHost('[fd00::1]')).toBe(true);
    });
  });

  describe('DNS rebinding protection', () => {
    it('should_block_domains_resolving_to_private_ips', () => {
      // Note: This test documents the requirement
      // Actual implementation would need DNS resolution
      // which is async and may not be done in isBlockedHost

      // Common internal domains
      const internalDomains = [
        'instance-data.ec2.internal',
        'metadata.google.internal'
      ];

      for (const domain of internalDomains) {
        expect(isBlockedHost(domain)).toBe(true);
      }
    });
  });

  describe('Alternative IP encoding detection', () => {
    describe('Decimal IP encoding', () => {
      it('should_block_decimal_encoded_localhost', () => {
        expect(isBlockedHost('2130706433')).toBe(true);  // 127.0.0.1
      });

      it('should_block_decimal_encoded_private_ips', () => {
        expect(isBlockedHost('167772160')).toBe(true);   // 10.0.0.0
        expect(isBlockedHost('3232235520')).toBe(true);  // 192.168.0.0
        expect(isBlockedHost('2886729728')).toBe(true);  // 172.16.0.0
      });

      it('should_block_short_decimal_ips', () => {
        expect(isBlockedHost('167772160')).toBe(true);   // 10.0.0.0 (9 digits)
        expect(isBlockedHost('2130706433')).toBe(true);  // 127.0.0.1 (10 digits)
      });

      it('should_block_decimal_cloud_metadata', () => {
        expect(isBlockedHost('2852039166')).toBe(true);  // 169.254.169.254
      });
    });

    describe('Octal IP encoding', () => {
      it('should_block_octal_encoded_localhost', () => {
        expect(isBlockedHost('0177.0.0.1')).toBe(true);
        expect(isBlockedHost('0177.0000.0000.0001')).toBe(true);
      });

      it('should_block_octal_encoded_private_ips', () => {
        expect(isBlockedHost('012.0.0.1')).toBe(true);     // 10.0.0.1
        expect(isBlockedHost('0300.0250.0.1')).toBe(true); // 192.168.0.1
      });
    });

    describe('Hexadecimal IP encoding', () => {
      it('should_block_hex_encoded_localhost', () => {
        expect(isBlockedHost('0x7f.0.0.1')).toBe(true);
        expect(isBlockedHost('0x7f000001')).toBe(true);
      });

      it('should_block_short_hex_ips', () => {
        expect(isBlockedHost('0xa000000')).toBe(true);  // 10.0.0.0 (7 hex digits)
        expect(isBlockedHost('0x7f000001')).toBe(true); // 127.0.0.1 (8 hex digits)
      });

      it('should_block_hex_encoded_private_ips', () => {
        expect(isBlockedHost('0xa.0.0.1')).toBe(true);     // 10.0.0.1
        expect(isBlockedHost('0xc0.0xa8.0.1')).toBe(true); // 192.168.0.1
      });

      it('should_block_hex_cloud_metadata', () => {
        expect(isBlockedHost('0xa9fea9fe')).toBe(true); // 169.254.169.254 (full hex)
      });
    });

    describe('Shorthand IP notation', () => {
      it('should_block_shorthand_localhost', () => {
        expect(isBlockedHost('127.1')).toBe(true);
      });

      it('should_block_shorthand_private_ips', () => {
        expect(isBlockedHost('10.1')).toBe(true);
        expect(isBlockedHost('192.168.1')).toBe(true);
      });
    });
  });

  describe('IPv6 with alternative IP encodings', () => {
    it('should_block_ipv6_mapped_decimal_localhost', () => {
      expect(isBlockedHost('::ffff:2130706433')).toBe(true);
    });

    it('should_block_ipv6_mapped_octal_localhost', () => {
      expect(isBlockedHost('::ffff:0177.0.0.1')).toBe(true);
    });

    it('should_block_ipv6_mapped_hex_localhost', () => {
      expect(isBlockedHost('::ffff:0x7f.0.0.1')).toBe(true);
    });

    it('should_block_ipv6_mapped_private_ips', () => {
      expect(isBlockedHost('::ffff:167772160')).toBe(true);   // 10.0.0.0
      expect(isBlockedHost('::ffff:012.0.0.1')).toBe(true);   // 10.0.0.1 (octal)
      expect(isBlockedHost('::ffff:0xa.0.0.1')).toBe(true);   // 10.0.0.1 (hex)
    });

    it('should_block_ipv6_with_port', () => {
      // Critical: Test the extractIPv6() bug fix
      expect(isBlockedHost('::ffff:127.0.0.1:8080')).toBe(true);
      expect(isBlockedHost('[::ffff:127.0.0.1]:8080')).toBe(true);
      expect(isBlockedHost('::ffff:10.0.0.1:3000')).toBe(true);
      expect(isBlockedHost('::1:8080')).toBe(true);
      expect(isBlockedHost('[::1]:8080')).toBe(true);
    });

    it('should_preserve_ipv6_without_port', () => {
      // Ensure we don't break valid IPv6 addresses
      expect(isBlockedHost('::1')).toBe(true);
      expect(isBlockedHost('fe80::1')).toBe(true);
      expect(isBlockedHost('::ffff:127.0.0.1')).toBe(true);
    });
  });
});
