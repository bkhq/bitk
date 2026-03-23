// Import action modules to trigger self-registration
import './follow-up'
import './execute'
import './close'
import './check-status'

// Re-export registry API
export {
  getIssueAction,
  getIssueActionHandler,
  getIssueActionNames,
  getIssueActionsHelp,
  registerIssueAction,
  validateIssueActionConfig,
} from './registry'
export type { IssueActionContext, IssueActionDef, IssueActionHandler } from './types'
