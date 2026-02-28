import { getAppSetting } from '../db/helpers'

export interface WriteFilterRule {
  id: string
  type: 'tool-name'
  match: string
  enabled: boolean
}

export const WRITE_FILTER_RULES_KEY = 'write-filter:rules'

export const DEFAULT_FILTER_RULES: WriteFilterRule[] = [
  { id: 'read', type: 'tool-name', match: 'Read', enabled: true },
  { id: 'glob', type: 'tool-name', match: 'Glob', enabled: true },
  { id: 'grep', type: 'tool-name', match: 'Grep', enabled: true },
]

export async function loadFilterRules(): Promise<WriteFilterRule[]> {
  const raw = await getAppSetting(WRITE_FILTER_RULES_KEY)
  if (!raw) return DEFAULT_FILTER_RULES
  try {
    return JSON.parse(raw) as WriteFilterRule[]
  } catch {
    return DEFAULT_FILTER_RULES
  }
}

export function isToolFiltered(toolName: string, rules: WriteFilterRule[]): boolean {
  return rules.some((r) => r.enabled && r.type === 'tool-name' && r.match === toolName)
}
