#!/usr/bin/env bun
/**
 * Minimal launcher entry point for package mode.
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
 *
 * Usage:
 *   ./bkd-launcher              # run from binary location
 *   BKD_ROOT=/opt/bkd ./bkd   # override root directory
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

// --- Constants ---

const ROOT_DIR = process.env.BKD_ROOT ? resolve(process.env.BKD_ROOT) : dirname(process.execPath)

const APP_BASE = resolve(ROOT_DIR, 'data/app')
const VERSION_FILE = resolve(APP_BASE, 'version.json')
const SEMVER_RE = /^\d+\.\d+\.\d+$/
const SHA256_RE = /^[a-f0-9]{64}$/
const GITHUB_REPO = 'bkhq/bkd'
const APP_PKG_RE = /^bkd-app-v(\d+\.\d+\.\d+)\.tar\.gz$/
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024 // 50 MB

const ALLOWED_HOSTS = new Set(['github.com', 'objects.githubusercontent.com'])

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

async function writeVersionFile(ver: string): Promise<void> {
  mkdirSync(APP_BASE, { recursive: true })
  await Bun.write(
    VERSION_FILE,
    JSON.stringify({ version: ver, updatedAt: new Date().toISOString() }),
  )
}

function detectLatestVersion(): string | null {
  if (!existsSync(APP_BASE)) return null
  try {
    const versions = readdirSync(APP_BASE, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^v\d+\.\d+\.\d+$/.test(d.name))
      .map(d => d.name.slice(1))
      .sort(compareSemver)
    return versions.length > 0 ? versions.at(-1) : null
  } catch (err) {
    console.error(
      `[launcher] Failed to scan ${APP_BASE}:`,
      err instanceof Error ? err.message : err,
    )
    return null
  }
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

async function extractAndInstall(tmpFile: string, versionDir: string): Promise<boolean> {
  const tmpExtractDir = resolve(APP_BASE, `${versionDir}.tmp.${Date.now()}`)
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

async function downloadAndExtract(info: AppPackageInfo): Promise<boolean> {
  // Re-validate inputs from API response
  if (!APP_PKG_RE.test(info.asset.name)) {
    console.error(`[launcher] Invalid asset name: ${info.asset.name}`)
    return false
  }
  if (!SEMVER_RE.test(info.version)) {
    console.error(`[launcher] Invalid version: ${info.version}`)
    return false
  }

  const dataDir = resolve(ROOT_DIR, 'data')
  const tmpFile = resolve(dataDir, `${info.asset.name}.tmp`)
  const versionDir = resolve(APP_BASE, `v${info.version}`)

  // Verify paths stay within expected directories
  if (!tmpFile.startsWith(`${dataDir}/`)) {
    console.error('[launcher] Temp file path escapes data directory')
    return false
  }
  if (!versionDir.startsWith(`${APP_BASE}/`)) {
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
    const ok = await extractAndInstall(tmpFile, versionDir)
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

    await writeVersionFile(info.version)
    rmSync(tmpFile, { force: true })
    console.log(`[launcher] Version ${info.version} installed successfully`)
    return true
  } catch (err) {
    console.error('[launcher] Download/extract failed:', err instanceof Error ? err.message : err)
    rmSync(tmpFile, { force: true })
    return false
  }
}

// --- Main ---

async function main() {
  let version: string | null = null

  // 1. Read version.json
  if (existsSync(VERSION_FILE)) {
    try {
      const data = JSON.parse(await Bun.file(VERSION_FILE).text())
      version = typeof data.version === 'string' ? data.version : null
    } catch {
      console.error('[launcher] Failed to parse data/app/version.json')
    }
  }

  // 2. Auto-detect from v* directories
  if (!version) {
    version = detectLatestVersion()
    if (version) {
      console.log(`[launcher] No version.json, auto-detected version: ${version}`)
      await writeVersionFile(version)
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
      console.error(`  2. mkdir -p ${APP_BASE}/v<VERSION>`)
      console.error(`  3. tar -xzf bkd-app-v<VERSION>.tar.gz -C ${APP_BASE}/v<VERSION>`)
      console.error(`  4. echo '{"version":"<VERSION>"}' > ${VERSION_FILE}`)
      console.error('  5. Run this launcher again')
      mkdirSync(resolve(ROOT_DIR, 'data'), { recursive: true })
      process.exit(1)
    }

    const ok = await downloadAndExtract(latest)
    if (!ok) {
      process.exit(1)
    }
    version = latest.version
  }

  // 4. Verify server exists
  const appDir = resolve(APP_BASE, `v${version}`)
  const serverPath = resolve(appDir, 'server.js')

  if (!existsSync(serverPath)) {
    console.error(`[launcher] Version ${version} not found: ${serverPath}`)
    const latest = detectLatestVersion()
    if (latest && latest !== version) {
      console.error(`[launcher] Available version: ${latest}`)
    }
    process.exit(1)
  }

  console.log(`[launcher] Starting version ${version}`)

  // 5. Start server
  try {
    await import(serverPath)
  } catch (err) {
    console.error('[launcher] Failed to start server:', err)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[launcher] Fatal error:', err)
  process.exit(1)
})
