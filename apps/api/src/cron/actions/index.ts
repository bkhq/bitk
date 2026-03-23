// Import action modules to trigger self-registration
import './builtins'
import './issues'

// Re-export registry API
export {
  getAction,
  getActionHandler,
  getActionNames,
  getActionsHelp,
  getDefaultActions,
  registerAction,
  validateActionConfig,
} from './registry'
export type { ActionDef, ActionHandler } from './types'
