import type { TFunction } from 'i18next'

/** Translate a status name from the API, falling back to the original if no translation exists. */
export function tStatus(t: TFunction, name: string): string {
  return t(`statusName.${name}`, { defaultValue: name })
}
