import type { EngineContext } from '../context'

// ---------- Per-issue mutex ----------

export async function withIssueLock<T>(
  ctx: EngineContext,
  issueId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const tail = ctx.issueOpLocks.get(issueId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const newTail = tail.then(() => gate)
  ctx.issueOpLocks.set(issueId, newTail)

  await tail
  try {
    return await fn()
  } finally {
    release()
    if (ctx.issueOpLocks.get(issueId) === newTail) {
      ctx.issueOpLocks.delete(issueId)
    }
  }
}
