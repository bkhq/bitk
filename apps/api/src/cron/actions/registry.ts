import type { ActionDef, ActionHandler } from './types'

const actions = new Map<string, ActionDef>()

export function registerAction(name: string, def: ActionDef): void {
  if (actions.has(name)) {
    throw new Error(`Cron action "${name}" is already registered`)
  }
  actions.set(name, def)
}

export function getAction(name: string): ActionDef | undefined {
  return actions.get(name)
}

export function getActionHandler(name: string): ActionHandler | undefined {
  return actions.get(name)?.handler
}

export function getActionNames(): string[] {
  return [...actions.keys()]
}

/** Return actions that declare a defaultCron (used for auto-seeding DB on startup) */
export function getDefaultActions(): Array<{ name: string, cron: string, runOnStartup?: boolean }> {
  const defaults: Array<{ name: string, cron: string, runOnStartup?: boolean }> = []
  for (const [name, def] of actions) {
    if (def.defaultCron) {
      defaults.push({ name, cron: def.defaultCron, runOnStartup: def.runOnStartup })
    }
  }
  return defaults
}

export function getActionsHelp(): string {
  const lines: string[] = []
  for (const [name, def] of actions) {
    const cat = def.category ? `[${def.category}]` : ''
    const required = def.requiredFields?.length
      ? ` (requires: ${def.requiredFields.join(', ')})`
      : ''
    lines.push(`  - ${name} ${cat}: ${def.description}${required}`)
  }
  return lines.join('\n')
}

export async function validateActionConfig(
  action: string,
  config: Record<string, unknown>,
): Promise<string | null> {
  const def = actions.get(action)
  if (!def) {
    return `Unknown action: "${action}". Available: ${getActionNames().join(', ')}`
  }

  for (const field of def.requiredFields ?? []) {
    if (config[field] == null || config[field] === '') {
      return `taskConfig.${field} is required for action "${action}"`
    }
  }

  // Run action-specific deep validation (e.g. verify refs exist)
  if (def.validate) {
    return def.validate(config)
  }

  return null
}
