import { describe, expect, test } from 'bun:test'
import type { EngineContext } from '../src/engines/issue/context'
import { withIssueLock } from '../src/engines/issue/process/lock'
import './setup'

function createContext(): EngineContext {
  return {
    pm: {} as any,
    issueOpLocks: new Map(),
    entryCounters: new Map(),
    turnIndexes: new Map(),
    userMessageIds: new Map(),
    lastErrors: new Map(),
    lockDepth: new Map(),
    followUpIssue: null,
  }
}

describe('withIssueLock deep behavior', () => {
  test('serializes operations for the same issue', async () => {
    const ctx = createContext()
    const issueId = 'lock-serial-1'
    const order: string[] = []

    const first = withIssueLock(ctx, issueId, async () => {
      order.push('first:start')
      await Bun.sleep(25)
      order.push('first:end')
      return 'first'
    })

    const second = withIssueLock(ctx, issueId, async () => {
      order.push('second:start')
      order.push('second:end')
      return 'second'
    })

    await expect(first).resolves.toBe('first')
    await expect(second).resolves.toBe('second')

    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
    expect(ctx.lockDepth.size).toBe(0)
    expect(ctx.issueOpLocks.size).toBe(0)
  })

  test('rejects when lock queue depth exceeds max threshold', async () => {
    const ctx = createContext()
    const issueId = 'lock-queue-depth-1'

    let releaseFirst: (() => void) | null = null
    const first = withIssueLock(ctx, issueId, async () => {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
    })

    // Let the first call become the lock holder.
    await Bun.sleep(5)

    // Current implementation counts active holder + queued entries in lockDepth.
    const queued = Array.from({ length: 9 }, () => withIssueLock(ctx, issueId, async () => {}))

    await expect(withIssueLock(ctx, issueId, async () => {})).rejects.toThrow('Lock queue full')

    if (!releaseFirst) {
      throw new Error('failed to capture releaseFirst')
    }
    ;(releaseFirst as () => void)()
    await first
    await Promise.all(queued)
    expect(ctx.lockDepth.size).toBe(0)
    expect(ctx.issueOpLocks.size).toBe(0)
  })

  test('acquire timeout restores previous tail instead of dropping lock chain', async () => {
    const ctx = createContext()
    const issueId = 'lock-timeout-restore-1'
    const never = new Promise<void>(() => {})
    ctx.issueOpLocks.set(issueId, never)
    ctx.lockDepth.set(issueId, 1)

    const originalSetTimeout = globalThis.setTimeout
    ;(globalThis as any).setTimeout = ((handler: any, timeout?: number) => {
      const ms = timeout === 30_000 ? 15 : timeout
      return originalSetTimeout(handler, ms)
    }) as typeof setTimeout

    try {
      await expect(withIssueLock(ctx, issueId, async () => 'unreachable')).rejects.toThrow(
        'Lock acquire timeout',
      )

      expect(ctx.issueOpLocks.get(issueId)).toBe(never)
      expect(ctx.lockDepth.get(issueId)).toBe(1)
    } finally {
      ;(globalThis as any).setTimeout = originalSetTimeout
    }
  })
})
