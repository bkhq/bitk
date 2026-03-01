import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { ProcessState } from './process-manager'
import { ProcessManager } from './process-manager'

// ---------- Helpers ----------

/** Spawn a real `sleep` subprocess that we can control */
function spawnSleep(seconds = 60) {
  return Bun.spawn(['sleep', String(seconds)])
}

/** Spawn a process that exits immediately with the given code */
function spawnExit(code = 0) {
  return Bun.spawn(['sh', '-c', `exit ${code}`])
}

interface TestMeta {
  label: string
}

function createPM(
  opts?: ConstructorParameters<typeof ProcessManager<TestMeta>>[1],
) {
  return new ProcessManager<TestMeta>('test', {
    autoCleanupDelayMs: 0,
    gcIntervalMs: 0,
    killTimeoutMs: 1000,
    ...opts,
  })
}

// ---------- Tests ----------

describe('ProcessManager', () => {
  let pm: ProcessManager<TestMeta>

  beforeEach(() => {
    pm = createPM()
  })

  afterEach(async () => {
    await pm.dispose()
  })

  // ---- Registration ----

  describe('register', () => {
    test('registers a process and returns entry', () => {
      const proc = spawnSleep()
      const entry = pm.register('a', proc, { label: 'test' })
      expect(entry.id).toBe('a')
      expect(entry.state).toBe('spawning')
      expect(entry.meta.label).toBe('test')
      expect(pm.has('a')).toBe(true)
      expect(pm.size()).toBe(1)
    })

    test('registers with startAsRunning', () => {
      const proc = spawnSleep()
      const entry = pm.register(
        'a',
        proc,
        { label: 'test' },
        { startAsRunning: true },
      )
      expect(entry.state).toBe('running')
    })

    test('registers with group', () => {
      const proc = spawnSleep()
      pm.register('a', proc, { label: 'test' }, { group: 'g1' })
      expect(pm.hasActiveInGroup('g1')).toBe(true)
    })

    test('rejects duplicate ID', () => {
      const proc = spawnSleep()
      pm.register('a', proc, { label: 'test' })
      expect(() => pm.register('a', spawnSleep(), { label: 'dup' })).toThrow(
        'already registered',
      )
    })

    test('rejects when concurrency limit reached', () => {
      const pm2 = createPM({ maxConcurrent: 1 })
      pm2.register(
        'a',
        spawnSleep(),
        { label: 'first' },
        { startAsRunning: true },
      )
      expect(() =>
        pm2.register(
          'b',
          spawnSleep(),
          { label: 'second' },
          { startAsRunning: true },
        ),
      ).toThrow('Concurrency limit')
      void pm2.dispose()
    })

    test('allows registration after terminal process frees slot', async () => {
      const pm2 = createPM({ maxConcurrent: 1 })
      pm2.register(
        'a',
        spawnSleep(),
        { label: 'first' },
        { startAsRunning: true },
      )
      pm2.markCompleted('a')
      // Now slot is free
      const entry = pm2.register(
        'b',
        spawnSleep(),
        { label: 'second' },
        { startAsRunning: true },
      )
      expect(entry.id).toBe('b')
      await pm2.dispose()
    })
  })

  // ---- State Transitions ----

  describe('state transitions', () => {
    test('spawning → running', () => {
      pm.register('a', spawnSleep(), { label: 'test' })
      pm.markRunning('a')
      expect(pm.get('a')?.state).toBe('running')
    })

    test('running → completed', () => {
      pm.register(
        'a',
        spawnSleep(),
        { label: 'test' },
        { startAsRunning: true },
      )
      pm.markCompleted('a')
      expect(pm.get('a')?.state).toBe('completed')
      expect(pm.get('a')?.finishedAt).toBeInstanceOf(Date)
    })

    test('running → failed', () => {
      pm.register(
        'a',
        spawnSleep(),
        { label: 'test' },
        { startAsRunning: true },
      )
      pm.markFailed('a')
      expect(pm.get('a')?.state).toBe('failed')
    })

    test('terminal state is idempotent (no-op)', () => {
      pm.register(
        'a',
        spawnSleep(),
        { label: 'test' },
        { startAsRunning: true },
      )
      pm.markCompleted('a')
      const finishedAt = pm.get('a')?.finishedAt
      pm.markFailed('a') // should be no-op
      expect(pm.get('a')?.state).toBe('completed')
      expect(pm.get('a')?.finishedAt).toBe(finishedAt)
    })

    test('markRunning on unknown id is no-op', () => {
      pm.markRunning('nonexistent')
      // no throw
    })
  })

  // ---- Termination ----

  describe('terminate', () => {
    test('terminates a running process', async () => {
      pm.register(
        'a',
        spawnSleep(),
        { label: 'test' },
        { startAsRunning: true },
      )
      await pm.terminate('a')
      expect(pm.get('a')?.state).toBe('cancelled')
      expect(pm.get('a')?.finishedAt).toBeInstanceOf(Date)
    })

    test('calls interruptFn before killing', async () => {
      let interrupted = false
      pm.register(
        'a',
        spawnSleep(),
        { label: 'test' },
        { startAsRunning: true },
      )
      await pm.terminate('a', () => {
        interrupted = true
      })
      expect(interrupted).toBe(true)
    })

    test('is no-op on already terminal process', async () => {
      pm.register(
        'a',
        spawnSleep(),
        { label: 'test' },
        { startAsRunning: true },
      )
      pm.markCompleted('a')
      await pm.terminate('a') // no throw, no-op
      expect(pm.get('a')?.state).toBe('completed')
    })

    test('is no-op on unknown id', async () => {
      await pm.terminate('nonexistent') // no throw
    })

    test('terminateGroup terminates all in group', async () => {
      pm.register(
        'a',
        spawnSleep(),
        { label: '1' },
        { group: 'g', startAsRunning: true },
      )
      pm.register(
        'b',
        spawnSleep(),
        { label: '2' },
        { group: 'g', startAsRunning: true },
      )
      pm.register(
        'c',
        spawnSleep(),
        { label: '3' },
        { group: 'other', startAsRunning: true },
      )
      await pm.terminateGroup('g')
      expect(pm.get('a')?.state).toBe('cancelled')
      expect(pm.get('b')?.state).toBe('cancelled')
      expect(pm.get('c')?.state).toBe('running')
    })

    test('terminateAll terminates all entries', async () => {
      pm.register('a', spawnSleep(), { label: '1' }, { startAsRunning: true })
      pm.register('b', spawnSleep(), { label: '2' }, { startAsRunning: true })
      await pm.terminateAll()
      expect(pm.get('a')?.state).toBe('cancelled')
      expect(pm.get('b')?.state).toBe('cancelled')
    })

    test('forceKill sends SIGKILL immediately', async () => {
      const proc = spawnSleep()
      pm.register('a', proc, { label: 'test' }, { startAsRunning: true })
      pm.forceKill('a')
      expect(pm.get('a')?.state).toBe('cancelled')
      expect(pm.get('a')?.finishedAt).toBeInstanceOf(Date)
      // Wait for process to exit
      await proc.exited
    })

    test('forceKill on unknown id is no-op', () => {
      pm.forceKill('nonexistent') // no throw
    })
  })

  // ---- Queries ----

  describe('queries', () => {
    test('get returns entry or undefined', () => {
      pm.register('a', spawnSleep(), { label: 'test' })
      expect(pm.get('a')).toBeDefined()
      expect(pm.get('x')).toBeUndefined()
    })

    test('getActive returns only non-terminal entries', () => {
      pm.register('a', spawnSleep(), { label: '1' }, { startAsRunning: true })
      pm.register('b', spawnSleep(), { label: '2' }, { startAsRunning: true })
      pm.markCompleted('b')
      const active = pm.getActive()
      expect(active.length).toBe(1)
      expect(active[0]!.id).toBe('a')
    })

    test('getActiveInGroup filters by group', () => {
      pm.register(
        'a',
        spawnSleep(),
        { label: '1' },
        { group: 'g1', startAsRunning: true },
      )
      pm.register(
        'b',
        spawnSleep(),
        { label: '2' },
        { group: 'g2', startAsRunning: true },
      )
      pm.register(
        'c',
        spawnSleep(),
        { label: '3' },
        { group: 'g1', startAsRunning: true },
      )
      const g1Active = pm.getActiveInGroup('g1')
      expect(g1Active.length).toBe(2)
      expect(pm.getActiveInGroup('g2').length).toBe(1)
      expect(pm.getActiveInGroup('none').length).toBe(0)
    })

    test('getFirstActiveInGroup returns first active', () => {
      pm.register(
        'a',
        spawnSleep(),
        { label: '1' },
        { group: 'g1', startAsRunning: true },
      )
      pm.register(
        'b',
        spawnSleep(),
        { label: '2' },
        { group: 'g1', startAsRunning: true },
      )
      const first = pm.getFirstActiveInGroup('g1')
      expect(first).toBeDefined()
      expect(pm.getFirstActiveInGroup('none')).toBeUndefined()
    })

    test('hasActiveInGroup returns boolean', () => {
      pm.register(
        'a',
        spawnSleep(),
        { label: 'test' },
        { group: 'g1', startAsRunning: true },
      )
      expect(pm.hasActiveInGroup('g1')).toBe(true)
      expect(pm.hasActiveInGroup('none')).toBe(false)
    })

    test('activeCount counts non-terminal entries', () => {
      pm.register('a', spawnSleep(), { label: '1' }, { startAsRunning: true })
      pm.register('b', spawnSleep(), { label: '2' }, { startAsRunning: true })
      expect(pm.activeCount()).toBe(2)
      pm.markCompleted('a')
      expect(pm.activeCount()).toBe(1)
    })

    test('size returns total entries', () => {
      pm.register('a', spawnSleep(), { label: '1' })
      pm.register('b', spawnSleep(), { label: '2' })
      expect(pm.size()).toBe(2)
    })
  })

  // ---- Events ----

  describe('events', () => {
    test('onStateChange fires on transition', () => {
      const changes: Array<{
        id: string
        prev: ProcessState
        next: ProcessState
      }> = []
      pm.onStateChange((entry, prev, next) => {
        changes.push({ id: entry.id, prev, next })
      })
      pm.register('a', spawnSleep(), { label: 'test' })
      pm.markRunning('a')
      pm.markCompleted('a')

      expect(changes.length).toBe(2)
      expect(changes[0]).toEqual({ id: 'a', prev: 'spawning', next: 'running' })
      expect(changes[1]).toEqual({
        id: 'a',
        prev: 'running',
        next: 'completed',
      })
    })

    test('onStateChange unsubscribe works', () => {
      const changes: string[] = []
      const unsub = pm.onStateChange((entry) => {
        changes.push(entry.id)
      })
      pm.register('a', spawnSleep(), { label: 'test' })
      pm.markRunning('a')
      expect(changes.length).toBe(1)

      unsub()
      pm.markCompleted('a')
      expect(changes.length).toBe(1) // no new events
    })

    test('onExit fires when process exits', async () => {
      const exits: Array<{ id: string; code: number }> = []
      pm.onExit((entry, code) => {
        exits.push({ id: entry.id, code })
      })

      const proc = spawnExit(0)
      pm.register('a', proc, { label: 'test' }, { startAsRunning: true })

      // Wait for process to exit
      await proc.exited
      // Small delay for async handler
      await Bun.sleep(50)

      expect(exits.length).toBe(1)
      expect(exits[0]!.code).toBe(0)
    })

    test('onExit fires with non-zero exit code', async () => {
      const exits: Array<{ id: string; code: number }> = []
      pm.onExit((entry, code) => {
        exits.push({ id: entry.id, code })
      })

      const proc = spawnExit(42)
      pm.register('a', proc, { label: 'test' }, { startAsRunning: true })

      await proc.exited
      await Bun.sleep(50)

      expect(exits.length).toBe(1)
      expect(exits[0]!.code).toBe(42)
      expect(pm.get('a')?.state).toBe('failed')
    })

    test('onExit unsubscribe works', async () => {
      const exits: string[] = []
      const unsub = pm.onExit((entry) => {
        exits.push(entry.id)
      })
      unsub()

      const proc = spawnExit(0)
      pm.register('a', proc, { label: 'test' }, { startAsRunning: true })
      await proc.exited
      await Bun.sleep(50)

      expect(exits.length).toBe(0)
    })

    test('monitorExit auto-completes on exit code 0', async () => {
      const proc = spawnExit(0)
      pm.register('a', proc, { label: 'test' }, { startAsRunning: true })

      await proc.exited
      await Bun.sleep(50)

      expect(pm.get('a')?.state).toBe('completed')
      expect(pm.get('a')?.exitCode).toBe(0)
    })

    test('monitorExit auto-fails on non-zero exit code', async () => {
      const proc = spawnExit(1)
      pm.register('a', proc, { label: 'test' }, { startAsRunning: true })

      await proc.exited
      await Bun.sleep(50)

      expect(pm.get('a')?.state).toBe('failed')
      expect(pm.get('a')?.exitCode).toBe(1)
    })

    test('monitorExit is idempotent with manual transition', async () => {
      const proc = spawnExit(0)
      pm.register('a', proc, { label: 'test' }, { startAsRunning: true })

      // Manually mark as failed before process exits
      pm.markFailed('a')

      await proc.exited
      await Bun.sleep(50)

      // Should stay failed (terminal state is sticky)
      expect(pm.get('a')?.state).toBe('failed')
    })
  })

  // ---- Remove & Cleanup ----

  describe('remove', () => {
    test('removes entry and cleans group index', () => {
      pm.register('a', spawnSleep(), { label: 'test' }, { group: 'g1' })
      expect(pm.size()).toBe(1)
      pm.remove('a')
      expect(pm.size()).toBe(0)
      expect(pm.hasActiveInGroup('g1')).toBe(false)
    })

    test('remove unknown id is no-op', () => {
      pm.remove('nonexistent') // no throw
    })
  })

  describe('auto cleanup', () => {
    test('auto-removes after delay', async () => {
      const pm2 = createPM({ autoCleanupDelayMs: 100 })
      pm2.register(
        'a',
        spawnSleep(),
        { label: 'test' },
        { startAsRunning: true },
      )
      pm2.markCompleted('a')
      expect(pm2.has('a')).toBe(true)

      await Bun.sleep(200)
      expect(pm2.has('a')).toBe(false)
      await pm2.dispose()
    })
  })

  // ---- Dispose ----

  describe('dispose', () => {
    test('terminates all processes and clears state', async () => {
      pm.register('a', spawnSleep(), { label: '1' }, { startAsRunning: true })
      pm.register('b', spawnSleep(), { label: '2' }, { startAsRunning: true })
      await pm.dispose()
      expect(pm.size()).toBe(0)
      expect(pm.activeCount()).toBe(0)
    })
  })

  // ---- GC ----

  describe('gc', () => {
    test('gc removes terminal entries without cleanup timers', async () => {
      // GC enabled PM with short interval
      const pm3 = createPM({ gcIntervalMs: 100, autoCleanupDelayMs: 0 })
      pm3.register('a', spawnSleep(), { label: '1' }, { startAsRunning: true })
      pm3.markCompleted('a')
      expect(pm3.has('a')).toBe(true)

      // Wait for GC cycle
      await Bun.sleep(200)
      expect(pm3.has('a')).toBe(false)
      await pm3.dispose()
    })
  })
})
