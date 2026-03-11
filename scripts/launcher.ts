#!/usr/bin/env bun
/**
 * Launcher entry point for package mode.
 *
 * Compiled into a standalone Bun binary, this launcher:
 * 1. Reads `data/app/version.json` to determine the active version
 * 2. If no local version exists, auto-downloads the latest release from GitHub
 * 3. Dynamically imports and runs `data/app/v{version}/server.js`
 *
 * The launcher binary (~90 MB) is distributed once. Subsequent updates only
 * require downloading a small app package tar.gz (~1 MB).
 *
 * Version layout:
 *   data/app/version.json   — {"version":"0.0.6","updatedAt":"..."}
 *   data/app/v0.0.5/        — server.js, public/, migrations/, version.json
 *   data/app/v0.0.6/        — newer version
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { cli } from 'cleye'

// --- Constants ---

declare const __BKD_COMMIT__: string | undefined
const LAUNCHER_COMMIT = typeof __BKD_COMMIT__ !== 'undefined' ? __BKD_COMMIT__ : 'dev'

function resolveAppVersion(): string {
  const rootDir = process.env.BKD_ROOT ? resolve(process.env.BKD_ROOT) : dirname(process.execPath)
  const vf = resolve(rootDir, 'data/app/version.json')
  if (existsSync(vf)) {
    try {
      const data = JSON.parse(readFileSync(vf, 'utf8'))
      if (typeof data.version === 'string') return data.version
    } catch {}
  }
  return 'unknown'
}

function getVersionString(): string {
  const appVersion = resolveAppVersion()
  const app = appVersion !== 'unknown' ? appVersion : 'dev'
  return `${app} (launcher:v1 ${LAUNCHER_COMMIT})`
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/
const SHA256_RE = /^[a-f0-9]{64}$/
const GITHUB_REPO = 'bkhq/bkd'
const APP_PKG_RE = /^bkd-app-v(\d+\.\d+\.\d+)\.tar\.gz$/
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024 // 50 MB
const ALLOWED_HOSTS = new Set(['github.com', 'objects.githubusercontent.com'])
const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const
const MAX_RETRIES = 3
const BASE_DELAY_MS = 2_000

// --- Types ---

interface ReleaseAsset {
  name: string
  downloadUrl: string
}

interface AppPackageInfo {
  version: string
  asset: ReleaseAsset
  checksumAsset: ReleaseAsset | null
}

// --- Utility functions ---

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function isAllowedHost(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return ALLOWED_HOSTS.has(host)
  } catch {
    return false
  }
}

// --- Auto-download: fetch release info ---

async function fetchLatestAppPackage(): Promise<AppPackageInfo | null> {
  console.log('[launcher] Checking GitHub for latest release...')
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'bkd-launcher',
      },
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      console.error(`[launcher] GitHub API returned ${res.status}`)
      return null
    }

    const data = (await res.json()) as {
      tag_name: string
      assets: Array<{
        name: string
        browser_download_url: string
      }>
    }

    if (!Array.isArray(data?.assets)) {
      console.error('[launcher] Unexpected GitHub API response shape')
      return null
    }

    let pkgAsset: ReleaseAsset | null = null
    let pkgVersion: string | null = null
    let checksumAsset: ReleaseAsset | null = null

    for (const a of data.assets) {
      const m = a.name.match(APP_PKG_RE)
      if (m) {
        pkgAsset = { name: a.name, downloadUrl: a.browser_download_url }
        pkgVersion = m[1]
      }
      if (a.name === 'checksums.txt') {
        checksumAsset = { name: a.name, downloadUrl: a.browser_download_url }
      }
    }

    // Fallback: legacy per-asset .sha256 file
    if (!checksumAsset && pkgAsset) {
      const legacy = data.assets.find(a => a.name === `${pkgAsset!.name}.sha256`)
      if (legacy) {
        checksumAsset = {
          name: legacy.name,
          downloadUrl: legacy.browser_download_url,
        }
      }
    }

    if (!pkgAsset || !pkgVersion) {
      console.error('[launcher] No app package found in latest release')
      return null
    }

    return { version: pkgVersion, asset: pkgAsset, checksumAsset }
  } catch (err) {
    console.error(
      '[launcher] Failed to fetch release info:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

// --- Auto-download: download file ---

async function downloadToFile(url: string, destPath: string): Promise<Buffer | null> {
  if (!isAllowedHost(url)) {
    console.error(`[launcher] Refusing download from untrusted host: ${url}`)
    return null
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 300_000)

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'bkd-launcher' },
      signal: controller.signal,
    })

    if (!res.ok || !res.body) {
      console.error(`[launcher] Download failed: ${res.status}`)
      return null
    }

    const totalBytes = Number(res.headers.get('content-length') || 0)
    if (totalBytes > MAX_DOWNLOAD_BYTES) {
      console.error(`[launcher] Download too large: ${totalBytes} bytes`)
      return null
    }

    const chunks: Uint8Array[] = []
    let downloaded = 0

    for await (const chunk of res.body) {
      chunks.push(chunk)
      downloaded += chunk.length
      if (downloaded > MAX_DOWNLOAD_BYTES) {
        console.error('[launcher] Download exceeded maximum allowed size')
        controller.abort()
        return null
      }
      if (totalBytes > 0) {
        const pct = ((downloaded / totalBytes) * 100).toFixed(0)
        process.stdout.write(`\r[launcher] Progress: ${pct}%`)
      }
    }
    if (totalBytes > 0) process.stdout.write('\n')

    const data = Buffer.concat(chunks)
    await Bun.write(destPath, data)
    return data
  } finally {
    clearTimeout(timeout)
  }
}

// --- Auto-download: verify checksum ---

async function verifyChecksum(
  data: Buffer,
  checksumAsset: ReleaseAsset,
  assetName: string,
): Promise<boolean> {
  console.log('[launcher] Verifying checksum...')

  if (!isAllowedHost(checksumAsset.downloadUrl)) {
    console.error(
      `[launcher] Refusing checksum fetch from untrusted host: ${checksumAsset.downloadUrl}`,
    )
    return false
  }

  const csRes = await fetch(checksumAsset.downloadUrl, {
    headers: { 'User-Agent': 'bkd-launcher' },
    signal: AbortSignal.timeout(15_000),
  })

  if (!csRes.ok) {
    console.error(`[launcher] Failed to fetch checksums.txt: ${csRes.status}`)
    return false
  }

  const csText = (await csRes.text()).trim()

  // Parse checksums.txt: each line is "<sha256>  <filename>"
  let expectedHash: string | null = null
  for (const line of csText.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 2 && parts[1] === assetName) {
      expectedHash = parts[0].toLowerCase()
      break
    }
  }

  if (!expectedHash) {
    console.error(`[launcher] Asset ${assetName} not found in checksums.txt`)
    return false
  }

  if (!SHA256_RE.test(expectedHash)) {
    console.error('[launcher] Invalid checksum format in checksums.txt')
    return false
  }

  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(data)
  const actualHash = hasher.digest('hex')

  if (actualHash !== expectedHash) {
    console.error(
      `[launcher] Checksum mismatch!\n  expected: ${expectedHash}\n  actual:   ${actualHash}`,
    )
    return false
  }

  console.log('[launcher] Checksum verified')
  return true
}

// --- Auto-download: extract and install ---

async function extractAndInstall(
  tmpFile: string,
  versionDir: string,
  appBase: string,
): Promise<boolean> {
  const tmpExtractDir = resolve(appBase, `${versionDir}.tmp.${Date.now()}`)
  mkdirSync(tmpExtractDir, { recursive: true })

  try {
    const proc = Bun.spawn(['tar', '-xzf', tmpFile, '-C', tmpExtractDir, '--no-same-owner'], {
      stdout: 'inherit',
      stderr: 'inherit',
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      console.error(`[launcher] tar extract failed with code ${exitCode}`)
      rmSync(tmpExtractDir, { recursive: true, force: true })
      return false
    }

    if (existsSync(versionDir)) {
      rmSync(versionDir, { recursive: true })
    }
    await rename(tmpExtractDir, versionDir)
    return true
  } catch (err) {
    console.error('[launcher] Extract/install failed:', err instanceof Error ? err.message : err)
    rmSync(tmpExtractDir, { recursive: true, force: true })
    return false
  }
}

// --- Auto-download: orchestrator ---

async function downloadAndExtract(
  info: AppPackageInfo,
  dataDir: string,
  appBase: string,
): Promise<boolean> {
  // Re-validate inputs from API response
  if (!APP_PKG_RE.test(info.asset.name)) {
    console.error(`[launcher] Invalid asset name: ${info.asset.name}`)
    return false
  }
  if (!SEMVER_RE.test(info.version)) {
    console.error(`[launcher] Invalid version: ${info.version}`)
    return false
  }

  const tmpFile = resolve(dataDir, `${info.asset.name}.tmp`)
  const versionDir = resolve(appBase, `v${info.version}`)

  // Verify paths stay within expected directories
  if (!tmpFile.startsWith(`${dataDir}/`)) {
    console.error('[launcher] Temp file path escapes data directory')
    return false
  }
  if (!versionDir.startsWith(`${appBase}/`)) {
    console.error('[launcher] Version dir escapes app directory')
    return false
  }

  mkdirSync(dataDir, { recursive: true })

  try {
    console.log(`[launcher] Downloading ${info.asset.name}...`)
    const data = await downloadToFile(info.asset.downloadUrl, tmpFile)
    if (!data) {
      rmSync(tmpFile, { force: true })
      return false
    }

    // Checksum verification is mandatory
    if (!info.checksumAsset) {
      console.error(
        '[launcher] No checksum asset found — refusing to install without integrity verification',
      )
      rmSync(tmpFile, { force: true })
      return false
    }
    const valid = await verifyChecksum(data, info.checksumAsset, info.asset.name)
    if (!valid) {
      rmSync(tmpFile, { force: true })
      return false
    }

    console.log(`[launcher] Extracting to v${info.version}...`)
    const ok = await extractAndInstall(tmpFile, versionDir, appBase)
    if (!ok) {
      rmSync(tmpFile, { force: true })
      return false
    }

    // Validate extracted package contains server.js before activating
    const serverJs = resolve(versionDir, 'server.js')
    if (!existsSync(serverJs)) {
      console.error(`[launcher] Extracted package is missing server.js — removing broken version`)
      rmSync(versionDir, { recursive: true, force: true })
      rmSync(tmpFile, { force: true })
      return false
    }

    rmSync(tmpFile, { force: true })
    console.log(`[launcher] Version ${info.version} installed successfully`)
    return true
  } catch (err) {
    console.error('[launcher] Download/extract failed:', err instanceof Error ? err.message : err)
    rmSync(tmpFile, { force: true })
    return false
  }
}

// --- DB repair (--fix-db) ---

async function repairDatabase(dbPath: string, migrationsDir: string) {
  console.log('[launcher] Running database repair (re-applying migrations)...')

  if (!existsSync(dbPath)) {
    console.log('[launcher] No database file found, nothing to repair.')
    return
  }

  const journalFile = resolve(migrationsDir, 'meta/_journal.json')
  if (!existsSync(journalFile)) {
    console.error(`[launcher] Migrations not found at: ${migrationsDir}`)
    process.exit(1)
  }

  // Use Bun's subprocess to run drizzle migrate against the DB.
  // We spawn a small inline script so that the import of drizzle
  // does not pollute the launcher's module cache.
  const script = `
    import { Database } from 'bun:sqlite';
    import { drizzle } from 'drizzle-orm/bun-sqlite';
    import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
    const sqlite = new Database(${JSON.stringify(dbPath)});
    sqlite.run('PRAGMA journal_mode = WAL');
    sqlite.run('PRAGMA foreign_keys = OFF');
    const db = drizzle({ client: sqlite });
    migrate(db, { migrationsFolder: ${JSON.stringify(migrationsDir)} });
    sqlite.run('PRAGMA foreign_keys = ON');
    console.log('[repair] Migrations applied successfully.');
  `
  const proc = Bun.spawn(['bun', 'eval', script], {
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env as Record<string, string>,
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    console.error('[launcher] Database repair failed.')
    process.exit(1)
  }
  console.log('[launcher] Database repair complete.')
}

// --- CLI parsing ---

const versionStr = getVersionString()

const argv = cli({
  name: 'bkd',
  version: versionStr,
  flags: {
    port: {
      type: String,
      alias: 'p',
      description: 'Listen port (env: PORT)',
      default: process.env.PORT ?? '3000',
    },
    host: {
      type: String,
      description: 'Listen host (env: HOST)',
      default: process.env.HOST ?? '0.0.0.0',
    },
    dataDir: {
      type: String,
      alias: 'd',
      description: 'Data directory (env: BKD_DATA_DIR)',
    },
    logLevel: {
      type: String,
      alias: 'l',
      description: `Log level: ${LOG_LEVELS.join('|')} (env: LOG_LEVEL)`,
      default: process.env.LOG_LEVEL ?? 'info',
    },
    fixDb: {
      type: Boolean,
      description: 'Re-apply database migrations before starting',
      default: false,
    },
  },
  help: {
    description: 'Kanban board for AI coding agents',
    examples: [
      'bkd',
      'bkd --port 8080 --host 0.0.0.0',
      'bkd --data-dir /opt/bkd/data',
      'bkd --fix-db',
    ],
  },
})

// --- Main ---

async function main() {
  const { flags } = argv

  // Validate log level
  if (!LOG_LEVELS.includes(flags.logLevel as typeof LOG_LEVELS[number])) {
    console.error(`[launcher] Invalid log level: ${flags.logLevel}`)
    console.error(`[launcher] Valid levels: ${LOG_LEVELS.join(', ')}`)
    process.exit(1)
  }

  // Apply CLI args to environment (CLI takes precedence)
  process.env.PORT = flags.port
  process.env.HOST = flags.host
  process.env.LOG_LEVEL = flags.logLevel

  // Resolve directories
  const rootDir = process.env.BKD_ROOT
    ? resolve(process.env.BKD_ROOT)
    : dirname(process.execPath)

  const dataDir = flags.dataDir
    ? resolve(flags.dataDir)
    : process.env.BKD_DATA_DIR
      ? resolve(process.env.BKD_DATA_DIR)
      : resolve(rootDir, 'data')

  if (flags.dataDir) {
    process.env.BKD_DATA_DIR = dataDir
  }

  const appBase = resolve(dataDir, 'app')
  const versionFile = resolve(appBase, 'version.json')

  // Set DB_PATH if not already set
  if (!process.env.DB_PATH) {
    process.env.DB_PATH = resolve(dataDir, 'db/bkd.db')
  }

  // --- Resolve version ---

  let version: string | null = null

  // 1. Read version.json
  if (existsSync(versionFile)) {
    try {
      const data = JSON.parse(await Bun.file(versionFile).text())
      version = typeof data.version === 'string' ? data.version : null
    } catch {
      console.error('[launcher] Failed to parse data/app/version.json')
    }
  }

  // 2. Auto-detect from v* directories
  if (!version) {
    if (existsSync(appBase)) {
      try {
        const versions = readdirSync(appBase, { withFileTypes: true })
          .filter(d => d.isDirectory() && /^v\d+\.\d+\.\d+$/.test(d.name))
          .map(d => d.name.slice(1))
          .sort(compareSemver)
        version = versions.length > 0 ? versions.at(-1) ?? null : null
      } catch (err) {
        console.error(
          `[launcher] Failed to scan ${appBase}:`,
          err instanceof Error ? err.message : err,
        )
      }
    }
    if (version) {
      console.log(`[launcher] No version.json, auto-detected version: ${version}`)
      mkdirSync(appBase, { recursive: true })
      await Bun.write(
        versionFile,
        JSON.stringify({ version, updatedAt: new Date().toISOString() }),
      )
    }
  }

  if (version && !SEMVER_RE.test(version)) {
    console.error(`[launcher] Invalid version in current file: ${JSON.stringify(version)}`)
    process.exit(1)
  }

  // 3. Auto-download from GitHub if no local version
  if (!version) {
    console.log('[launcher] No app version found locally, attempting auto-download...')

    const latest = await fetchLatestAppPackage()
    if (!latest) {
      console.error('[launcher] Could not fetch latest release.')
      console.error('')
      console.error('Manual setup:')
      console.error('  1. Download the app package from GitHub releases')
      console.error(`  2. mkdir -p ${appBase}/v<VERSION>`)
      console.error(`  3. tar -xzf bkd-app-v<VERSION>.tar.gz -C ${appBase}/v<VERSION>`)
      console.error(`  4. echo '{"version":"<VERSION>"}' > ${versionFile}`)
      console.error('  5. Run this launcher again')
      mkdirSync(dataDir, { recursive: true })
      process.exit(1)
    }

    const ok = await downloadAndExtract(latest, dataDir, appBase)
    if (!ok) {
      process.exit(1)
    }

    mkdirSync(appBase, { recursive: true })
    await Bun.write(
      versionFile,
      JSON.stringify({ version: latest.version, updatedAt: new Date().toISOString() }),
    )
    version = latest.version
  }

  // 4. Verify server exists
  const appDir = resolve(appBase, `v${version}`)
  const serverPath = resolve(appDir, 'server.js')

  if (!existsSync(serverPath)) {
    console.error(`[launcher] Version ${version} not found: ${serverPath}`)
    process.exit(1)
  }

  // 5. Run DB repair if requested
  if (flags.fixDb) {
    const migrationsDir = resolve(appDir, 'migrations')
    await repairDatabase(process.env.DB_PATH!, migrationsDir)
  }

  console.log(`[launcher] Starting version ${version}`)

  // 6. Start server
  await import(serverPath)
}

// --- Retry wrapper ---

async function mainWithRetry() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await main()
      return
    } catch (err) {
      const isLast = attempt >= MAX_RETRIES
      console.error(
        `[launcher] Startup failed (attempt ${attempt}/${MAX_RETRIES}):`,
        err instanceof Error ? err.message : err,
      )
      if (isLast) {
        console.error('[launcher] All retry attempts exhausted, exiting.')
        process.exit(1)
      }
      const delay = BASE_DELAY_MS * (2 ** (attempt - 1))
      console.log(`[launcher] Retrying in ${delay / 1000}s...`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}

mainWithRetry().catch((err) => {
  console.error('[launcher] Fatal error:', err)
  process.exit(1)
})
