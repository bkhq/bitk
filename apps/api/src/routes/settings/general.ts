import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { zValidator } from '@hono/zod-validator'
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
import { WORKTREE_AUTO_CLEANUP_KEY } from '@/cron/actions/builtins/worktree-cleanup'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'

const general = createOpenAPIRouter()

const WORKSPACE_PATH_KEY = 'workspace:defaultPath'

// GET /api/settings/workspace-path
general.openapi(R.getWorkspacePath, async (c) => {
  const value = await getAppSetting(WORKSPACE_PATH_KEY)
  return c.json({ success: true, data: { path: value ?? homedir() } })
})

// PATCH /api/settings/workspace-path
general.openapi(R.setWorkspacePath, async (c) => {
  const { path } = c.req.valid('json')
  const resolved = resolve(path)

  // Validate the path exists and is a directory
  try {
    const s = await stat(resolved)
    if (!s.isDirectory()) {
      return c.json({ success: false, error: 'Path is not a directory' }, 400 as const)
    }
  } catch {
    return c.json({ success: false, error: 'Path does not exist' }, 400 as const)
  }

  await setAppSetting(WORKSPACE_PATH_KEY, resolved)
  return c.json({ success: true, data: { path: resolved } }, 200 as const)
})

// --- Write Filter Rules ---

// GET /api/settings/write-filter-rules
general.openapi(R.getWriteFilterRules, async (c) => {
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
general.openapi(R.setWriteFilterRules, async (c) => {
  const { rules } = c.req.valid('json')
  await setAppSetting(WRITE_FILTER_RULES_KEY, JSON.stringify(rules))
  return c.json({ success: true, data: rules })
})

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
general.openapi(R.getLogPageSize, async (c) => {
  const value = await getAppSetting(LOG_PAGE_SIZE_KEY)
  return c.json({
    success: true,
    data: { size: value ? Number(value) : DEFAULT_LOG_PAGE_SIZE },
  })
})

// PATCH /api/settings/log-page-size
general.openapi(R.setLogPageSize, async (c) => {
  const { size } = c.req.valid('json')
  await setAppSetting(LOG_PAGE_SIZE_KEY, String(size))
  return c.json({ success: true, data: { size } })
})

// --- Max Concurrent Executions ---

const MAX_CONCURRENT_KEY = 'engine:maxConcurrentExecutions'
const DEFAULT_MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_EXECUTIONS) || 5

// GET /api/settings/max-concurrent-executions
general.openapi(R.getMaxConcurrent, async (c) => {
  const value = await getAppSetting(MAX_CONCURRENT_KEY)
  return c.json({
    success: true,
    data: { value: value ? Number(value) : DEFAULT_MAX_CONCURRENT },
  })
})

// PATCH /api/settings/max-concurrent-executions
general.openapi(R.setMaxConcurrent, async (c) => {
  const { value } = c.req.valid('json')
  await setAppSetting(MAX_CONCURRENT_KEY, String(value))

  // Apply at runtime
  const { issueEngine } = await import('@/engines/issue')
  issueEngine.setMaxConcurrent(value)

  return c.json({ success: true, data: { value } })
})

// --- Server Info ---

// GET /api/settings/server-info
general.openapi(R.getServerInfo, async (c) => {
  const [name, url] = await Promise.all([getServerName(), getServerUrl()])
  return c.json({ success: true, data: { name, url } })
})

// PATCH /api/settings/server-info
general.openapi(R.setServerInfo, async (c) => {
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
})

// --- Slash Commands (cached from engine init, per-engine) ---

// GET /api/settings/slash-commands?engine=claude-code
general.openapi(R.getGlobalSlashCommands, async (c) => {
  const validEngines = ['claude-code', 'codex', 'acp']
  const rawEngine = c.req.query('engine')
  if (rawEngine && !validEngines.includes(rawEngine) && !rawEngine.startsWith('acp:')) {
    return c.json({ success: false, error: `Invalid engine type: ${rawEngine}` }, 400 as const)
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
  return c.json({ success: true, data: categorized }, 200 as const)
})

// --- MCP Settings ---
// Auth is handled by the system (localhost bypass + JWT when AUTH_ENABLED).
// No separate MCP API key — only an enabled/disabled toggle.

const MCP_ENABLED_KEY = 'mcp:enabled'

// GET /api/settings/mcp
general.get('/mcp', async (c) => {
  const enabledRaw = await getAppSetting(MCP_ENABLED_KEY)

  // Env override takes precedence
  const enabledEnv = process.env.MCP_ENABLED

  const effectiveEnabled = enabledEnv !== undefined
    ? (enabledEnv === 'true' || enabledEnv === '1')
    : enabledRaw === 'true'

  return c.json({
    success: true,
    data: {
      enabled: effectiveEnabled,
      envOverride: {
        enabled: enabledEnv !== undefined,
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
    const { enabled } = c.req.valid('json')

    if (enabled !== undefined) {
      await setAppSetting(MCP_ENABLED_KEY, String(enabled))
    }

    const enabledRaw = await getAppSetting(MCP_ENABLED_KEY)
    const enabledEnv = process.env.MCP_ENABLED

    return c.json({
      success: true,
      data: {
        enabled: enabledEnv !== undefined
          ? (enabledEnv === 'true' || enabledEnv === '1')
          : enabledRaw === 'true',
        envOverride: {
          enabled: enabledEnv !== undefined,
        },
      },
    })
  },
)

export default general
