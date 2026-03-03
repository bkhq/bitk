import { resolve } from 'node:path'
import { APP_DIR, ROOT_DIR } from '@/root'

export const UPGRADE_ENABLED_KEY = 'upgrade:enabled'
export const UPGRADE_CHECK_RESULT_KEY = 'upgrade:lastCheckResult'
export const CHECK_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

export const UPDATES_DIR = resolve(ROOT_DIR, 'data/updates')
export const APP_BASE = resolve(ROOT_DIR, 'data/app')
export const VERSION_FILE = resolve(APP_BASE, 'version.json')

/** Whether the server is running from an extracted app package (launcher mode) */
export const isPackageMode = APP_DIR !== null
