import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { AuthConfigResponse } from '@/lib/auth'
import { fetchAuthConfig, generateCodeChallenge, generateCodeVerifier, getToken } from '@/lib/auth'
import { useTranslation } from 'react-i18next'

export default function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [config, setConfig] = useState<AuthConfigResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // If already authenticated, redirect to home
    if (getToken()) {
      navigate('/', { replace: true })
      return
    }

    fetchAuthConfig()
      .then((cfg) => {
        setConfig(cfg)
        if (!cfg.enabled) {
          navigate('/', { replace: true })
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load auth config')
      })
      .finally(() => setLoading(false))
  }, [navigate])

  async function handleLogin() {
    if (!config?.authorizeUrl || !config.clientId) return

    setError(null)

    try {
      const redirectUri = `${window.location.origin}/login/callback`

      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: config.scopes || 'openid profile email',
        state: crypto.randomUUID(),
      })

      if (config.pkce) {
        const verifier = generateCodeVerifier()
        const challenge = await generateCodeChallenge(verifier)
        sessionStorage.setItem('bkd_pkce_verifier', verifier)
        sessionStorage.setItem('bkd_pkce_redirect', redirectUri)
        params.set('code_challenge', challenge)
        params.set('code_challenge_method', 'S256')
      }

      window.location.href = `${config.authorizeUrl}?${params.toString()}`
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start login')
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{t('auth.login')}</CardTitle>
          <CardDescription>{t('auth.loginDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {config?.error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {config.error}
            </div>
          )}
          <Button
            className="w-full"
            onClick={handleLogin}
            disabled={!config?.authorizeUrl}
          >
            {t('auth.loginWithOAuth')}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
