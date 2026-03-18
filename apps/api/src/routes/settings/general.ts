import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import * as z from 'zod'
import {
  deleteAppSetting,
  getAppSetting,
  getServerName,
  getServerUrl,
  setAppSetting,
  setServerName,
  setServerUrl,
} from '@/db/helpers'
import { DEFAULT_LOG_PAGE_SIZE, LOG_PAGE_SIZE_KEY } from '@/engines/issue/constants'
import { getCachedCategorizedCommands } from '@/engines/issue/queries'
import type { WriteFilterRule } from '@/engines/write-filter'
import { DEFAULT_FILTER_RULES, WRITE_FILTER_RULES_KEY } from '@/engines/write-filter'
import { WORKTREE_AUTO_CLEANUP_KEY } from '@/jobs/worktree-cleanup'

const general = new Hono()

const WORKSPACE_PATH_KEY = 'workspace:defaultPath'

// GET /api/settings/workspace-path
general.get('/workspace-path', async (c) => {
  const value = await getAppSetting(WORKSPACE_PATH_KEY)
  return c.json({ success: true, data: { path: value ?? homedir() } })
})

// PATCH /api/settings/workspace-path
general.patch(
  '/workspace-path',
  zValidator('json', z.object({ path: z.string().min(1).max(1024) }), (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error.issues.map(i => i.message).join(', '),
        },
        400,
      )
    }
  }),
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
general.get('/write-filter-rules', async (c) => {
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
general.put(
  '/write-filter-rules',
  zValidator('json', z.object({ rules: z.array(writeFilterRuleSchema) }), (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error.issues.map(i => i.message).join(', '),
        },
        400,
      )
    }
  }),
  async (c) => {
    const { rules } = c.req.valid('json')
    await setAppSetting(WRITE_FILTER_RULES_KEY, JSON.stringify(rules))
    return c.json({ success: true, data: rules })
  },
)

// PATCH /api/settings/write-filter-rules/:id
general.patch(
  '/write-filter-rules/:id',
  zValidator('json', z.object({ enabled: z.boolean() }), (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error.issues.map(i => i.message).join(', '),
        },
        400,
      )
    }
  }),
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

    const rule = rules.find(r => r.id === ruleId)
    if (!rule) {
      return c.json({ success: false, error: `Rule not found: ${ruleId}` }, 404)
    }

    const updatedRules = rules.map(r => (r.id === ruleId ? { ...r, enabled } : r))
    await setAppSetting(WRITE_FILTER_RULES_KEY, JSON.stringify(updatedRules))
    return c.json({
      success: true,
      data: updatedRules.find(r => r.id === ruleId),
    })
  },
)

// --- Worktree Auto-Cleanup ---

// GET /api/settings/worktree-auto-cleanup
general.get('/worktree-auto-cleanup', async (c) => {
  const value = await getAppSetting(WORKTREE_AUTO_CLEANUP_KEY)
  return c.json({ success: true, data: { enabled: value === 'true' } })
})

// PATCH /api/settings/worktree-auto-cleanup
general.patch(
  '/worktree-auto-cleanup',
  zValidator('json', z.object({ enabled: z.boolean() }), (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error.issues.map(i => i.message).join(', '),
        },
        400,
      )
    }
  }),
  async (c) => {
    const { enabled } = c.req.valid('json')
    await setAppSetting(WORKTREE_AUTO_CLEANUP_KEY, String(enabled))
    return c.json({ success: true, data: { enabled } })
  },
)

// --- Log Page Size ---

// GET /api/settings/log-page-size
general.get('/log-page-size', async (c) => {
  const value = await getAppSetting(LOG_PAGE_SIZE_KEY)
  return c.json({
    success: true,
    data: { size: value ? Number(value) : DEFAULT_LOG_PAGE_SIZE },
  })
})

// PATCH /api/settings/log-page-size
general.patch(
  '/log-page-size',
  zValidator('json', z.object({ size: z.number().int().min(5).max(200) }), (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error.issues.map(i => i.message).join(', '),
        },
        400,
      )
    }
  }),
  async (c) => {
    const { size } = c.req.valid('json')
    await setAppSetting(LOG_PAGE_SIZE_KEY, String(size))
    return c.json({ success: true, data: { size } })
  },
)

// --- Max Concurrent Executions ---

const MAX_CONCURRENT_KEY = 'engine:maxConcurrentExecutions'
const DEFAULT_MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_EXECUTIONS) || 5

// GET /api/settings/max-concurrent-executions
general.get('/max-concurrent-executions', async (c) => {
  const value = await getAppSetting(MAX_CONCURRENT_KEY)
  return c.json({
    success: true,
    data: { value: value ? Number(value) : DEFAULT_MAX_CONCURRENT },
  })
})

// PATCH /api/settings/max-concurrent-executions
general.patch(
  '/max-concurrent-executions',
  zValidator('json', z.object({ value: z.number().int().min(1).max(50) }), (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error.issues.map(i => i.message).join(', '),
        },
        400,
      )
    }
  }),
  async (c) => {
    const { value } = c.req.valid('json')
    await setAppSetting(MAX_CONCURRENT_KEY, String(value))

    // Apply at runtime
    const { issueEngine } = await import('@/engines/issue')
    issueEngine.setMaxConcurrent(value)

    return c.json({ success: true, data: { value } })
  },
)

