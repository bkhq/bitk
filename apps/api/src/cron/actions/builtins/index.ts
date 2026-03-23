import { registerAction } from '../registry'
import { runLogCleanup } from './log-cleanup'
import { runUploadCleanup } from './upload-cleanup'
import { runWorktreeCleanup } from './worktree-cleanup'

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
