import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the auth module before importing components that use it
vi.mock('@/lib/auth', () => ({
  getToken: vi.fn(() => null),
  clearToken: vi.fn(),
  fetchAuthConfig: vi.fn(),
}))

// Must import after vi.mock so the mock is in place
const { fetchAuthConfig, getToken } = await import('@/lib/auth')
const { useAuth } = await import('@/hooks/use-auth')

/** Minimal wrapper providing QueryClient + Router */
function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

/**
 * A minimal reproduction of the AuthGate from main.tsx so we can test
 * its behaviour without importing the entire app tree.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { authEnabled, isAuthenticated, isLoading, isError } = useAuth()

  if (isLoading) return <div data-testid="loading">loading</div>
  if (isError) return <div data-testid="error">auth config error</div>
  if (!authEnabled) return <>{children}</>
  if (!isAuthenticated) return <div data-testid="login-redirect">redirected</div>
  return <>{children}</>
}

function ProtectedApp() {
  return (
    <Wrapper>
      <Routes>
        <Route
          path="/"
          element={(
            <AuthGate>
              <div data-testid="protected">protected content</div>
            </AuthGate>
          )}
        />
      </Routes>
    </Wrapper>
  )
}

describe('authGate fail-closed behaviour', () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReturnValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('blocks protected content when auth config fetch fails', async () => {
    vi.mocked(fetchAuthConfig).mockRejectedValue(new Error('network error'))

    render(<ProtectedApp />)

    // Should show loading first
    expect(screen.getByTestId('loading')).toBeDefined()

    // After failure, should show error — never protected content
    const errorEl = await screen.findByTestId('error')
    expect(errorEl).toBeDefined()
    expect(screen.queryByTestId('protected')).toBeNull()
  })

  it('renders protected content when auth is disabled', async () => {
    vi.mocked(fetchAuthConfig).mockResolvedValue({ enabled: false })

    render(<ProtectedApp />)

    const protectedEl = await screen.findByTestId('protected')
    expect(protectedEl).toBeDefined()
    expect(screen.queryByTestId('error')).toBeNull()
  })

  it('redirects to login when auth is enabled but no token', async () => {
    vi.mocked(fetchAuthConfig).mockResolvedValue({ enabled: true })
    vi.mocked(getToken).mockReturnValue(null)

    render(<ProtectedApp />)

    const redirect = await screen.findByTestId('login-redirect')
    expect(redirect).toBeDefined()
    expect(screen.queryByTestId('protected')).toBeNull()
  })

  it('renders protected content when auth is enabled and token is valid', async () => {
    vi.mocked(fetchAuthConfig).mockResolvedValue({ enabled: true })
    // Create a non-expired JWT (exp = year 2099)
    const header = btoa(JSON.stringify({ alg: 'HS256' }))
    const payload = btoa(JSON.stringify({ sub: '1', exp: 4102444800 }))
    vi.mocked(getToken).mockReturnValue(`${header}.${payload}.sig`)

    render(<ProtectedApp />)

    const protectedEl = await screen.findByTestId('protected')
    expect(protectedEl).toBeDefined()
  })
})
