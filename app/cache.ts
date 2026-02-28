const MAX_CACHE_ENTRIES = 500
const SWEEP_INTERVAL_MS = 5 * 60 * 1000

const store = new Map<string, unknown>()
const expiryMap = new Map<string, number>()
const accessOrder = new Map<string, number>() // LRU tracking

function evictExpired(): void {
  const now = Date.now()
  for (const [key, expiry] of expiryMap) {
    if (now >= expiry) {
      store.delete(key)
      expiryMap.delete(key)
      accessOrder.delete(key)
    }
  }
}

function evictLRU(): void {
  if (store.size <= MAX_CACHE_ENTRIES) return
  const entries = [...accessOrder.entries()].sort((a, b) => a[1] - b[1])
  const toRemove = entries.slice(0, store.size - MAX_CACHE_ENTRIES)
  for (const [key] of toRemove) {
    store.delete(key)
    expiryMap.delete(key)
    accessOrder.delete(key)
  }
}

// Periodic sweep of expired entries
const sweepTimer = setInterval(evictExpired, SWEEP_INTERVAL_MS)
if (sweepTimer && typeof sweepTimer === 'object' && 'unref' in sweepTimer) {
  sweepTimer.unref()
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const expiry = expiryMap.get(key)
  if (expiry !== undefined && Date.now() >= expiry) {
    store.delete(key)
    expiryMap.delete(key)
    accessOrder.delete(key)
    return null
  }
  const value = store.get(key) as T | undefined
  if (value !== undefined) {
    accessOrder.set(key, Date.now())
  }
  return value ?? null
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  store.set(key, value)
  accessOrder.set(key, Date.now())
  if (ttlSeconds !== undefined) {
    expiryMap.set(key, Date.now() + ttlSeconds * 1000)
  } else {
    expiryMap.delete(key)
  }
  evictLRU()
}

export async function cacheDel(key: string): Promise<void> {
  store.delete(key)
  expiryMap.delete(key)
  accessOrder.delete(key)
}
