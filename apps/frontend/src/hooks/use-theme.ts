import { useCallback, useSyncExternalStore } from 'react'

type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'bitk-theme'

function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // localStorage unavailable
  }
  return 'system'
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function applyTheme(theme: Theme) {
  const resolved = resolveTheme(theme)
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

// Simple pub-sub for cross-component sync
const listeners = new Set<() => void>()
let currentTheme: Theme = getStoredTheme()

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function getSnapshot(): Theme {
  return currentTheme
}

function setTheme(next: Theme) {
  currentTheme = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // noop
  }
  applyTheme(next)
  for (const cb of listeners) cb()
}

// Apply on load
applyTheme(currentTheme)

// React to system preference changes when in 'system' mode
if (typeof window !== 'undefined') {
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (currentTheme === 'system') {
        applyTheme('system')
        for (const cb of listeners) cb()
      }
    })
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot)

  const resolved = resolveTheme(theme)

  const toggle = useCallback(() => {
    setTheme(resolved === 'light' ? 'dark' : 'light')
  }, [resolved])

  return { theme, resolved, setTheme, toggle }
}
