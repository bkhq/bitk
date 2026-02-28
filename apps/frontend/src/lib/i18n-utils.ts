import type { TFunction } from 'i18next'

/** Translate a status name from the API, falling back to the original if no translation exists. */
export function tStatus(t: TFunction, name: string): string {
  return t(`statusName.${name}`, { defaultValue: name })
}

/** Translate a priority value (urgent/high/medium/low). */
export function tPriority(t: TFunction, priority: string): string {
  return t(`priorityName.${priority}`, { defaultValue: priority })
}
