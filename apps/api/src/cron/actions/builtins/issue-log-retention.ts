import { and, count as countFn, eq, inArray, lt } from 'drizzle-orm'
import { db } from '@/db'
import { getAppSetting } from '@/db/helpers'
import { issueLogs, issuesLogsToolsCall, issues as issuesTable } from '@/db/schema'
import { logger } from '@/logger'

export const LOG_RETENTION_DAYS_KEY = 'log:retentionDays'
const DEFAULT_RETENTION_DAYS = 30
const MAX_BATCH = 500

async function getRetentionDays(): Promise<number> {
  const value = await getAppSetting(LOG_RETENTION_DAYS_KEY)
  if (!value) return DEFAULT_RETENTION_DAYS
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) || parsed < 1 ? DEFAULT_RETENTION_DAYS : parsed
}

export async function runIssueLogRetention(): Promise<string> {
  const retentionDays = await getRetentionDays()
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)

  // Find done issues with statusUpdatedAt older than cutoff
  const eligibleIssues = await db
    .select({ id: issuesTable.id })
    .from(issuesTable)
    .where(
      and(
        eq(issuesTable.statusId, 'done'),
        eq(issuesTable.isDeleted, 0),
        lt(issuesTable.statusUpdatedAt, cutoff),
      ),
    )
    .limit(MAX_BATCH)

  if (eligibleIssues.length === 0) return 'no issues eligible for log retention'

  const issueIds = eligibleIssues.map(i => i.id)

  // Count logs to delete
  const [{ cnt: logCount }] = await db
    .select({ cnt: countFn() })
    .from(issueLogs)
    .where(inArray(issueLogs.issueId, issueIds))

  if (logCount === 0) return 'no logs to clean up'

  // Delete tool call records first (references issueLogs)
  const [{ cnt: toolCallCount }] = await db
    .select({ cnt: countFn() })
    .from(issuesLogsToolsCall)
    .where(inArray(issuesLogsToolsCall.issueId, issueIds))

  await db.transaction(async (tx) => {
    if (toolCallCount > 0) {
      await tx
        .delete(issuesLogsToolsCall)
        .where(inArray(issuesLogsToolsCall.issueId, issueIds))
    }
    await tx
      .delete(issueLogs)
      .where(inArray(issueLogs.issueId, issueIds))
  })

  logger.info(
    { issueCount: issueIds.length, logCount, toolCallCount, retentionDays },
    'issue_log_retention_done',
  )
  return `deleted ${logCount} logs and ${toolCallCount} tool calls from ${issueIds.length} issues (retention: ${retentionDays} days)`
}
