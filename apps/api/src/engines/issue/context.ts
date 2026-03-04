import type { ProcessManager } from '@/engines/process-manager'
import type { PermissionPolicy } from '@/engines/types'
import type { ManagedProcess } from './types'

// ---------- EngineContext ----------

export interface EngineContext {
  readonly pm: ProcessManager<ManagedProcess>
  readonly issueOpLocks: Map<string, Promise<void>>
  readonly entryCounters: Map<string, number>
  readonly turnIndexes: Map<string, number>
  readonly userMessageIds: Map<string, string>
  readonly lastErrors: Map<string, string>
  /** Per-issue lock queue depth tracking. */
  readonly lockDepth: Map<string, number>
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
        opts?: { skipPersistMessage?: boolean },
      ) => Promise<{ executionId: string; messageId?: string | null }>)
    | null
}
