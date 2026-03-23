import { registerAction } from '../registry'
import { runIssueLogRetention } from './issue-log-retention'
import { runLogCleanup } from './log-cleanup'
import { runUploadCleanup } from './upload-cleanup'
import { runWorktreeCleanup } from './worktree-cleanup'

registerAction('upload-cleanup', {
  description: 'Remove uploaded files older than 7 days',
  category: 'builtin',
  defaultCron: '0 0 * * * *', // every hour
  handler: () => runUploadCleanup(),
})

registerAction('worktree-cleanup', {
  description: 'Remove git worktrees for done issues older than 1 day',
  category: 'builtin',
  defaultCron: '0 */30 * * * *', // every 30 minutes
  runOnStartup: true,
  handler: () => runWorktreeCleanup(),
})

registerAction('log-cleanup', {
  description: 'Trim cron job logs to keep last 1000 per job',
  category: 'builtin',
  defaultCron: '0 0 3 * * *', // daily at 3 AM
  handler: () => runLogCleanup(),
})

registerAction('issue-log-retention', {
  description: 'Delete issue logs for done issues older than retention period (default 30 days, configurable via appSettings)',
  category: 'builtin',
  defaultCron: '0 0 4 * * *', // daily at 4 AM
  handler: () => runIssueLogRetention(),
})
