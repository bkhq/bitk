#!/usr/bin/env bun
/**
 * Compile script: builds the frontend, generates an embedded-asset map,
 * embeds drizzle migrations, then compiles the backend into a single
 * standalone binary.
 *
 * Supports two modes:
 *   --mode full     (default) Embeds frontend assets + migrations into
 *                   a standalone binary (~105 MB)
 *   --mode launcher Compiles only the minimal launcher (scripts/launcher.ts)
 *                   into a binary (~90 MB). The server code is loaded at
 *                   runtime from data/app/server.js (created by package.ts).
 *
 * Usage:  bun scripts/compile.ts [--mode <full|launcher>] [--target <bun-target>] [--outfile <name>]
 *
 * Examples:
 *   bun scripts/compile.ts
 *   bun scripts/compile.ts --target bun-linux-x64 --outfile bkd-linux-x64
 *   bun scripts/compile.ts --mode launcher --outfile bkd-launcher
 *   bun scripts/compile.ts --mode launcher --target bun-linux-x64 --outfile bkd-launcher-linux-x64
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { Glob } from 'bun'

const { values: args } = parseArgs({
  options: {
    'mode': { type: 'string', default: 'full' },
    'target': { type: 'string' },
    'outfile': { type: 'string' },
    'version': { type: 'string' },
    'skip-frontend': { type: 'boolean', default: false },
  },
  strict: false,
})

const compileMode = (args.mode as string) ?? 'full'
if (compileMode !== 'full' && compileMode !== 'launcher') {
  console.error(`[compile] Invalid mode: ${compileMode}. Use 'full' or 'launcher'.`)
  process.exit(1)
}

const ROOT = resolve(import.meta.dir, '..')
const OUT_DIR = resolve(ROOT, 'dist')
const FRONTEND_DIST = resolve(ROOT, 'apps/frontend/dist')
const DRIZZLE = resolve(ROOT, 'apps/api/drizzle')

const STATIC_FILE = resolve(ROOT, 'apps/api/src/static-assets.ts')
const STATIC_BACKUP = resolve(ROOT, 'apps/api/src/static-assets.ts.bak')
const MIGRATIONS_FILE = resolve(ROOT, 'apps/api/src/db/embedded-migrations.ts')
const MIGRATIONS_BACKUP = resolve(ROOT, 'apps/api/src/db/embedded-migrations.ts.bak')

console.log(`[compile] Mode: ${compileMode}`)

const target = (args.target as string | undefined) ?? null
const version = args.version ?? 'dev'
const gitCommit = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD'], {
  cwd: ROOT,
})
const commit = gitCommit.stdout.toString().trim() || 'unknown'

if (compileMode === 'launcher') {
  // ============================================================
  // LAUNCHER MODE: compile only scripts/launcher.ts
  // No frontend build, no asset embedding, no migration embedding
  // ============================================================
  const defaultOutfile = version !== 'dev' ? `bkd-launcher-${version}` : 'bkd-launcher'
  mkdirSync(OUT_DIR, { recursive: true })
  const outfile = resolve(OUT_DIR, (args.outfile as string | undefined) ?? defaultOutfile)
  console.log(`[compile] Compiling launcher binary...${target ? ` (target: ${target})` : ''}`)
  console.log(`[compile] Version: ${version} (${commit})`)

  const launcherArgs = [
    'bun',
    'build',
    'scripts/launcher.ts',
    '--compile',
    ...(target ? ['--target', target] : []),
    '--outfile',
    outfile,
  ]
  const build = Bun.spawn(launcherArgs, {
    cwd: ROOT,
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  const buildCode = await build.exited

  if (buildCode !== 0) {
    console.error('[compile] Launcher compilation failed')
    process.exit(1)
  }

  console.log(`[compile] Done! Launcher: ${outfile}`)
  const fileStat = Bun.file(outfile)
  console.log(`[compile] Size: ${(fileStat.size / 1024 / 1024).toFixed(1)} MB`)

  // Generate SHA-256 checksum
  console.log('[compile] Generating SHA-256 checksum...')
  const hasher = new Bun.CryptoHasher('sha256')
  const binaryData = await Bun.file(outfile).arrayBuffer()
  hasher.update(new Uint8Array(binaryData))
  const sha256 = hasher.digest('hex')
  const checksumFile = resolve(OUT_DIR, 'checksums.txt')
  const binaryName = outfile.split('/').pop() ?? 'bkd-launcher'
  const entry = `${sha256}  ${binaryName}\n`
  const existing = existsSync(checksumFile) ? await Bun.file(checksumFile).text() : ''
  await Bun.write(checksumFile, existing + entry)
  console.log(`[compile] SHA-256: ${sha256}`)
  console.log(`[compile] Checksum file: ${checksumFile}`)
}
else {
  // ============================================================
  // FULL MODE: build frontend, embed assets, embed migrations,
  //            compile everything into a single standalone binary
  // ============================================================

  // ---------- 0. Recover from interrupted previous run ----------
  if (existsSync(STATIC_BACKUP)) {
    console.warn(
      '[compile] Found stale backup — restoring stub files from previous interrupted run',
    )
    copyFileSync(STATIC_BACKUP, STATIC_FILE)
    unlinkSync(STATIC_BACKUP)
  }
  if (existsSync(MIGRATIONS_BACKUP)) {
    copyFileSync(MIGRATIONS_BACKUP, MIGRATIONS_FILE)
    unlinkSync(MIGRATIONS_BACKUP)
  }

  // ---------- 1. Build frontend ----------
  if (args['skip-frontend']) {
    console.log('[compile] Skipping frontend build (--skip-frontend)')
  }
  else {
    console.log('[compile] Building frontend...')
    const vite = Bun.spawn(['bun', 'run', 'build'], {
      cwd: ROOT,
      stdio: ['inherit', 'inherit', 'inherit'],
    })
    const viteCode = await vite.exited
    if (viteCode !== 0) {
      console.error('[compile] Frontend build failed')
      process.exit(1)
    }
  }

  // ---------- 2. Scan dist files ----------
  console.log('[compile] Scanning apps/frontend/dist...')
  const glob = new Glob('**/*')
  const files: string[] = []

  for await (const entry of glob.scan({
    cwd: FRONTEND_DIST,
    onlyFiles: true,
  })) {
    files.push(entry)
  }
  files.sort()
  console.log(`[compile] Found ${files.length} assets`)

  // ---------- 3. Replace static-assets.ts ----------
  copyFileSync(STATIC_FILE, STATIC_BACKUP)

  const imports: string[] = []
  const entries: string[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const relPath = `../../frontend/dist/${file}`
    const urlPath = `/${file}`
    imports.push(`import f${i} from ${JSON.stringify(relPath)} with { type: "file" }`)
    entries.push(`  [${JSON.stringify(urlPath)}, f${i}],`)
  }

  const staticCode = `// Auto-generated by scripts/compile.ts — do not edit
${imports.join('\n')}

export const staticAssets = new Map<string, string>([
${entries.join('\n')}
])
`

  await Bun.write(STATIC_FILE, staticCode)
  console.log(`[compile] Generated static-assets.ts (${files.length} entries)`)

  // ---------- 4. Embed drizzle migrations ----------
  console.log('[compile] Embedding drizzle migrations...')
  copyFileSync(MIGRATIONS_FILE, MIGRATIONS_BACKUP)

  const migrationFiles: string[] = []
  const migrationGlob = new Glob('**/*')
  for await (const entry of migrationGlob.scan({
    cwd: DRIZZLE,
    onlyFiles: true,
  })) {
    migrationFiles.push(entry)
  }
  migrationFiles.sort()

  const migrationEntries: string[] = []
  for (const file of migrationFiles) {
    const content = readFileSync(resolve(DRIZZLE, file), 'utf-8')
    migrationEntries.push(`  [${JSON.stringify(file)}, ${JSON.stringify(content)}],`)
  }

  const migrationsCode = `// Auto-generated by scripts/compile.ts — do not edit
export const embeddedMigrations = new Map<string, string>([
${migrationEntries.join('\n')}
])
`

  await Bun.write(MIGRATIONS_FILE, migrationsCode)
  console.log(`[compile] Generated embedded-migrations.ts (${migrationFiles.length} files)`)

  // ---------- 5. Compile to single binary ----------
  // Default outfile includes version suffix when version is provided
  const defaultOutfile = version !== 'dev' ? `bkd-${version}` : 'bkd'
  mkdirSync(OUT_DIR, { recursive: true })
  const outfile = resolve(OUT_DIR, (args.outfile as string | undefined) ?? defaultOutfile)
  console.log(`[compile] Compiling binary...${target ? ` (target: ${target})` : ''}`)
  console.log(`[compile] Version: ${version} (${commit})`)
  const compileArgs = [
    'bun',
    'build',
    'apps/api/src/index.ts',
    '--compile',
    ...(target ? ['--target', target] : []),
    '--define',
    `__BKD_VERSION__="${version}"`,
    '--define',
    `__BKD_COMMIT__="${commit}"`,
    '--outfile',
    outfile,
  ]
  const build = Bun.spawn(compileArgs, {
    cwd: ROOT,
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  const buildCode = await build.exited

  // ---------- 6. Restore stub files ----------
  copyFileSync(STATIC_BACKUP, STATIC_FILE)
  try {
    unlinkSync(STATIC_BACKUP)
  }
  catch {}

  copyFileSync(MIGRATIONS_BACKUP, MIGRATIONS_FILE)
  try {
    unlinkSync(MIGRATIONS_BACKUP)
  }
  catch {}

  if (buildCode !== 0) {
    console.error('[compile] Binary compilation failed')
    process.exit(1)
  }

  console.log(`[compile] Done! Binary: ${outfile}`)
  const fileStat = Bun.file(outfile)
  console.log(`[compile] Size: ${(fileStat.size / 1024 / 1024).toFixed(1)} MB`)

  // ---------- 7. Generate SHA-256 checksum ----------
  console.log('[compile] Generating SHA-256 checksum...')
  const hasher = new Bun.CryptoHasher('sha256')
  const binaryData = await Bun.file(outfile).arrayBuffer()
  hasher.update(new Uint8Array(binaryData))
  const sha256 = hasher.digest('hex')
  const checksumFile = resolve(OUT_DIR, 'checksums.txt')
  const binaryName = outfile.split('/').pop() ?? 'bkd'
  const entry = `${sha256}  ${binaryName}\n`
  const existing = existsSync(checksumFile) ? await Bun.file(checksumFile).text() : ''
  await Bun.write(checksumFile, existing + entry)
  console.log(`[compile] SHA-256: ${sha256}`)
  console.log(`[compile] Checksum file: ${checksumFile}`)
}
