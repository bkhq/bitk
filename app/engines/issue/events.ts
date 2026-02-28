import type { NormalizedLogEntry, ProcessStatus } from '../types'
import type { EngineContext } from './context'
import type {
  IssueSettledCallback,
  LogCallback,
  StateChangeCallback,
  UnsubscribeFn,
} from './types'
import { getIssueDevMode, isVisibleForMode } from './utils/visibility'

// ---------- Event subscriptions ----------

export function onLog(ctx: EngineContext, cb: LogCallback): UnsubscribeFn {
  const id = ctx.nextCallbackId++
  ctx.logCallbacks.set(id, cb)
  return () => {
    ctx.logCallbacks.delete(id)
  }
}

export function onStateChange(ctx: EngineContext, cb: StateChangeCallback): UnsubscribeFn {
  const id = ctx.nextCallbackId++
  ctx.stateChangeCallbacks.set(id, cb)
  return () => {
    ctx.stateChangeCallbacks.delete(id)
  }
}

export function onIssueSettled(ctx: EngineContext, cb: IssueSettledCallback): UnsubscribeFn {
  const id = ctx.nextCallbackId++
  ctx.issueSettledCallbacks.set(id, cb)
  return () => {
    ctx.issueSettledCallbacks.delete(id)
  }
}

// ---------- Event emitters ----------

export function emitLog(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
  entry: NormalizedLogEntry,
): void {
  const devMode = getIssueDevMode(issueId)
  if (!isVisibleForMode(entry, devMode)) return
  for (const cb of ctx.logCallbacks.values()) {
    try {
      cb(issueId, executionId, entry)
    } catch {
      /* ignore */
    }
  }
}

export function emitStateChange(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
  state: ProcessStatus,
): void {
  for (const cb of ctx.stateChangeCallbacks.values()) {
    try {
      cb(issueId, executionId, state)
    } catch {
      /* ignore */
    }
  }
}

export function emitIssueSettled(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
  state: string,
): void {
  for (const cb of ctx.issueSettledCallbacks.values()) {
    try {
      cb(issueId, executionId, state)
    } catch {
      /* ignore */
    }
  }
}
