import type { AppEventMap } from '@bitk/shared'
import { logger } from '@/logger'

// ---------- Types ----------

type Callback<T> = (data: T) => void

interface SubscriberEntry {
  order: number
  callback: Callback<unknown>
}

// ---------- AppEventBus ----------

export class AppEventBus {
  private subscribers = new Map<string, SubscriberEntry[]>()
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

  /** Emit an event to all sorted subscribers. */
  emit<K extends keyof AppEventMap>(event: K, data: AppEventMap[K]): void {
    const key = event as string

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
      } catch (err) {
        logger.warn(
          { event: key, order: entry.order, err },
          'event_subscriber_error',
        )
      }
    }
  }
}
