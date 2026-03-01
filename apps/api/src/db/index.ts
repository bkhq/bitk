import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { logger } from '@/logger'
import { ROOT_DIR } from '@/root'
import { embeddedMigrations } from './embedded-migrations'
import * as schema from './schema'

const rawDbPath = process.env.DB_PATH || 'data/bitk.db'
const dbPath = rawDbPath.startsWith('/')
  ? rawDbPath
  : resolve(ROOT_DIR, rawDbPath)

const dir = dirname(dbPath)
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true })
}

const sqlite = new Database(dbPath)
sqlite.run('PRAGMA journal_mode = WAL')
sqlite.run('PRAGMA foreign_keys = ON')
sqlite.run('PRAGMA busy_timeout = 15000')
sqlite.run('PRAGMA synchronous = NORMAL')
sqlite.run('PRAGMA cache_size = -64000')
sqlite.run('PRAGMA mmap_size = 268435456')

export const db = drizzle({ client: sqlite, schema })
export { dbPath, sqlite }

const migrationsFolder = resolve(ROOT_DIR, 'apps/api/drizzle')
const journalPath = resolve(migrationsFolder, 'meta/_journal.json')

function runMigrations(folder: string) {
  try {
    sqlite.run('PRAGMA foreign_keys = OFF')
    migrate(db, { migrationsFolder: folder })
    sqlite.run('PRAGMA foreign_keys = ON')
  } catch (err: unknown) {
    sqlite.run('PRAGMA foreign_keys = ON')
    const errObj = err as { message?: string; cause?: { message?: string } }
    const msg =
      String(errObj?.message ?? '') + String(errObj?.cause?.message ?? '')
    const alreadyExists =
      /table .+ already exists|index .+ already exists/i.test(msg)
    if (!alreadyExists) {
      throw err
    }
    logger.debug({ error: msg }, 'migration_silenced_already_exists')
  }
}

if (existsSync(journalPath)) {
  // Filesystem migrations available (dev / non-compiled mode)
  runMigrations(migrationsFolder)
} else if (embeddedMigrations.size > 0) {
  // Compiled binary — write embedded migrations to a temp directory
  // and let drizzle's standard migrator process them.
  const tmpMigrations = resolve(tmpdir(), 'bitk-migrations')
  mkdirSync(resolve(tmpMigrations, 'meta'), { recursive: true })
  for (const [name, content] of embeddedMigrations) {
    writeFileSync(resolve(tmpMigrations, name), content)
  }
  runMigrations(tmpMigrations)
  logger.info({ count: embeddedMigrations.size }, 'embedded_migrations_applied')
} else {
  throw new Error(
    'No migrations available (missing drizzle/ folder and no embedded migrations)',
  )
}

export async function checkDbHealth() {
  // Use native sqlite check for predictable health signal in Bun runtime.
  const result = sqlite.query('select 1 as ok').get() as { ok?: number } | null
  // Touch drizzle connection path as well.
  await db.get(sql`select 1 as ok`)
  return {
    ok: Number(result?.ok ?? 0) === 1,
  }
}
