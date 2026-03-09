#!/usr/bin/env bun
/**
 * Package script: builds the frontend, bundles the API server, and creates
 * a distributable .tar.gz package.
 *
 * The resulting archive contains:
 *   server.js        — Bundled API server (single file, bun build output)
 *   version.json     — Version and commit metadata
 *   public/          — Frontend static assets (Vite build output)
 *   migrations/      — Drizzle migration SQL files
 *
 * Usage:
 *   bun scripts/package.ts
 *   bun scripts/package.ts --version 0.0.6
 *   bun scripts/package.ts --skip-frontend
 *   bun scripts/package.ts --outfile bkd-app-v0.0.6.tar.gz
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { Glob } from 'bun'

const { values: args } = parseArgs({
  options: {
    version: { type: 'string' },
    outfile: { type: 'string' },
    'skip-frontend': { type: 'boolean', default: false },
  },
  strict: false,
})

const ROOT = resolve(import.meta.dir, '..')
const OUT_DIR = resolve(ROOT, 'dist')
const FRONTEND_DIST = resolve(ROOT, 'apps/frontend/dist')
const DRIZZLE = resolve(ROOT, 'apps/api/drizzle')
const API_SRC = resolve(ROOT, 'apps/api/src/index.ts')

const STAGE = resolve(ROOT, '.package-staging')

// --- Helpers ---

function fatal(msg: string): never {
  console.error(`[package] ${msg}`)
  process.exit(1)
}

function step(msg: string): void {
  console.log(`[package] ${msg}`)
}

// --- 1. Parse version ---

const version = args.version ?? 'dev'
if (version !== 'dev' && !/^\d+\.\d+\.\d+$/.test(version)) {
  fatal(`Invalid version: ${version}. Expected semver (e.g. 0.0.6)`)
}
const gitCommit = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD'], {
  cwd: ROOT,
})
const commit = gitCommit.stdout.toString().trim() || 'unknown'
step(`Version: ${version} (${commit})`)

// Default output file name
const defaultOutfile = version !== 'dev' ? `bkd-app-v${version}.tar.gz` : 'bkd-app.tar.gz'
mkdirSync(OUT_DIR, { recursive: true })
const outfile = resolve(OUT_DIR, args.outfile ?? defaultOutfile)

// --- 2. Build frontend ---

if (args['skip-frontend']) {
  step('Skipping frontend build (--skip-frontend)')
} else {
  step('Building frontend...')
  const vite = Bun.spawn(['bun', 'run', 'build'], {
    cwd: ROOT,
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  const viteCode = await vite.exited
  if (viteCode !== 0) fatal('Frontend build failed')
}

if (!existsSync(FRONTEND_DIST)) {
  fatal(`Frontend dist not found: ${FRONTEND_DIST}. Run frontend build first.`)
}

// --- 3. Bundle API server ---

step('Bundling API server...')

// Clean staging directory
if (existsSync(STAGE)) {
  rmSync(STAGE, { recursive: true })
}
mkdirSync(STAGE, { recursive: true })

const serverOut = resolve(STAGE, 'server.js')

const buildArgs = [
  'bun',
  'build',
  API_SRC,
  '--target',
  'bun',
  '--outfile',
  serverOut,
  '--define',
  `__BITK_VERSION__="${version}"`,
  '--define',
  `__BITK_COMMIT__="${commit}"`,
  '--define',
  '__BITK_PACKAGE_MODE__=true',
]

const build = Bun.spawn(buildArgs, {
  cwd: resolve(ROOT, 'apps/api'),
  stdio: ['inherit', 'inherit', 'inherit'],
})
const buildCode = await build.exited
if (buildCode !== 0) fatal('API server bundle failed')

const serverStat = Bun.file(serverOut)
step(`Server bundle: ${(serverStat.size / 1024).toFixed(0)} KB`)

// --- 4. Copy frontend assets ---

step('Copying frontend assets...')
const publicDir = resolve(STAGE, 'public')
cpSync(FRONTEND_DIST, publicDir, { recursive: true })

// Count assets
const assetGlob = new Glob('**/*')
let assetCount = 0
for await (const _ of assetGlob.scan({ cwd: publicDir, onlyFiles: true })) {
  assetCount++
}
step(`Copied ${assetCount} frontend assets`)

// --- 5. Copy migrations ---

step('Copying migrations...')
const migrationsDir = resolve(STAGE, 'migrations')
cpSync(DRIZZLE, migrationsDir, { recursive: true })

// Count migrations
const migrationGlob = new Glob('**/*')
let migrationCount = 0
for await (const _ of migrationGlob.scan({
  cwd: migrationsDir,
  onlyFiles: true,
})) {
  migrationCount++
}
step(`Copied ${migrationCount} migration files`)

// --- 6. Write version.json ---

const versionJson = {
  version,
  commit,
  builtAt: new Date().toISOString(),
}
await Bun.write(resolve(STAGE, 'version.json'), JSON.stringify(versionJson, null, 2))
step('Generated version.json')

// --- 7. Create tar.gz archive ---

step('Creating tar.gz package...')

// Remove existing output file
if (existsSync(outfile)) {
  rmSync(outfile)
}

const tar = Bun.spawn(['tar', '-czf', outfile, '-C', STAGE, '.'], {
  cwd: ROOT,
  stdio: ['inherit', 'inherit', 'inherit'],
})
const tarCode = await tar.exited
if (tarCode !== 0) fatal('tar.gz creation failed')

const archiveStat = Bun.file(outfile)
step(`Archive: ${outfile}`)
step(`Size: ${(archiveStat.size / 1024 / 1024).toFixed(1)} MB`)

// --- 8. Generate SHA-256 checksum ---

step('Generating SHA-256 checksum...')
const hasher = new Bun.CryptoHasher('sha256')
const archiveData = await Bun.file(outfile).arrayBuffer()
hasher.update(new Uint8Array(archiveData))
const sha256 = hasher.digest('hex')
const checksumFile = resolve(OUT_DIR, 'checksums.txt')
const archiveName = outfile.split('/').pop() ?? 'bkd-app.tar.gz'
const entry = `${sha256}  ${archiveName}\n`
const existing = existsSync(checksumFile) ? await Bun.file(checksumFile).text() : ''
await Bun.write(checksumFile, existing + entry)
step(`SHA-256: ${sha256}`)
step(`Checksum file: ${checksumFile}`)

// --- 9. Clean up staging ---

rmSync(STAGE, { recursive: true })

step('Done!')
step(`Package: ${outfile} (${(archiveStat.size / 1024 / 1024).toFixed(1)} MB)`)
