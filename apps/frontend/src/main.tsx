import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { lazy, Suspense, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Toaster } from './components/ui/sonner'
import { useAuth } from './hooks/use-auth'
import { useSystemInfo } from './hooks/use-kanban'
import { eventBus } from './lib/event-bus'
import { useFileBrowserStore } from './stores/file-browser-store'
import { useNotesStore } from './stores/notes-store'
import { useProcessManagerStore } from './stores/process-manager-store'
import { useServerStore } from './stores/server-store'
import { useTerminalStore } from './stores/terminal-store'
import './i18n'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: 1,
    },
  },
})

// Invalidate all queries on SSE reconnect so stale statuses get refreshed
eventBus.onConnectionChange((connected) => {
  if (connected) queryClient.invalidateQueries()
})
// Invalidate issue queries when any issue status changes via SSE
eventBus.onIssueUpdated(() => {
  queryClient.invalidateQueries({ queryKey: ['projects'] })
  queryClient.invalidateQueries({ queryKey: ['issues', 'review'] })
})
// Debounced invalidation of changes queries on any issue activity (log/state/done)
{
  let activityTimer: ReturnType<typeof setTimeout> | null = null
  eventBus.onIssueActivity(() => {
    if (activityTimer) clearTimeout(activityTimer)
    activityTimer = setTimeout(() => {
      activityTimer = null
      queryClient.invalidateQueries({
        queryKey: ['projects'],
        predicate: q => q.queryKey.includes('changes') || q.queryKey.includes('processes'),
      })
    }, 2000)
  })
}

const HomePage = lazy(() => import('./pages/HomePage'))
const KanbanPage = lazy(() => import('./pages/KanbanPage'))
const IssueDetailPage = lazy(() => import('./pages/IssueDetailPage'))
const ReviewPage = lazy(() => import('./pages/ReviewPage'))
const TerminalPage = lazy(() => import('./pages/TerminalPage'))
const CronPage = lazy(() => import('./pages/CronPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const LoginCallbackPage = lazy(() => import('./pages/LoginCallbackPage'))
const LazyTerminalDrawer = lazy(() =>
  import('./components/terminal/TerminalDrawer').then(m => ({
    default: m.TerminalDrawer,
  })),
)
const LazyFileBrowserDrawer = lazy(() =>
  import('./components/files/FileBrowserDrawer').then(m => ({
    default: m.FileBrowserDrawer,
  })),
)
const LazyProcessManagerDrawer = lazy(() =>
  import('./components/processes/ProcessManagerDrawer').then(m => ({
    default: m.ProcessManagerDrawer,
  })),
)
const LazyNotesDrawer = lazy(() =>
  import('./components/notes/NotesDrawer').then(m => ({
    default: m.NotesDrawer,
  })),
)

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full" style={{ height: '100dvh' }}>
      {children}
    </div>
  )
}

function TerminalDrawerMount() {
  const isOpen = useTerminalStore(s => s.isOpen)

  if (!isOpen) return null

  return (
    <Suspense fallback={null}>
      <LazyTerminalDrawer />
    </Suspense>
  )
}

function FileBrowserDrawerMount() {
  const isOpen = useFileBrowserStore(s => s.isOpen)

  if (!isOpen) return null

  return (
    <Suspense fallback={null}>
      <LazyFileBrowserDrawer />
    </Suspense>
  )
}

function ProcessManagerDrawerMount() {
  const isOpen = useProcessManagerStore(s => s.isOpen)

  if (!isOpen) return null

  return (
    <Suspense fallback={null}>
      <LazyProcessManagerDrawer />
    </Suspense>
  )
}

function NotesDrawerMount() {
  const isOpen = useNotesStore(s => s.isOpen)

  if (!isOpen) return null

  return (
    <Suspense fallback={null}>
      <LazyNotesDrawer />
    </Suspense>
  )
}

/**
 * EventBusManager: Gates SSE connection on auth state.
 * - Auth disabled → connect immediately.
 * - Auth enabled + authenticated → connect.
 * - Auth enabled + unauthenticated → disconnect (no reconnect loop).
 */
