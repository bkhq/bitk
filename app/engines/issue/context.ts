import type { ProcessManager } from '../process-manager'
import type { PermissionPolicy, SpawnedProcess } from '../types'
import type {
  IssueSettledCallback,
  LogCallback,
  ManagedProcess,
  StateChangeCallback,
} from './types'

// ---------- EngineContext ----------

export interface EngineContext {
  readonly pm: ProcessManager<ManagedProcess>
  readonly issueOpLocks: Map<string, Promise<void>>
  readonly entryCounters: Map<string, number>
  readonly turnIndexes: Map<string, number>
  readonly userMessageIds: Map<string, string>
  readonly logCallbacks: Map<number, LogCallback>
  readonly stateChangeCallbacks: Map<number, StateChangeCallback>
  readonly issueSettledCallbacks: Map<number, IssueSettledCallback>
  nextCallbackId: number
  /** Injected function reference — breaks lifecycle → orchestration cycle. */
  followUpIssue: (
    issueId: string,
    prompt: string,
    model?: string,
    permissionMode?: PermissionPolicy,
    busyAction?: 'queue' | 'cancel',
    displayPrompt?: string,
    metadata?: Record<string, unknown>,
  ) => Promise<{ executionId: string; messageId?: string | null }>
}

// ---------- PID helpers ----------

export function getPidFromManaged(managed: ManagedProcess): number | undefined {
  return getPidFromSubprocess(managed.process.subprocess)
}

export function getPidFromSubprocess(subprocess: SpawnedProcess['subprocess']): number | undefined {
  const maybePid = (subprocess as { pid?: number }).pid
  return typeof maybePid === 'number' ? maybePid : undefined
}
