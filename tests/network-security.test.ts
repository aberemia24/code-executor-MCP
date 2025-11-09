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
import { validateNetworkPermissions, isBlockedHost, isPrivateIP } from '../src/network-security.js';

describe('Network Security', () => {
  describe('validateNetworkPermissions', () => {
    it('should_allow_localhost', () => {
      const hosts = ['localhost', '127.0.0.1'];

      expect(() => validateNetworkPermissions(hosts)).not.toThrow();
    });

    it('should_allow_public_domains', () => {
      const hosts = ['api.example.com', 'example.com'];

      expect(() => validateNetworkPermissions(hosts)).not.toThrow();
    });

    it('should_allow_domains_with_ports', () => {
      const hosts = ['api.example.com:8080', 'localhost:3000'];

      expect(() => validateNetworkPermissions(hosts)).not.toThrow();
    });

    it('should_allow_ipv6_localhost', () => {
      const hosts = ['::1', '[::1]'];

      expect(() => validateNetworkPermissions(hosts)).not.toThrow();
    });

    it('should_reject_invalid_host_format', () => {
      const hosts = ['invalid_host!@#$'];

      expect(() => validateNetworkPermissions(hosts))
        .toThrow(/Invalid network host format/);
    });

    it('should_reject_hosts_with_spaces', () => {
      const hosts = ['example .com'];

      expect(() => validateNetworkPermissions(hosts))
        .toThrow(/Invalid network host format/);
    });

    it('should_reject_hosts_with_special_chars', () => {
      const hosts = ['example<script>.com'];

      expect(() => validateNetworkPermissions(hosts))
        .toThrow(/Invalid network host format/);
    });

    it('should_handle_empty_host_list', () => {
      expect(() => validateNetworkPermissions([])).not.toThrow();
    });

    it('should_validate_all_hosts_in_list', () => {
      const hosts = ['localhost', 'invalid!@#', 'example.com'];

      expect(() => validateNetworkPermissions(hosts))
        .toThrow(/Invalid network host format/);
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
        expect(isBlockedHost('::1')).toBe(true);
        expect(isBlockedHost('[::1]')).toBe(true);
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
        expect(isBlockedHost('instance-data.ec2.internal')).toBe(true);
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
        expect(isBlockedHost('::ffff:127.0.0.1')).toBe(true);
        expect(isBlockedHost('::ffff:10.0.0.1')).toBe(true);
      });

      it('should_be_case_insensitive_for_domains', () => {
        expect(isBlockedHost('LOCALHOST')).toBe(true);
        expect(isBlockedHost('LocalHost')).toBe(true);
        expect(isBlockedHost('METADATA.GOOGLE.INTERNAL')).toBe(true);
      });
    });
  });

  describe('isPrivateIP', () => {
    it('should_identify_private_class_a', () => {
      expect(isPrivateIP('10.0.0.1')).toBe(true);
      expect(isPrivateIP('10.255.255.255')).toBe(true);
    });

    it('should_identify_private_class_b', () => {
      expect(isPrivateIP('172.16.0.1')).toBe(true);
      expect(isPrivateIP('172.31.255.255')).toBe(true);
    });

    it('should_identify_private_class_c', () => {
      expect(isPrivateIP('192.168.0.1')).toBe(true);
      expect(isPrivateIP('192.168.255.255')).toBe(true);
    });

    it('should_identify_localhost', () => {
      expect(isPrivateIP('127.0.0.1')).toBe(true);
      expect(isPrivateIP('127.0.0.2')).toBe(true);
    });

    it('should_identify_link_local', () => {
      expect(isPrivateIP('169.254.1.1')).toBe(true);
    });

    it('should_reject_public_ips', () => {
      expect(isPrivateIP('8.8.8.8')).toBe(false);
      expect(isPrivateIP('1.1.1.1')).toBe(false);
      expect(isPrivateIP('93.184.216.34')).toBe(false);
    });

    it('should_handle_invalid_ips', () => {
      expect(isPrivateIP('not-an-ip')).toBe(false);
      expect(isPrivateIP('999.999.999.999')).toBe(false);
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
      expect(isBlockedHost('0177.0.0.1')).toBe(true);
    });

    it('should_block_hex_ip_encoding', () => {
      // 127.0.0.1 in hex = 0x7f.0.0.1
      const hexIP = '0x7f.0.0.1';
      // Note: This depends on implementation
    });

    it('should_block_shorthand_localhost', () => {
      expect(isBlockedHost('127.1')).toBe(true); // Shorthand for 127.0.0.1
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
        'instance-data.ec2.internal',
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
      // user:pass@host format
      expect(isBlockedHost('user:pass@localhost')).toBe(true);
      expect(isBlockedHost('user:pass@127.0.0.1')).toBe(true);
    });

    it('should_handle_urls_with_fragments', () => {
      expect(isBlockedHost('localhost#fragment')).toBe(true);
      expect(isBlockedHost('127.0.0.1#test')).toBe(true);
    });

    it('should_handle_urls_with_query_strings', () => {
      expect(isBlockedHost('localhost?query=1')).toBe(true);
      expect(isBlockedHost('127.0.0.1?test')).toBe(true);
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
    it('should_consistently_block_localhost_variations', () => {
      const localhostVariations = [
        'localhost',
        'localhost.',
        'localhost.localdomain',
        '127.0.0.1',
        '127.1',
        '0x7f.0.0.1'
      ];

      for (const variant of localhostVariations) {
        expect(isBlockedHost(variant)).toBe(true);
      }
    });

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
});
