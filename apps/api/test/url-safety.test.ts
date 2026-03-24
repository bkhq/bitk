/**
 * Tests for SSRF-safe URL validation (utils/url-safety.ts).
 *
 * Validates that:
 * - Private/reserved IPs are correctly classified
 * - DNS resolution is checked before allowing webhook URLs
 * - Public hostnames resolving to private addresses are blocked
 */
import type { DnsResolver } from '@/utils/url-safety'
import { describe, expect, test } from 'bun:test'
import { isPrivateHostname, isPrivateIP, validateWebhookUrl } from '@/utils/url-safety'

// ── Fake resolvers ─────────────────────────────────────────

function fakeResolver(addresses: { address: string, family: number }[]): DnsResolver {
  return async () => addresses
}

function failingResolver(message = 'ENOTFOUND'): DnsResolver {
  return async () => {
    throw new Error(message)
  }
}

// ── isPrivateIP ────────────────────────────────────────────

describe('isPrivateIP', () => {
  const privateCases = [
    // Loopback
    '127.0.0.1',
    '127.255.255.255',
    // 10.x.x.x
    '10.0.0.1',
    '10.255.255.255',
    // 172.16-31.x.x
    '172.16.0.1',
    '172.31.255.255',
    // 192.168.x.x
    '192.168.0.1',
    '192.168.255.255',
    // Link-local
    '169.254.0.1',
    '169.254.169.254', // cloud metadata
    // CGNAT
    '100.64.0.1',
    '100.127.255.255',
    // Current network
    '0.0.0.0',
    '0.255.255.255',
    // Multicast
    '224.0.0.1',
    '239.255.255.255',
    // Reserved
    '240.0.0.1',
    '255.255.255.255',
    // TEST-NETs
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    // Benchmarking
    '198.18.0.1',
    // IPv6 loopback
    '::1',
    // IPv6 link-local
    'fe80::1',
    // IPv6 unique local
    'fc00::1',
    'fd12::1',
    // IPv6 multicast
    'ff02::1',
  ]

  for (const ip of privateCases) {
    test(`${ip} → private`, () => {
      expect(isPrivateIP(ip)).toBe(true)
    })
  }

  const publicCases = [
    '8.8.8.8',
    '1.1.1.1',
    '142.250.80.46', // google.com
    '104.21.0.1',
    '2606:4700::1', // Cloudflare IPv6
  ]

  for (const ip of publicCases) {
    test(`${ip} → public`, () => {
      expect(isPrivateIP(ip)).toBe(false)
    })
  }

  test('IPv4-mapped IPv6 delegates correctly', () => {
    expect(isPrivateIP('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateIP('::ffff:8.8.8.8')).toBe(false)
  })

  test('invalid string treated as private', () => {
    expect(isPrivateIP('not-an-ip')).toBe(true)
  })
})

// ── isPrivateHostname ──────────────────────────────────────

describe('isPrivateHostname', () => {
  test('localhost → private', () => {
    expect(isPrivateHostname('localhost')).toBe(true)
  })

  test('127.0.0.1 → private', () => {
    expect(isPrivateHostname('127.0.0.1')).toBe(true)
  })

  test('192.168.1.1 → private', () => {
    expect(isPrivateHostname('192.168.1.1')).toBe(true)
  })

  test('example.com → not private (hostname only, no DNS)', () => {
    expect(isPrivateHostname('example.com')).toBe(false)
  })

  test('8.8.8.8 → public', () => {
    expect(isPrivateHostname('8.8.8.8')).toBe(false)
  })
})

// ── validateWebhookUrl ─────────────────────────────────────

describe('validateWebhookUrl', () => {
  test('rejects non-http protocols', async () => {
    const result = await validateWebhookUrl('ftp://example.com/hook')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('http or https')
  })

  test('rejects malformed URLs', async () => {
    const result = await validateWebhookUrl('not a url')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Invalid URL')
  })

  test('rejects localhost', async () => {
    const result = await validateWebhookUrl('http://localhost:8080/hook')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('private')
  })

  test('rejects 127.0.0.1', async () => {
    const result = await validateWebhookUrl('http://127.0.0.1/hook')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('private')
  })

  test('rejects 169.254.169.254 (cloud metadata)', async () => {
    const result = await validateWebhookUrl('http://169.254.169.254/latest/meta-data/')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('private')
  })

  test('rejects 10.x.x.x IP literal', async () => {
    const result = await validateWebhookUrl('http://10.0.0.5/hook')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('private')
  })

  test('rejects 192.168.x.x IP literal', async () => {
    const result = await validateWebhookUrl('http://192.168.1.100/hook')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('private')
  })

  test('accepts public IP literal', async () => {
    const result = await validateWebhookUrl('https://8.8.8.8/hook')
    expect(result.ok).toBe(true)
  })

  // ── DNS rebinding scenarios (using injectable resolver) ──

  test('rejects hostname resolving to loopback via DNS', async () => {
    const resolver = fakeResolver([{ address: '127.0.0.1', family: 4 }])
    const result = await validateWebhookUrl('https://evil-rebind.example.com/hook', resolver)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('private')
  })

  test('rejects hostname resolving to metadata IP via DNS', async () => {
    const resolver = fakeResolver([{ address: '169.254.169.254', family: 4 }])
    const result = await validateWebhookUrl('https://metadata-rebind.example.com/hook', resolver)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('private')
  })

  test('rejects hostname resolving to 10.x private IP via DNS', async () => {
    const resolver = fakeResolver([{ address: '10.0.0.1', family: 4 }])
    const result = await validateWebhookUrl('https://internal.example.com/hook', resolver)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('private')
  })

  test('rejects hostname resolving to 192.168 via DNS', async () => {
    const resolver = fakeResolver([{ address: '192.168.1.1', family: 4 }])
    const result = await validateWebhookUrl('https://home-router.example.com/hook', resolver)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('private')
  })

  test('rejects if any resolved address is private (mixed results)', async () => {
    const resolver = fakeResolver([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])
    const result = await validateWebhookUrl('https://dual-record.example.com/hook', resolver)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('private')
  })

  test('rejects hostname resolving to private IPv6', async () => {
    const resolver = fakeResolver([{ address: '::1', family: 6 }])
    const result = await validateWebhookUrl('https://ipv6-rebind.example.com/hook', resolver)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('private')
  })

  test('accepts hostname resolving to public IP', async () => {
    const resolver = fakeResolver([{ address: '93.184.216.34', family: 4 }])
    const result = await validateWebhookUrl('https://example.com/hook', resolver)
    expect(result.ok).toBe(true)
  })

  test('accepts hostname resolving to multiple public IPs', async () => {
    const resolver = fakeResolver([
      { address: '93.184.216.34', family: 4 },
      { address: '93.184.216.35', family: 4 },
    ])
    const result = await validateWebhookUrl('https://cdn.example.com/hook', resolver)
    expect(result.ok).toBe(true)
  })

  test('rejects hostname that fails DNS resolution', async () => {
    const resolver = failingResolver('ENOTFOUND')
    const result = await validateWebhookUrl('https://nonexistent.invalid/hook', resolver)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('resolve')
  })

  test('rejects hostname that returns empty addresses', async () => {
    const resolver = fakeResolver([])
    const result = await validateWebhookUrl('https://empty.example.com/hook', resolver)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('resolve')
  })
})
