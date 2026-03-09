import { resolve } from 'node:path'

/**
 * Whether this build was created by `scripts/package.ts`.
 * Injected at bundle time via `--define __BITK_PACKAGE_MODE__=true`.
 * In dev or full-binary mode the global is never defined, so we default
 * to false.
 */
declare const __BITK_PACKAGE_MODE__: boolean | undefined
const IS_PACKAGE_MODE: boolean
  = typeof __BITK_PACKAGE_MODE__ !== 'undefined' ? __BITK_PACKAGE_MODE__ : false

/**
 * Monorepo / installation root directory.
 *
 * - Package mode: `import.meta.dir` = `<root>/data/app/v{version}/` → 3 levels up.
 * - Dev mode: `import.meta.dir` = `<root>/apps/api/src/` → 3 levels up.
 * - Compiled binary: `import.meta.dir` starts with `/$bunfs` (Bun virtual FS),
 *   fall back to `process.cwd()`.
 */
export const ROOT_DIR = process.env.ROOT_DIR
  ? resolve(process.env.ROOT_DIR)
  : import.meta.dir.startsWith('/$bunfs')
    ? process.cwd()
    : resolve(import.meta.dir, '../../..')

/**
 * App package directory (package mode only).
 *
 * In package mode this equals `import.meta.dir` (`<root>/data/app/v{version}/`),
 * which contains: server.js, public/, migrations/, version.json.
 * When null, the server runs in compiled or dev mode.
 */
export const APP_DIR: string | null = IS_PACKAGE_MODE ? import.meta.dir : null
