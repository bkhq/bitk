import { resolve } from 'node:path'

/**
 * Monorepo root directory.
 *
 * In compiled binary `import.meta.dir` points to the read-only /$bunfs
 * virtual filesystem, so we fall back to `process.cwd()`.
 * In dev / non-compiled mode we resolve 3 levels up from this file
 * (apps/api/src → root).
 */
export const ROOT_DIR = import.meta.dir.startsWith('/$bunfs')
  ? process.cwd()
  : resolve(import.meta.dir, '../../..')
