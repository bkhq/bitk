import type { IssueActionDef, IssueActionHandler } from './types'

const issueActions = new Map<string, IssueActionDef>()

export function registerIssueAction(
  name: string,
  def: IssueActionDef,
): void {
  issueActions.set(name, def)
}

export function getIssueAction(name: string): IssueActionDef | undefined {
  return issueActions.get(name)
}

export function getIssueActionNames(): string[] {
  return [...issueActions.keys()]
}

export function getIssueActionHandler(name: string): IssueActionHandler | undefined {
  return issueActions.get(name)?.handler
}

export function getIssueActionsHelp(): string {
  const lines: string[] = []
  for (const [name, def] of issueActions) {
    const required = def.requiredFields?.length
      ? ` (requires: ${def.requiredFields.join(', ')})`
      : ''
    lines.push(`  - ${name}: ${def.description}${required}`)
  }
  return lines.join('\n')
}

export function validateIssueActionConfig(
  action: string,
  config: Record<string, unknown>,
): string | null {
  const def = issueActions.get(action)
  if (!def) {
    return `Unknown issue action: "${action}". Available: ${getIssueActionNames().join(', ')}`
  }

  for (const field of def.requiredFields ?? []) {
    if (!config[field]) {
      return `taskConfig.${field} is required for action "${action}"`
    }
  }

  return null
}
