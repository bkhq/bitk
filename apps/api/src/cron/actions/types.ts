import type { IssueRow } from '@/routes/issues/_shared'

export interface IssueActionContext {
  project: {
    id: string
    directory: string | null
    systemPrompt: string | null
    envVars: string | null
  }
  issue: IssueRow
  config: Record<string, unknown>
}

export type IssueActionHandler = (ctx: IssueActionContext) => Promise<string>

export interface IssueActionDef {
  /** Human-readable description for MCP tool help */
  description: string
  /** Required fields in taskConfig (beyond projectId/issueId) */
  requiredFields?: string[]
  /** The handler function */
  handler: IssueActionHandler
}
