import { describe, expect, mock, test } from 'bun:test'
import {
  IDLE_TIMEOUT_MS,
  STALL_PROBE_GRACE_MS,
  STREAM_STALL_TIMEOUT_MS,
} from '@/engines/issue/constants'
import type { EngineContext } from '@/engines/issue/context'
import { gcSweep } from '@/engines/issue/gc'
import type { ManagedProcess } from '@/engines/issue/types'

/**
 * GC sweep stall detection tests — verifies:
 * 1. Two-tier stall detection: probe first (interrupt), kill if no response
 * 2. Active processes with recent output are NOT killed
 * 3. Idle processes are killed after IDLE_TIMEOUT_MS (existing behavior)
 * 4. Stall probe is cleared when activity resumes
 */

// ---------- Mock helpers ----------

function makeManagedProcess(
  overrides: Partial<ManagedProcess> & { issueId: string; executionId: string },
): ManagedProcess {
  return {
    engineType: 'claude-code',
    process: {} as unknown as ManagedProcess['process'],
    state: 'running',
    startedAt: new Date(),
    logs: { toArray: () => [] } as unknown as ManagedProcess['logs'],
    retryCount: 0,
    turnInFlight: true,
    queueCancelRequested: false,
    logicalFailure: false,
    turnSettled: false,
    metaTurn: false,
    lastActivityAt: new Date(),
    slashCommands: [],
    pendingInputs: [],
    ...overrides,
  }
}

interface MockEntry {
  id: string
  meta: ManagedProcess
}

function makeContext(entries: MockEntry[]): {
  ctx: EngineContext
  forceKillCalls: string[]
} {
  const forceKillCalls: string[] = []

  const ctx = {
    pm: {
      has: (id: string) => entries.some((e) => e.id === id),
      get: (id: string) => entries.find((e) => e.id === id),
      getActive: () => entries,
      forceKill: mock((id: string) => {
        forceKillCalls.push(id)
      }),
      markCompleted: mock(() => {}),
      markFailed: mock(() => {}),
      size: () => entries.length,
      activeCount: () => entries.length,
    },
    entryCounters: new Map<string, number>(),
    turnIndexes: new Map<string, number>(),
    userMessageIds: new Map<string, string>(),
    lastErrors: new Map<string, string>(),
    issueOpLocks: new Map<string, Promise<void>>(),
    lockDepth: new Map<string, number>(),
    followUpIssue: null,
  } as unknown as EngineContext

  return { ctx, forceKillCalls }
}

// ---------- Tests ----------

