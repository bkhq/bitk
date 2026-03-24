import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getTokenMock } = vi.hoisted(() => ({
  getTokenMock: vi.fn<() => string | null>(),
}))

vi.mock('@/lib/auth', () => ({
  getToken: getTokenMock,
}))

// Minimal EventSource stub
class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  readyState = 0
  closed = false
  private listeners = new Map<string, Set<(e: unknown) => void>>()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, cb: (e: unknown) => void) {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(cb)
  }

  close() {
    this.closed = true
  }

  // Test helpers
  simulateOpen() {
    this.readyState = 1
    this.onopen?.()
  }

  simulateError() {
    this.onerror?.()
  }

  static reset() {
    MockEventSource.instances = []
  }
}

describe('eventBus', () => {
  let EventBusModule: typeof import('@/lib/event-bus')

  beforeEach(async () => {
    vi.useFakeTimers()
    getTokenMock.mockReset()
    getTokenMock.mockReturnValue(null)
    MockEventSource.reset()

    // Stub global EventSource
    vi.stubGlobal('EventSource', MockEventSource)

    // Fresh module import each test to get a clean EventBus singleton
    vi.resetModules()
    EventBusModule = await import('@/lib/event-bus')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('connect without token', () => {
    it('opens EventSource to /api/events without token param', () => {
      EventBusModule.eventBus.connect()
      expect(MockEventSource.instances).toHaveLength(1)
      expect(MockEventSource.instances[0].url).toBe('/api/events')
    })
  })

  describe('connect with token', () => {
    it('opens EventSource with token query param', () => {
      getTokenMock.mockReturnValue('my-jwt')
      EventBusModule.eventBus.connect()
      expect(MockEventSource.instances[0].url).toBe('/api/events?token=my-jwt')
    })
  })

  describe('reconnect behavior after successful connection', () => {
    it('reconnects after error when previously connected', () => {
      EventBusModule.eventBus.connect()
      const es = MockEventSource.instances[0]
      es.simulateOpen()
      es.simulateError()

      expect(MockEventSource.instances).toHaveLength(1) // closed, no new one yet
      vi.advanceTimersByTime(1_000)
      expect(MockEventSource.instances).toHaveLength(2) // reconnected
    })
  })

  describe('stops reconnecting after repeated initial failures', () => {
    it('gives up after MAX_INITIAL_FAILURES (5) without a successful connection', () => {
      EventBusModule.eventBus.connect()

      // Fail 5 times without ever connecting successfully
      for (let i = 0; i < 5; i++) {
        const es = MockEventSource.instances.at(-1)!
        es.simulateError()
        vi.advanceTimersByTime(2_000) // past INITIAL_RETRY_DELAY
      }

      // Should have stopped — no more instances created
      const countAfterGiveUp = MockEventSource.instances.length
      vi.advanceTimersByTime(60_000) // wait a long time
      expect(MockEventSource.instances).toHaveLength(countAfterGiveUp)
    })

    it('resets failure counter on successful connect', () => {
      EventBusModule.eventBus.connect()

      // Fail 3 times
      for (let i = 0; i < 3; i++) {
        MockEventSource.instances.at(-1)!.simulateError()
        vi.advanceTimersByTime(2_000)
      }

      // Now succeed
      MockEventSource.instances.at(-1)!.simulateOpen()

      // Trigger an error after success — should reconnect (exponential backoff for established connections)
      MockEventSource.instances.at(-1)!.simulateError()
      vi.advanceTimersByTime(1_000)
      const countBeforeWait = MockEventSource.instances.length
      // Should have reconnected since hasConnectedOnce = true
      expect(countBeforeWait).toBeGreaterThan(4)
    })
  })

  describe('disconnect stops reconnect loop', () => {
    it('disconnect cancels pending reconnect timer', () => {
      EventBusModule.eventBus.connect()
      MockEventSource.instances[0].simulateError()

      // Reconnect timer is pending
      EventBusModule.eventBus.disconnect()

      vi.advanceTimersByTime(10_000)
      // No new EventSource should be created after disconnect
      // Only the original (closed) one should exist
      expect(MockEventSource.instances).toHaveLength(1)
      expect(MockEventSource.instances[0].closed).toBe(true)
    })
  })

  describe('connection state notifications', () => {
    it('notifies listeners on connect and disconnect', () => {
      const listener = vi.fn()
      EventBusModule.eventBus.onConnectionChange(listener)

      // Immediately called with current state (false)
      expect(listener).toHaveBeenCalledWith(false)
      listener.mockClear()

      EventBusModule.eventBus.connect()
      MockEventSource.instances[0].simulateOpen()
      expect(listener).toHaveBeenCalledWith(true)
      listener.mockClear()

      EventBusModule.eventBus.disconnect()
      expect(listener).toHaveBeenCalledWith(false)
    })
  })
})
