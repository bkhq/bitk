import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { issues as issuesTable } from '../../db/schema'
import { emitIssueUpdated } from '../../events/issue-events'
import { logger } from '../../logger'

// ---------- Auto-title prompt ----------

export const AUTO_TITLE_PROMPT = [
  'You are a title generator. Summarize the current conversation into a short title.',
  '',
  '## Strict rules',
  '1. Output exactly one line in this format: <bitk><title>TITLE</title></bitk>',
  '2. Do NOT output any other text, explanation, newline, or whitespace',
  '3. Title must be 50 characters or fewer',
  '4. Do NOT wrap the title in quotes',
  '',
  '## Correct example',
  'Output: <bitk><title>Park walk with friends</title></bitk>',
  '',
  '## Wrong examples (forbidden)',
  'Here is the title: <bitk><title>Park walk</title></bitk>',
  '<bitk><title>Park walk</title></bitk> This title summarises...',
  '```<bitk><title>Park walk</title></bitk>```',
].join('\n')

// ---------- Title extraction ----------

const TITLE_RE = /<bitk><title>(.*?)<\/title><\/bitk>/

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