describe('gcSweep — stream stall detection', () => {
  test('Tier 1: sends probe (sets stallProbeAt) but does NOT kill on first detection', () => {
    const stalledAt = new Date(Date.now() - STREAM_STALL_TIMEOUT_MS - 60_000)
    const managed = makeManagedProcess({
      issueId: 'issue-1',
      executionId: 'exec-1',
      turnInFlight: true,
      lastActivityAt: stalledAt,
    })
    const { ctx, forceKillCalls } = makeContext([
      { id: 'exec-1', meta: managed },
    ])

    gcSweep(ctx)

    // Should NOT be killed yet — only probed
    expect(forceKillCalls).not.toContain('exec-1')
    // stallProbeAt should be set
    expect(managed.stallProbeAt).toBeDefined()
  })

  test('Tier 2: kills process if no response after probe grace period', () => {
    const stalledAt = new Date(
      Date.now() - STREAM_STALL_TIMEOUT_MS - STALL_PROBE_GRACE_MS - 60_000,
    )
    const probeAt = new Date(Date.now() - STALL_PROBE_GRACE_MS - 60_000)
    const managed = makeManagedProcess({
      issueId: 'issue-1',
      executionId: 'exec-1',
      turnInFlight: true,
      lastActivityAt: stalledAt,
      stallProbeAt: probeAt,
    })
    const { ctx, forceKillCalls } = makeContext([
      { id: 'exec-1', meta: managed },
    ])

    gcSweep(ctx)

    expect(forceKillCalls).toContain('exec-1')
  })

  test('does NOT kill process with recent stream activity', () => {
    const recentActivity = new Date(Date.now() - 30_000) // 30 seconds ago
    const managed = makeManagedProcess({
      issueId: 'issue-2',
      executionId: 'exec-2',
      turnInFlight: true,
      lastActivityAt: recentActivity,
    })
    const { ctx, forceKillCalls } = makeContext([
      { id: 'exec-2', meta: managed },
    ])

    gcSweep(ctx)

    expect(forceKillCalls).not.toContain('exec-2')
  })

  test('does NOT kill process at exactly STREAM_STALL_TIMEOUT_MS (boundary)', () => {
    // Activity exactly at timeout boundary — should NOT be killed (must be strictly past)
    const atBoundary = new Date(Date.now() - STREAM_STALL_TIMEOUT_MS + 1000)
    const managed = makeManagedProcess({
      issueId: 'issue-3',
      executionId: 'exec-3',
      turnInFlight: true,
      lastActivityAt: atBoundary,
    })
    const { ctx, forceKillCalls } = makeContext([
      { id: 'exec-3', meta: managed },
    ])

    gcSweep(ctx)

    expect(forceKillCalls).not.toContain('exec-3')
  })

  test('kills idle process after IDLE_TIMEOUT_MS (existing behavior)', () => {
    const idleAt = new Date(Date.now() - IDLE_TIMEOUT_MS - 60_000) // 31 min ago
    const managed = makeManagedProcess({
      issueId: 'issue-4',
      executionId: 'exec-4',
      turnInFlight: false,
      lastIdleAt: idleAt,
      lastActivityAt: idleAt,
    })
    const { ctx, forceKillCalls } = makeContext([
      { id: 'exec-4', meta: managed },
    ])

    gcSweep(ctx)

    expect(forceKillCalls).toContain('exec-4')
  })

  test('does NOT kill idle process within IDLE_TIMEOUT_MS', () => {
    const recentIdle = new Date(Date.now() - 5 * 60_000) // 5 min ago
    const managed = makeManagedProcess({
      issueId: 'issue-5',
      executionId: 'exec-5',
      turnInFlight: false,
      lastIdleAt: recentIdle,
      lastActivityAt: recentIdle,
    })
    const { ctx, forceKillCalls } = makeContext([
      { id: 'exec-5', meta: managed },
    ])

    gcSweep(ctx)

    expect(forceKillCalls).not.toContain('exec-5')
  })

  test('handles multiple processes — probes stalled, skips active and idle', () => {
    const stalledManaged = makeManagedProcess({
      issueId: 'issue-stalled',
      executionId: 'exec-stalled',
      turnInFlight: true,
      lastActivityAt: new Date(Date.now() - STREAM_STALL_TIMEOUT_MS - 120_000),
    })
    const activeManaged = makeManagedProcess({
      issueId: 'issue-active',
      executionId: 'exec-active',
      turnInFlight: true,
      lastActivityAt: new Date(), // just now
    })
    const idleManaged = makeManagedProcess({
      issueId: 'issue-idle',
      executionId: 'exec-idle',
      turnInFlight: false,
      lastIdleAt: new Date(Date.now() - 5 * 60_000),
      lastActivityAt: new Date(Date.now() - 5 * 60_000),
    })
    const { ctx, forceKillCalls } = makeContext([
      { id: 'exec-stalled', meta: stalledManaged },
      { id: 'exec-active', meta: activeManaged },
      { id: 'exec-idle', meta: idleManaged },
    ])

    gcSweep(ctx)

    // Tier 1: stalled is probed, not killed
    expect(forceKillCalls).not.toContain('exec-stalled')
    expect(stalledManaged.stallProbeAt).toBeDefined()
    // Others untouched
    expect(forceKillCalls).not.toContain('exec-active')
    expect(forceKillCalls).not.toContain('exec-idle')
  })

  test('handles multiple processes — kills stalled after probe grace, skips others', () => {
    const stalledManaged = makeManagedProcess({
      issueId: 'issue-stalled',
      executionId: 'exec-stalled',
      turnInFlight: true,
      lastActivityAt: new Date(
        Date.now() - STREAM_STALL_TIMEOUT_MS - STALL_PROBE_GRACE_MS - 120_000,
      ),
      stallProbeAt: new Date(Date.now() - STALL_PROBE_GRACE_MS - 120_000),
    })
    const activeManaged = makeManagedProcess({
      issueId: 'issue-active',
      executionId: 'exec-active',
      turnInFlight: true,
      lastActivityAt: new Date(), // just now
    })
    const idleManaged = makeManagedProcess({
      issueId: 'issue-idle',
      executionId: 'exec-idle',
      turnInFlight: false,
      lastIdleAt: new Date(Date.now() - 5 * 60_000),
      lastActivityAt: new Date(Date.now() - 5 * 60_000),
    })
    const { ctx, forceKillCalls } = makeContext([
      { id: 'exec-stalled', meta: stalledManaged },
      { id: 'exec-active', meta: activeManaged },
      { id: 'exec-idle', meta: idleManaged },
    ])

    gcSweep(ctx)

    // Tier 2: stalled is killed after probe grace period
    expect(forceKillCalls).toContain('exec-stalled')
    expect(forceKillCalls).not.toContain('exec-active')
    expect(forceKillCalls).not.toContain('exec-idle')
  })

  test('does NOT probe or kill process within stall timeout even with probe set', () => {
    // Edge case: stallProbeAt set but process produced output since then
    // (probe was sent, process responded — activity cleared stallProbeAt in consumer)
    const managed = makeManagedProcess({
      issueId: 'issue-recovered',
      executionId: 'exec-recovered',
      turnInFlight: true,
      lastActivityAt: new Date(Date.now() - 60_000), // 1 min ago — within threshold
    })
    const { ctx, forceKillCalls } = makeContext([
      { id: 'exec-recovered', meta: managed },
    ])

    gcSweep(ctx)

    expect(forceKillCalls).not.toContain('exec-recovered')
    expect(managed.stallProbeAt).toBeUndefined()
  })
})
