import type {
  IssueSettledCallback,
  LogCallback,
  ManagedProcess,
  StateChangeCallback,
} from './types'
import type { ProcessManager } from '@/engines/process-manager'
import type { PermissionPolicy } from '@/engines/types'

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
  readonly lastErrors: Map<string, string>
  /** Injected function reference — breaks lifecycle → orchestration cycle. */
  followUpIssue:
    | ((
        issueId: string,
        prompt: string,
        model?: string,
        permissionMode?: PermissionPolicy,
        busyAction?: 'queue' | 'cancel',
        displayPrompt?: string,
        metadata?: Record<string, unknown>,
      ) => Promise<{ executionId: string; messageId?: string | null }>)
    | null
}
