import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { issues as issuesTable } from '../../db/schema'
import { emitIssueUpdated } from '../../events/issue-events'
import { logger } from '../../logger'

// ---------- Auto-title prompt ----------

export const AUTO_TITLE_PROMPT = '请总结一下当前会话以<bitk>简短信息</bitk>格式返回，不超过15个字'

// ---------- Title extraction ----------

const TITLE_RE = /<bitk>(.*?)<\/bitk>/

export function extractTitle(content: string): string | null {
  const match = content.match(TITLE_RE)
  const title = match?.[1]?.trim().slice(0, 200)
  return title || null
}

// ---------- Persist extracted title ----------

export function applyAutoTitle(issueId: string, content: string): void {
  const title = extractTitle(content)
  if (!title) return
  try {
    db.update(issuesTable).set({ title }).where(eq(issuesTable.id, issueId)).run()
    emitIssueUpdated(issueId, { title })
    logger.info({ issueId, title }, 'auto_title_updated')
  } catch (err) {
    logger.warn({ issueId, err }, 'auto_title_update_failed')
  }
}
