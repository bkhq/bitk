import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import * as z from 'zod'
import { getAppSetting, setAppSetting } from '@/db/helpers'
import type { WriteFilterRule } from '@/engines/write-filter'
import {
  DEFAULT_FILTER_RULES,
  WRITE_FILTER_RULES_KEY,
} from '@/engines/write-filter'

const settings = new Hono()

const WORKSPACE_PATH_KEY = 'workspace:defaultPath'

// GET /api/settings/workspace-path
settings.get('/workspace-path', async (c) => {
  const value = await getAppSetting(WORKSPACE_PATH_KEY)
  return c.json({ success: true, data: { path: value ?? homedir() } })
})

// PATCH /api/settings/workspace-path
settings.patch(
  '/workspace-path',
  zValidator('json', z.object({ path: z.string().min(1).max(1024) })),
  async (c) => {
    const { path } = c.req.valid('json')
    const resolved = resolve(path)

    // Validate the path exists and is a directory
    try {
      const s = await stat(resolved)
      if (!s.isDirectory()) {
        return c.json({ success: false, error: 'Path is not a directory' }, 400)
      }
    } catch {
      return c.json({ success: false, error: 'Path does not exist' }, 400)
    }

    await setAppSetting(WORKSPACE_PATH_KEY, resolved)
    return c.json({ success: true, data: { path: resolved } })
  },
)

// --- Write Filter Rules ---

const writeFilterRuleSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('tool-name'),
  match: z.string().min(1).max(128),
  enabled: z.boolean(),
})

// GET /api/settings/write-filter-rules
settings.get('/write-filter-rules', async (c) => {
  const raw = await getAppSetting(WRITE_FILTER_RULES_KEY)
  let rules: WriteFilterRule[]
  if (raw) {
    try {
      rules = JSON.parse(raw) as WriteFilterRule[]
    } catch {
      rules = []
    }
  } else {
    rules = DEFAULT_FILTER_RULES
  }
  return c.json({ success: true, data: rules })
})

// PUT /api/settings/write-filter-rules
settings.put(
  '/write-filter-rules',
  zValidator('json', z.object({ rules: z.array(writeFilterRuleSchema) })),
  async (c) => {
    const { rules } = c.req.valid('json')
    await setAppSetting(WRITE_FILTER_RULES_KEY, JSON.stringify(rules))
    return c.json({ success: true, data: rules })
  },
)

// PATCH /api/settings/write-filter-rules/:id
settings.patch(
  '/write-filter-rules/:id',
  zValidator('json', z.object({ enabled: z.boolean() })),
  async (c) => {
    const ruleId = c.req.param('id')
    const { enabled } = c.req.valid('json')

    const raw = await getAppSetting(WRITE_FILTER_RULES_KEY)
    let rules: WriteFilterRule[]
    if (raw) {
      try {
        rules = JSON.parse(raw) as WriteFilterRule[]
      } catch {
        rules = []
      }
    } else {
      rules = [...DEFAULT_FILTER_RULES]
    }

    const rule = rules.find((r) => r.id === ruleId)
    if (!rule) {
      return c.json({ success: false, error: `Rule not found: ${ruleId}` }, 404)
    }

    const updatedRules = rules.map((r) =>
      r.id === ruleId ? { ...r, enabled } : r,
    )
    await setAppSetting(WRITE_FILTER_RULES_KEY, JSON.stringify(updatedRules))
    return c.json({
      success: true,
      data: updatedRules.find((r) => r.id === ruleId),
    })
  },
)

// --- Slash Commands (cached from engine init) ---

const SLASH_COMMANDS_KEY = 'engine:slashCommands'

// GET /api/settings/slash-commands
settings.get('/slash-commands', async (c) => {
  const raw = await getAppSetting(SLASH_COMMANDS_KEY)
  let commands: string[] = []
  if (raw) {
    try {
      commands = JSON.parse(raw) as string[]
    } catch {
      commands = []
    }
  }
  return c.json({ success: true, data: { commands } })
})

export default settings
