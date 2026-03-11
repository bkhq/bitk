import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { logger } from '@/logger'
import { APP_DIR, ROOT_DIR } from '@/root'
import { embeddedMigrations } from './embedded-migrations'
import * as schema from './schema'

const rawDbPath = process.env.DB_PATH || 'data/db/bkd.db'
const dbPath = rawDbPath.startsWith('/') ? rawDbPath : resolve(ROOT_DIR, rawDbPath)

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

// In package mode, migrations live inside APP_DIR/migrations/.
// In dev mode, they live in apps/api/drizzle/.
const migrationsFolder = APP_DIR ?
    resolve(APP_DIR, 'migrations') :
    resolve(ROOT_DIR, 'apps/api/drizzle')
const journalPath = resolve(migrationsFolder, 'meta/_journal.json')

function runMigrations(folder: string) {
  try {
    sqlite.run('PRAGMA foreign_keys = OFF')
    migrate(db, { migrationsFolder: folder })
    sqlite.run('PRAGMA foreign_keys = ON')
  } catch (err: unknown) {
    sqlite.run('PRAGMA foreign_keys = ON')
    const errObj = err as { message?: string, cause?: { message?: string } }
    const msg = String(errObj?.message ?? '') + String(errObj?.cause?.message ?? '')
    const alreadyExists = /^(table|index) .+ already exists$/im.test(msg)
    if (!alreadyExists) {
      throw err
    }
    logger.warn({ error: msg }, 'migration_silenced_already_exists')
  }
}

if (existsSync(journalPath)) {
  // Filesystem migrations available (dev / package mode / non-compiled mode)
  runMigrations(migrationsFolder)
} else if (embeddedMigrations.size > 0) {
  // Compiled binary — write embedded migrations to a temp directory
  // and let drizzle's standard migrator process them.
  const tmpMigrations = resolve(tmpdir(), 'bkd-migrations')
  mkdirSync(resolve(tmpMigrations, 'meta'), { recursive: true })
  for (const [name, content] of embeddedMigrations) {
    writeFileSync(resolve(tmpMigrations, name), content)
  }
  runMigrations(tmpMigrations)
  logger.info({ count: embeddedMigrations.size }, 'embedded_migrations_applied')
} else {
  throw new Error('No migrations available (missing drizzle/ folder and no embedded migrations)')
}

// --- Post-migration schema verification ---
// After migrations run, verify that the DB schema matches what the code expects.
// This catches partial migrations, stale binaries, or DB/code version mismatches.
// On failure the process exits with a clear message so a process manager can restart it.

function verifySchema() {
  // Build expected columns from Drizzle schema definitions.
  // Each entry: [tableName, [...columnNames]]
  const expectedTables: Array<[string, string[]]> = []
  for (const [key, value] of Object.entries(schema)) {
    // Drizzle table objects have a Symbol-keyed property; the simplest
    // reliable check is that the value has a `._.name` (table name) and
    // `._.columns` (column map).
    const meta = (value as any)?._
    if (!meta?.name || !meta?.columns) continue
    const tableName: string = meta.name
    const cols = Object.values(meta.columns).map((c: any) => c.name as string)
    expectedTables.push([tableName, cols])
  }

  const missing: string[] = []
  for (const [table, expectedCols] of expectedTables) {
    let rows: Array<{ name: string }>
    try {
      rows = sqlite.query(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>
    } catch {
      missing.push(`table '${table}' (query failed)`)
      continue
    }
    if (rows.length === 0) {
      missing.push(`table '${table}'`)
      continue
    }
    const actualCols = new Set(rows.map(r => r.name))
    for (const col of expectedCols) {
      if (!actualCols.has(col)) {
        missing.push(`${table}.${col}`)
      }
    }
  }

  if (missing.length > 0) {
    logger.fatal(
      { missing },
      'schema_verification_failed: database schema does not match code. '
      + 'This usually means migrations did not complete. '
      + 'Run `bun run db:migrate` manually or restart the service.',
    )
    process.exit(1)
  }

  logger.info('schema_verification_passed')
}

verifySchema()

export async function checkDbHealth() {
  // Use native sqlite check for predictable health signal in Bun runtime.
  const result = sqlite.query('select 1 as ok').get() as { ok?: number } | null
  // Touch drizzle connection path as well.
  await db.get(sql`select 1 as ok`)
  return {
    ok: Number(result?.ok ?? 0) === 1,
  }
}
