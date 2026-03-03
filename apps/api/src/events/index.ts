import { AppEventBus } from './event-bus'

/** Global application event bus — single source of truth for all events. */
export const appEvents = new AppEventBus()

export { AppEventBus } from './event-bus'
