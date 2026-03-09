import { existsSync } from 'node:fs'
import { stat, truncate } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono } from 'hono'
import { ROOT_DIR } from '@/root'

const systemLogs = new Hono()

const LOG_FILE = join(ROOT_DIR, 'data', 'logs', 'bkd.log')

// GET /api/settings/system-logs — tail the log file
systemLogs.get('/system-logs', async (c) => {
  const lines = Number(c.req.query('lines') ?? '200')
  const clampedLines = Math.min(Math.max(lines, 1), 5000)

  if (!existsSync(LOG_FILE)) {
    return c.json({ success: true, data: { lines: [], fileSize: 0 } })
  }

  const s = await stat(LOG_FILE).catch(() => null)
  const fileSize = s?.size ?? 0

  // Read last N lines efficiently: for large files, read only the tail
  const MAX_TAIL_BYTES = 512 * 1024 // 512 KB max read for tail
  const file = Bun.file(LOG_FILE)

  let content: string
  if (fileSize > MAX_TAIL_BYTES) {
    // Read only the last chunk — may cut the first line, which we discard
    const fd = await Bun.file(LOG_FILE).slice(fileSize - MAX_TAIL_BYTES)
    content = await fd.text()
    // Discard partial first line
    const firstNewline = content.indexOf('\n')
    if (firstNewline !== -1) content = content.slice(firstNewline + 1)
  } else {
    content = await file.text()
  }

  const allLines = content.split('\n').filter(l => l.length > 0)
  const tailLines = allLines.slice(-clampedLines)

  // For totalLines, estimate from file size if we only read a chunk
  const totalLines
    = fileSize > MAX_TAIL_BYTES
      ? Math.round((fileSize / MAX_TAIL_BYTES) * allLines.length)
      : allLines.length

  return c.json({
    success: true,
    data: { lines: tailLines, fileSize, totalLines },
  })
})

// GET /api/settings/system-logs/download — download the full log file
systemLogs.get('/system-logs/download', async (c) => {
  if (!existsSync(LOG_FILE)) {
    return c.json({ success: false, error: 'Log file not found' }, 404)
  }

  const file = Bun.file(LOG_FILE)
  c.header('Content-Type', 'text/plain; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="bkd.log"')
  return c.body(await file.arrayBuffer())
})

// POST /api/settings/system-logs/clear — truncate the log file
systemLogs.post('/system-logs/clear', async (c) => {
  if (!existsSync(LOG_FILE)) {
    return c.json({ success: true, data: { cleared: true } })
  }

  await truncate(LOG_FILE, 0)
  return c.json({ success: true, data: { cleared: true } })
})

export default systemLogs
