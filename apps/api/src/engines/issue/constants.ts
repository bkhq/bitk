export const MAX_LOG_ENTRIES = 10000
export const AUTO_CLEANUP_DELAY_MS = 5 * 60 * 1000 // 5 minutes
export const MAX_AUTO_RETRIES = 1
export const GC_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes
export const MAX_CONCURRENT_EXECUTIONS =
  Number(process.env.MAX_CONCURRENT_EXECUTIONS) || 5
export const WORKTREE_DIR = '.bitk/worktrees'
