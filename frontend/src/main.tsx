import { lazy, Suspense } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { TerminalDrawer } from './components/terminal/TerminalDrawer'
import { useTerminalStore } from './stores/terminal-store'
import { eventBus } from './lib/event-bus'
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

// Global SSE connection — connects once at startup, client-side filtering
eventBus.connect()
// Invalidate all queries on SSE reconnect so stale statuses get refreshed
eventBus.onConnectionChange((connected) => {
  if (connected) queryClient.invalidateQueries()
})
// Invalidate issue queries when any issue status changes via SSE
eventBus.onIssueUpdated(() => {
  queryClient.invalidateQueries({ queryKey: ['projects'] })
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
        predicate: (q) => q.queryKey.includes('changes'),
      })
    }, 2000)
  })
}

const HomePage = lazy(() => import('./pages/HomePage'))
const KanbanPage = lazy(() => import('./pages/KanbanPage'))
const IssueDetailPage = lazy(() => import('./pages/IssueDetailPage'))
const TerminalPage = lazy(() => import('./pages/TerminalPage'))

function AppShell({ children }: { children: React.ReactNode }) {
  const isOpen = useTerminalStore((s) => s.isOpen)
  const isFullscreen = useTerminalStore((s) => s.isFullscreen)
  const height = useTerminalStore((s) => s.height)

  // When terminal is open (not fullscreen), shrink main content to avoid overlap
  const offset = isOpen && !isFullscreen ? height : 0

  return (
    <div
      className="w-full"
      style={{ height: offset ? `calc(100dvh - ${offset}px)` : '100dvh' }}
    >
      {children}
    </div>
  )
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
              fallback={
                <div className="flex h-full items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
              }
            >
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/projects/:projectId" element={<KanbanPage />} />
                <Route
                  path="/projects/:projectId/issues"
                  element={<IssueDetailPage />}
                />
                <Route
                  path="/projects/:projectId/issues/:issueId"
                  element={<IssueDetailPage />}
                />
                <Route path="/terminal" element={<TerminalPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </AppShell>
          <TerminalDrawer />
        </ErrorBoundary>
      </BrowserRouter>
      {import.meta.env.DEV ? (
        <ReactQueryDevtools initialIsOpen={false} />
      ) : null}
    </QueryClientProvider>,
  )
}
