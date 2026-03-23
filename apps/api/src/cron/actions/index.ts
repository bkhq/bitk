// Import action modules to trigger self-registration
import './builtins'
import './follow-up'
import './execute'
import './close'
import './check-status'

// Re-export registry API
export {
  getAction,
  getActionHandler,
  getActionNames,
  getActionsHelp,
  registerAction,
  validateActionConfig,
} from './registry'
export type { ActionDef, ActionHandler } from './types'
