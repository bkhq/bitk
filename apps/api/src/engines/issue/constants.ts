export const MAX_LOG_ENTRIES = 10000
export const AUTO_CLEANUP_DELAY_MS = 5 * 60 * 1000 // 5 minutes
export const MAX_AUTO_RETRIES = 1
// Stall detection timeline:
//   T+2m: first check — if process alive, wait for CLI internal retry
//   T+4m: second check (process alive 2min after first probe) — send interrupt
//   T+6m: no response after interrupt — force kill
export const GC_INTERVAL_MS = 60 * 1000 // 1 minute — frequent stall detection
export const MAX_CONCURRENT_EXECUTIONS =
  Number(process.env.MAX_CONCURRENT_EXECUTIONS) || 5
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
export const STREAM_STALL_TIMEOUT_MS = 2 * 60 * 1000 // 2 minutes — check process liveness (non-destructive)
export const STALL_LIVENESS_GRACE_MS = 2 * 60 * 1000 // 2 minutes — wait for CLI internal retry before sending interrupt
export const STALL_INTERRUPT_GRACE_MS = 2 * 60 * 1000 // 2 minutes — kill process if no response after interrupt
export const CANCEL_RESPONSE_TIMEOUT_MS = 5_000 // 5s — wait for turn completion after each interrupt retry
export const CANCEL_MAX_RETRIES = 3 // send interrupt up to 3 times before hard kill (worst case: 3 × 5s = 15s)
export const WORKTREE_DIR = process.env.WORKTREE_DIR || 'worktrees'
