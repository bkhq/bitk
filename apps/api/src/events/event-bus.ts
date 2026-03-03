import type { AppEventMap } from '@bitk/shared'

// ---------- Types ----------

type Callback<T> = (data: T) => void
type Middleware<T> = (data: T) => boolean // return false to suppress

interface SubscriberEntry {
  order: number
  callback: Callback<unknown>
}

// ---------- AppEventBus ----------

export class AppEventBus {
  private subscribers = new Map<string, SubscriberEntry[]>()
  private middlewares = new Map<string, Middleware<unknown>[]>()
  private needsSort = new Map<string, boolean>()

  /** Subscribe to an event with optional ordering (default 100). */
  on<K extends keyof AppEventMap>(
    event: K,
    cb: Callback<AppEventMap[K]>,
    opts?: { order?: number },
  ): () => void {
    const key = event as string
    let list = this.subscribers.get(key)
    if (!list) {
      list = []
      this.subscribers.set(key, list)
    }
    const entry: SubscriberEntry = {
      order: opts?.order ?? 100,
      callback: cb as Callback<unknown>,
    }
    list.push(entry)
    this.needsSort.set(key, true)

    return () => {
      const idx = list.indexOf(entry)
      if (idx >= 0) list.splice(idx, 1)
    }
  }

  /** Register middleware that runs before all subscribers. Return false to suppress. */
  use<K extends keyof AppEventMap>(
    event: K,
    fn: Middleware<AppEventMap[K]>,
  ): () => void {
    const key = event as string
    let mws = this.middlewares.get(key)
    if (!mws) {
      mws = []
      this.middlewares.set(key, mws)
    }
    const mw = fn as Middleware<unknown>
    mws.push(mw)

    return () => {
      const idx = mws.indexOf(mw)
      if (idx >= 0) mws.splice(idx, 1)
    }
  }

  /** Emit an event: middleware chain → sorted subscribers. */
  emit<K extends keyof AppEventMap>(event: K, data: AppEventMap[K]): void {
    const key = event as string

    // Run middleware chain — any returning false suppresses the event
    const mws = this.middlewares.get(key)
    if (mws) {
      for (const mw of mws) {
        try {
          if (!mw(data)) return
        } catch {
          /* middleware error — suppress event for safety */
          return
        }
      }
    }

    // Ensure subscribers are sorted by order
    const list = this.subscribers.get(key)
    if (!list || list.length === 0) return

    if (this.needsSort.get(key)) {
      list.sort((a, b) => a.order - b.order)
      this.needsSort.set(key, false)
    }

    // Dispatch to each subscriber independently
    for (const entry of list) {
      try {
        entry.callback(data)
      } catch {
        /* subscriber error — do not affect subsequent subscribers */
      }
    }
  }
}