// --- Server Info ---

// GET /api/settings/server-info
general.get('/server-info', async (c) => {
  const [name, url] = await Promise.all([getServerName(), getServerUrl()])
  return c.json({ success: true, data: { name, url } })
})

// PATCH /api/settings/server-info
general.patch(
  '/server-info',
  zValidator(
    'json',
    z.object({
      name: z.string().max(128).optional(),
      url: z.string().max(1024).optional(),
    }),
    (result, c) => {
      if (!result.success) {
        return c.json(
          {
            success: false,
            error: result.error.issues.map(i => i.message).join(', '),
          },
          400,
        )
      }
    },
  ),
  async (c) => {
    const { name, url } = c.req.valid('json')

    if (name !== undefined) {
      const trimmed = name.trim()
      if (trimmed) {
        await setServerName(trimmed)
      } else {
        await deleteAppSetting('server:name')
      }
    }

    if (url !== undefined) {
      const trimmed = url.trim()
      if (trimmed) {
        await setServerUrl(trimmed)
      } else {
        await deleteAppSetting('server:url')
      }
    }

    const [currentName, currentUrl] = await Promise.all([getServerName(), getServerUrl()])
    return c.json({
      success: true,
      data: { name: currentName, url: currentUrl },
    })
  },
)

// --- Slash Commands (cached from engine init, per-engine) ---

// GET /api/settings/slash-commands?engine=claude-code
general.get('/slash-commands', async (c) => {
  const validEngines = ['claude-code', 'codex', 'acp', 'echo']
  const rawEngine = c.req.query('engine')
  if (rawEngine && !validEngines.includes(rawEngine)) {
    return c.json({ success: false, error: `Invalid engine type: ${rawEngine}` }, 400)
  }
  const engine = rawEngine as import('@/engines/types').EngineType | undefined
  let categorized = getCachedCategorizedCommands(engine)
  // If cache is cold (empty result), try refreshing from DB before responding
  if (
    categorized.commands.length === 0 &&
    categorized.agents.length === 0 &&
    categorized.plugins.length === 0
  ) {
    const { refreshSlashCommandsCache } = await import('@/engines/issue/queries')
    await refreshSlashCommandsCache()
    categorized = getCachedCategorizedCommands(engine)
  }
  return c.json({ success: true, data: categorized })
})

// --- MCP Settings ---

const MCP_ENABLED_KEY = 'mcp:enabled'
const MCP_API_KEY_KEY = 'mcp:apiKey'

// GET /api/settings/mcp
general.get('/mcp', async (c) => {
  const [enabledRaw, apiKey] = await Promise.all([
    getAppSetting(MCP_ENABLED_KEY),
    getAppSetting(MCP_API_KEY_KEY),
  ])

  // Env overrides take precedence (mirrors mcp route middleware logic)
  const enabledEnv = process.env.MCP_ENABLED
  const apiKeyEnv = process.env.MCP_API_KEY

  const effectiveEnabled = enabledEnv !== undefined
    ? (enabledEnv === 'true' || enabledEnv === '1')
    : enabledRaw === 'true'

  const effectiveApiKey = apiKeyEnv ?? apiKey ?? null

  return c.json({
    success: true,
    data: {
      enabled: effectiveEnabled,
      apiKey: effectiveApiKey,
      envOverride: {
        enabled: enabledEnv !== undefined,
        apiKey: apiKeyEnv !== undefined,
      },
    },
  })
})

// PATCH /api/settings/mcp
general.patch(
  '/mcp',
  zValidator(
    'json',
    z.object({
      enabled: z.boolean().optional(),
      apiKey: z.string().max(256).optional(),
    }),
    (result, c) => {
      if (!result.success) {
        return c.json(
          {
            success: false,
            error: result.error.issues.map(i => i.message).join(', '),
          },
          400,
        )
      }
    },
  ),
  async (c) => {
    const { enabled, apiKey } = c.req.valid('json')

    if (enabled !== undefined) {
      await setAppSetting(MCP_ENABLED_KEY, String(enabled))
    }

    if (apiKey !== undefined) {
      if (apiKey.trim()) {
        await setAppSetting(MCP_API_KEY_KEY, apiKey.trim())
      } else {
        await deleteAppSetting(MCP_API_KEY_KEY)
      }
    }

    const [enabledRaw, currentKey] = await Promise.all([
      getAppSetting(MCP_ENABLED_KEY),
      getAppSetting(MCP_API_KEY_KEY),
    ])

    const enabledEnv = process.env.MCP_ENABLED
    const apiKeyEnv = process.env.MCP_API_KEY

    return c.json({
      success: true,
      data: {
        enabled: enabledEnv !== undefined
          ? (enabledEnv === 'true' || enabledEnv === '1')
          : enabledRaw === 'true',
        apiKey: apiKeyEnv ?? currentKey ?? null,
        envOverride: {
          enabled: enabledEnv !== undefined,
          apiKey: apiKeyEnv !== undefined,
        },
      },
    })
  },
)

export default general