function EventBusManager() {
  const { authEnabled, isAuthenticated, isLoading } = useAuth()

  useEffect(() => {
    if (isLoading) return

    const shouldConnect = !authEnabled || isAuthenticated
    if (shouldConnect) {
      eventBus.connect()
    } else {
      eventBus.disconnect()
    }

    return () => {
      eventBus.disconnect()
    }
  }, [authEnabled, isAuthenticated, isLoading])

  return null
}

function ServerConfigLoader() {
  const { data } = useSystemInfo(true)
  const setServerInfo = useServerStore(s => s.setServerInfo)

  useEffect(() => {
    if (!data) return
    const { name, url } = data.server
    setServerInfo(name, url)
    if (name) {
      document.title = name
    }
  }, [data, setServerInfo])

  return null
}

/**
 * AuthGate: When auth is enabled and user has no token, redirect to /login.
 * When auth is disabled, render children directly.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { authEnabled, isAuthenticated, isLoading, isError } = useAuth()

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  // Config fetch failed → block rendering (fail closed, never fail open)
  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <p className="text-sm">Unable to verify authentication configuration.</p>
        <button
          type="button"
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
    )
  }

  // Auth not enabled → render app directly
  if (!authEnabled) return <>{children}</>

  // Auth enabled but no token → redirect to login
  if (!isAuthenticated) return <Navigate to="/login" replace />

  return <>{children}</>
}

const rootElement = document.getElementById('app')!

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
          <AppShell>
            <Suspense
              fallback={(
                <div className="flex h-full items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
              )}
            >
              <Routes>
                {/* Auth routes — always accessible */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/login/callback" element={<LoginCallbackPage />} />

                {/* Protected routes — wrapped in AuthGate */}
                <Route
                  path="/"
                  element={(
                    <AuthGate>
                      <ErrorBoundary>
                        <HomePage />
                      </ErrorBoundary>
                    </AuthGate>
                  )}
                />
                <Route
                  path="/projects/:projectId"
                  element={(
                    <AuthGate>
                      <ErrorBoundary>
                        <KanbanPage />
                      </ErrorBoundary>
                    </AuthGate>
                  )}
                />
                <Route
                  path="/projects/:projectId/issues"
                  element={(
                    <AuthGate>
                      <ErrorBoundary>
                        <IssueDetailPage />
                      </ErrorBoundary>
                    </AuthGate>
                  )}
                />
                <Route
                  path="/projects/:projectId/issues/:issueId"
                  element={(
                    <AuthGate>
                      <ErrorBoundary>
                        <IssueDetailPage />
                      </ErrorBoundary>
                    </AuthGate>
                  )}
                />
                <Route
                  path="/review"
                  element={(
                    <AuthGate>
                      <ErrorBoundary>
                        <ReviewPage />
                      </ErrorBoundary>
                    </AuthGate>
                  )}
                />
                <Route
                  path="/review/:projectAlias/:issueId"
                  element={(
                    <AuthGate>
                      <ErrorBoundary>
                        <ReviewPage />
                      </ErrorBoundary>
                    </AuthGate>
                  )}
                />
                <Route
                  path="/terminal"
                  element={(
                    <AuthGate>
                      <ErrorBoundary>
                        <TerminalPage />
                      </ErrorBoundary>
                    </AuthGate>
                  )}
                />
                <Route
                  path="/cron"
                  element={(
                    <AuthGate>
                      <ErrorBoundary>
                        <CronPage />
                      </ErrorBoundary>
                    </AuthGate>
                  )}
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </AppShell>
          <TerminalDrawerMount />
          <FileBrowserDrawerMount />
          <ProcessManagerDrawerMount />
          <NotesDrawerMount />
          <Toaster position="top-center" />
          <EventBusManager />
          <ServerConfigLoader />
        </ErrorBoundary>
      </BrowserRouter>
      {import.meta.env.DEV ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>,
  )
}
