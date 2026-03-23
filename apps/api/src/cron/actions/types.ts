/** Generic action handler — receives raw config, self-resolves context */
export type ActionHandler = (config: Record<string, unknown>) => Promise<string>

export interface ActionDef {
  /** Human-readable description for MCP tool help */
  description: string
  /** Category tag (e.g. 'builtin', 'issue', 'project', 'external') */
  category?: string
  /** Required fields in taskConfig */
  requiredFields?: string[]
  /** Optional deep validation at cron-create time (e.g. verify refs exist) */
  validate?: (config: Record<string, unknown>) => Promise<string | null>
  /** The handler function */
  handler: ActionHandler
}
