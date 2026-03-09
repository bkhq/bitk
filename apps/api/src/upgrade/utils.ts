/**
 * Pure utility functions for the upgrade system.
 * Extracted for testability and to keep service.ts under the 800-line limit.
 */

// Matches: bkd-linux-x64-v0.0.5, bkd-darwin-arm64-v0.0.5, bkd-app-v0.0.5.tar.gz
export const VALID_FILE_NAME_RE = /^bkd-[\w-]+-v\d+\.\d+\.\d+(?:\.tar\.gz)?$/

/** Extract semver from package archive filename (e.g. "bkd-app-v0.0.6.tar.gz" → "0.0.6") */
export function parseVersionFromFileName(fileName: string): string | null {
  const match = fileName.match(/^bkd-app-v(\d+\.\d+\.\d+)\.tar\.gz$/)
  return match ? match[1] : null
}

/** Check if `latest` is a newer semver than `current`. `dev` is always behind. */
export function isNewerVersion(current: string, latest: string): boolean {
  // dev is always "behind" any real version
  if (current === 'dev') return true

  const parseParts = (v: string) =>
    v
      .replace(/^v/, '')
      .split('.')
      .map(p => Number.parseInt(p, 10) || 0)

  const curr = parseParts(current)
  const lat = parseParts(latest)

  for (let i = 0; i < Math.max(curr.length, lat.length); i++) {
    const c = curr[i] ?? 0
    const l = lat[i] ?? 0
    if (l > c) return true
    if (l < c) return false
  }
  return false
}

/** Detect platform asset suffix (e.g. "linux-x64", "darwin-arm64") */
export function detectPlatformAssetSuffix(): string {
  const platform = process.platform
  const arch = process.arch
  const osMap: Record<string, string> = {
    linux: 'linux',
    darwin: 'darwin',
    win32: 'windows',
  }
  const archMap: Record<string, string> = {
    x64: 'x64',
    arm64: 'arm64',
  }
  const os = osMap[platform] ?? platform
  const a = archMap[arch] ?? arch
  return `${os}-${a}`
}

/**
 * Resolve the local download filename for an asset.
 * If the original asset name already matches the versioned pattern, use it.
 * Otherwise construct a valid filename from the release version + platform,
 * so downloads work even when GitHub assets lack a version suffix
 * (e.g. "bkd-linux-x64" instead of "bkd-linux-x64-v0.0.3").
 */
export function resolveDownloadFileName(
  assetName: string,
  releaseVersion: string,
  packageMode: boolean,
): string {
  if (VALID_FILE_NAME_RE.test(assetName)) {
    return assetName
  }
  if (packageMode) {
    return `bkd-app-v${releaseVersion}.tar.gz`
  }
  const suffix = detectPlatformAssetSuffix()
  return `bkd-${suffix}-v${releaseVersion}`
}

/** Validate that a resolved file path is within the expected directory. */
export function isPathWithinDir(filePath: string, dir: string): boolean {
  return filePath.startsWith(`${dir}/`)
}
