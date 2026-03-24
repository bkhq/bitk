import { useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import type { AuthConfigResponse } from '@/lib/auth'
import { clearToken, fetchAuthConfig, getToken } from '@/lib/auth'

function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return true
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.exp === 'number' && payload.exp <= Math.floor(Date.now() / 1000)
  } catch {
    return true
  }
}

export function useAuthConfig() {
  return useQuery<AuthConfigResponse>({
    queryKey: ['auth', 'config'],
    queryFn: fetchAuthConfig,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

export function useAuth() {
  const { data: config, isLoading, isError } = useAuthConfig()
  const token = getToken()
  const isAuthenticated = !!token && !isTokenExpired(token)

  const logout = useCallback(() => {
    clearToken()
    window.location.href = '/login'
  }, [])

  return {
    /** Whether auth is configured and enabled on the server */
    authEnabled: config?.enabled ?? false,
    /** Whether the user has a valid, non-expired token */
    isAuthenticated,
    /** Whether we're still loading auth config */
    isLoading,
    /** Whether the auth config fetch failed (must not fail open) */
    isError,
    /** Clear token and redirect to login */
    logout,
  }
}
