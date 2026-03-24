import { describe, expect, test } from 'bun:test'
import app from '@/app'
import './setup'

/**
 * Security headers tests — CSP, CORS, HSTS.
 * Covers SEC-019, SEC-002, SEC-031.
 */

async function requestHeaders(path: string, init?: RequestInit) {
  const res = await app.request(`http://localhost${path}`, init)
  return res
}

describe('Content-Security-Policy (SEC-019)', () => {
  test('returns CSP header on API responses', async () => {
    const res = await requestHeaders('/api/projects')
    const csp = res.headers.get('content-security-policy')
    expect(csp).toBeTruthy()
    expect(csp).toContain('default-src \'self\'')
    expect(csp).toContain('script-src \'self\' \'unsafe-inline\'')
    expect(csp).toContain('style-src \'self\' \'unsafe-inline\'')
    expect(csp).toContain('img-src \'self\' data: blob:')
    expect(csp).toContain('connect-src \'self\'')
    expect(csp).toContain('font-src \'self\'')
    expect(csp).toContain('frame-ancestors \'none\'')
    expect(csp).toContain('object-src \'none\'')
  })
})

describe('Strict-Transport-Security (SEC-031)', () => {
  test('returns HSTS header', async () => {
    const res = await requestHeaders('/api/projects')
    const hsts = res.headers.get('strict-transport-security')
    expect(hsts).toBe('max-age=31536000; includeSubDomains')
  })
})

describe('CORS (SEC-002)', () => {
  test('returns CORS headers for API preflight', async () => {
    const res = await requestHeaders('/api/projects', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    })
    // Default ALLOWED_ORIGIN=* so Access-Control-Allow-Origin should be *
    const acao = res.headers.get('access-control-allow-origin')
    expect(acao).toBe('*')
    const methods = res.headers.get('access-control-allow-methods')
    expect(methods).toContain('POST')
    expect(methods).toContain('PATCH')
  })

  test('returns CORS headers on normal API requests', async () => {
    const res = await requestHeaders('/api/projects', {
      method: 'GET',
      headers: { Origin: 'http://localhost:3000' },
    })
    const acao = res.headers.get('access-control-allow-origin')
    expect(acao).toBe('*')
  })

  test('does not return CORS headers for non-API paths', async () => {
    const res = await requestHeaders('/', {
      method: 'GET',
      headers: { Origin: 'http://localhost:3000' },
    })
    const acao = res.headers.get('access-control-allow-origin')
    expect(acao).toBeNull()
  })
})
