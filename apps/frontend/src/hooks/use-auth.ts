import { useQuery } from '@tanstack/react-query'
import type { AuthConfigResponse } from '@/lib/auth'
import { clearToken, fetchAuthConfig, getToken } from '@/lib/auth'

export function useAuthConfig() {
  return useQuery<AuthConfigResponse>({
    queryKey: ['auth', 'config'],
    queryFn: fetchAuthConfig,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  })
}

export function useAuth() {
  const { data: config, isLoading } = useAuthConfig()
  const token = getToken()

  return {
    /** Whether auth is configured and enabled on the server */
    authEnabled: config?.enabled ?? false,
    /** Whether the user has a stored token */
    isAuthenticated: !!token,
    /** Whether we're still loading auth config */
    isLoading,
    /** Clear token and redirect to login */
    logout: () => {
      clearToken()
      window.location.href = '/login'
    },
  }
}
