import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { setToken } from '@/lib/auth'
import { useTranslation } from 'react-i18next'

export default function LoginCallbackPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function handleCallback() {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')

      if (!code) {
        setError(params.get('error_description') || params.get('error') || t('auth.noCodeReceived'))
        return
      }

      const codeVerifier = sessionStorage.getItem('bkd_pkce_verifier') || undefined
      const redirectUri = sessionStorage.getItem('bkd_pkce_redirect') || `${window.location.origin}/login/callback`

      // Clean up PKCE state
      sessionStorage.removeItem('bkd_pkce_verifier')
      sessionStorage.removeItem('bkd_pkce_redirect')

      try {
        const res = await fetch('/api/auth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            codeVerifier,
            redirectUri,
          }),
        })

        const json = await res.json()

        if (!json.success) {
          setError(json.error || t('auth.loginFailed'))
          return
        }

        setToken(json.data.token)
        navigate('/', { replace: true })
      } catch (err) {
        setError(err instanceof Error ? err.message : t('auth.loginFailed'))
      }
    }

    void handleCallback()
  }, [navigate, t])

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="w-full max-w-sm space-y-4 text-center">
          <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
          <a href="/login" className="text-sm text-primary hover:underline">
            {t('auth.backToLogin')}
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center space-y-2">
        <div className="h-8 w-8 mx-auto animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">{t('auth.authenticating')}</p>
      </div>
    </div>
  )
}
