import { useEffect, useState } from 'react'
import { eventBus } from '@/lib/event-bus'

/**
 * Global SSE connection status hook.
 * The EventBus connects once at app startup (see main.tsx).
 * This hook just tracks the connection state for UI indicators.
 */
export function useEventConnection() {
  const [connected, setConnected] = useState(eventBus.isConnected())

  useEffect(() => {
    return eventBus.onConnectionChange(setConnected)
  }, [])

  return connected
}
