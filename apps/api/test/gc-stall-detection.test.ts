import { describe, expect, mock, test } from 'bun:test'
import {
  IDLE_TIMEOUT_MS,
  STALL_INTERRUPT_GRACE_MS,
  STALL_LIVENESS_GRACE_MS,
  STREAM_STALL_TIMEOUT_MS,
} from '@/engines/issue/constants'
import type { EngineContext } from '@/engines/issue/context'
import { gcSweep } from '@/engines/issue/gc'
import type { ManagedProcess } from '@/engines/issue/types'

/**
 * GC sweep stall detection tests — verifies:
 * 1. Three-tier stall detection: detect → wait for CLI retry → interrupt → kill
 * 2. Active processes with recent output are NOT killed
 * 3. Idle processes are killed after IDLE_TIMEOUT_MS (existing behavior)
 * 4. Stall state is cleared when activity resumes
 * 5. Dead processes are terminated immediately
 */

// ---------- Mock helpers ----------

function makeManagedProcess(
  overrides: Partial<ManagedProcess> & { issueId: string; executionId: string },
): ManagedProcess {
  return {
    engineType: 'claude-code',
    process: {
      subprocess: { pid: process.pid },
    } as unknown as ManagedProcess['process'],
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
    agents: [],
    plugins: [],
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
  test('Tier 1: detects stall and sets stallDetectedAt (non-destructive)', () => {
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

    // Should NOT be killed — only detected
    expect(forceKillCalls).not.toContain('exec-1')
    // stallDetectedAt should be set, stallProbeAt should NOT
    expect(managed.stallDetectedAt).toBeDefined()
    expect(managed.stallProbeAt).toBeUndefined()
  })

  test('Tier 2: sends interrupt after liveness grace period', () => {
    const stalledAt = new Date(
      Date.now() - STREAM_STALL_TIMEOUT_MS - STALL_LIVENESS_GRACE_MS - 60_000,
    )
    const detectedAt = new Date(Date.now() - STALL_LIVENESS_GRACE_MS - 60_000)
    const interruptMock = mock(() => {})
    const managed = makeManagedProcess({
      issueId: 'issue-1',
      executionId: 'exec-1',
      turnInFlight: true,
      lastActivityAt: stalledAt,
      stallDetectedAt: detectedAt,
      process: {
        subprocess: { pid: process.pid },
        protocolHandler: { interrupt: interruptMock },
      } as unknown as ManagedProcess['process'],
    })
    const { ctx, forceKillCalls } = makeContext([
      { id: 'exec-1', meta: managed },
    ])

    gcSweep(ctx)

    // Should NOT be killed yet — interrupt probe sent
    expect(forceKillCalls).not.toContain('exec-1')
    expect(managed.stallProbeAt).toBeDefined()
    expect(interruptMock).toHaveBeenCalled()
  })

  test('Tier 3: kills process if no response after interrupt grace period', () => {
    const stalledAt = new Date(
      Date.now() -
        STREAM_STALL_TIMEOUT_MS -
        STALL_LIVENESS_GRACE_MS -
        STALL_INTERRUPT_GRACE_MS -
        60_000,
    )
    const detectedAt = new Date(
      Date.now() - STALL_LIVENESS_GRACE_MS - STALL_INTERRUPT_GRACE_MS - 60_000,
    )
    const probeAt = new Date(Date.now() - STALL_INTERRUPT_GRACE_MS - 60_000)
    const managed = makeManagedProcess({
      issueId: 'issue-1',
      executionId: 'exec-1',
      turnInFlight: true,
      lastActivityAt: stalledAt,
      stallDetectedAt: detectedAt,
      stallProbeAt: probeAt,
    })
    const { ctx, forceKillCalls } = makeContext([
      { id: 'exec-1', meta: managed },
    ])

    gcSweep(ctx)

    expect(forceKillCalls).toContain('exec-1')
  })

  test('Tier 1: immediately kills dead process', () => {
    const stalledAt = new Date(Date.now() - STREAM_STALL_TIMEOUT_MS - 60_000)
    const managed = makeManagedProcess({
      issueId: 'issue-dead',
      executionId: 'exec-dead',
      turnInFlight: true,
      lastActivityAt: stalledAt,
      // Use a PID that doesn't exist
      process: {
        subprocess: { pid: 999999999 },
      } as unknown as ManagedProcess['process'],
    })
    const { ctx, forceKillCalls } = makeContext([
      { id: 'exec-dead', meta: managed },
    ])

    gcSweep(ctx)

    // Dead process should be terminated immediately at Tier 1
    expect(forceKillCalls).toContain('exec-dead')
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

  test('does NOT detect stall at exactly STREAM_STALL_TIMEOUT_MS (boundary)', () => {
    // Activity exactly at timeout boundary — should NOT be detected (must be strictly past)
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
    expect(managed.stallDetectedAt).toBeUndefined()
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

  test('handles multiple processes — detects stalled, skips active and idle', () => {
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

    // Tier 1: stalled is detected, not killed
    expect(forceKillCalls).not.toContain('exec-stalled')
    expect(stalledManaged.stallDetectedAt).toBeDefined()
    expect(stalledManaged.stallProbeAt).toBeUndefined()
    // Others untouched
    expect(forceKillCalls).not.toContain('exec-active')
    expect(forceKillCalls).not.toContain('exec-idle')
  })

  test('handles multiple processes — kills stalled after full escalation, skips others', () => {
    const stalledManaged = makeManagedProcess({
      issueId: 'issue-stalled',
      executionId: 'exec-stalled',
      turnInFlight: true,
      lastActivityAt: new Date(
        Date.now() -
          STREAM_STALL_TIMEOUT_MS -
          STALL_LIVENESS_GRACE_MS -
          STALL_INTERRUPT_GRACE_MS -
          120_000,
      ),
      stallDetectedAt: new Date(
        Date.now() -
          STALL_LIVENESS_GRACE_MS -
          STALL_INTERRUPT_GRACE_MS -
          120_000,
      ),
      stallProbeAt: new Date(Date.now() - STALL_INTERRUPT_GRACE_MS - 120_000),
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

    // Tier 3: stalled is killed after full escalation
    expect(forceKillCalls).toContain('exec-stalled')
    expect(forceKillCalls).not.toContain('exec-active')
    expect(forceKillCalls).not.toContain('exec-idle')
  })

  test('does NOT detect or kill process within stall timeout', () => {
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
    expect(managed.stallDetectedAt).toBeUndefined()
    expect(managed.stallProbeAt).toBeUndefined()
  })
})
