import { runLogCleanup } from '../tasks/log-cleanup'
import { runUploadCleanup } from '../tasks/upload-cleanup'
import { runWorktreeCleanup } from '../tasks/worktree-cleanup'
import { registerAction } from './registry'

registerAction('upload-cleanup', {
  description: 'Remove uploaded files older than 7 days',
  category: 'builtin',
  handler: () => runUploadCleanup(),
})

registerAction('worktree-cleanup', {
  description: 'Remove git worktrees for done issues older than 1 day',
  category: 'builtin',
  handler: () => runWorktreeCleanup(),
})

registerAction('log-cleanup', {
  description: 'Trim cron job logs to keep last 1000 per job',
  category: 'builtin',
  handler: () => runLogCleanup(),
})
