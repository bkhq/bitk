import { getAppSetting, setAppSetting } from '@/db/helpers'
import { logger } from '@/logger'
import {
  detectPlatformAssetSuffix,
  isNewerVersion,
  resolveDownloadFileName,
} from '@/upgrade/utils'
import { COMMIT, VERSION } from '@/version'
import { UPGRADE_CHECK_RESULT_KEY, isPackageMode } from './constants'
import { fetchLatestRelease } from './github'
import type { ReleaseAsset, UpgradeCheckResult } from './types'

/** Force-check GitHub for the latest release and persist the result */
export async function checkForUpdates(): Promise<UpgradeCheckResult> {
  const release = await fetchLatestRelease()
  const now = new Date().toISOString()

  if (!release) {
    const result: UpgradeCheckResult = {
      hasUpdate: false,
      currentVersion: VERSION,
      currentCommit: COMMIT,
      latestVersion: null,
      latestTag: null,
      publishedAt: null,
      downloadUrl: null,
      checksumUrl: null,
      assetName: null,
      assetSize: null,
      downloadFileName: null,
      checkedAt: now,
    }
    await setAppSetting(UPGRADE_CHECK_RESULT_KEY, JSON.stringify(result))
    return result
  }

  // In package mode, look for app package archives (e.g. bitk-app-v0.0.6.tar.gz).
  // In binary mode, look for platform-specific binaries (e.g. bitk-linux-x64-v0.0.6).
  let matchingAsset: ReleaseAsset | undefined
  if (isPackageMode) {
    matchingAsset = release.assets.find(
      (a) =>
        a.name.startsWith('bitk-app') &&
        a.name.endsWith('.tar.gz') &&
        !a.name.endsWith('.sha256'),
    )
  } else {
    const suffix = detectPlatformAssetSuffix()
    matchingAsset = release.assets.find(
      (a) =>
        a.name.includes(suffix) &&
        !a.name.endsWith('.sha256') &&
        !a.name.endsWith('.tar.gz'),
    )
  }
  // Find checksums.txt (preferred), fallback to legacy per-asset .sha256
  const checksumAsset =
    release.assets.find((a) => a.name === 'checksums.txt') ??
    release.assets.find((a) => a.name === `${matchingAsset?.name}.sha256`)
  // Only report an update if a newer version exists AND a matching asset is available
  const hasUpdate = !!matchingAsset && isNewerVersion(VERSION, release.version)

  const downloadFileName = matchingAsset
    ? resolveDownloadFileName(matchingAsset.name, release.version, isPackageMode)
    : null

  const result: UpgradeCheckResult = {
    hasUpdate,
    currentVersion: VERSION,
    currentCommit: COMMIT,
    latestVersion: release.version,
    latestTag: release.tag,
    publishedAt: release.publishedAt,
    downloadUrl: matchingAsset?.downloadUrl ?? null,
    checksumUrl: checksumAsset?.downloadUrl ?? null,
    assetName: matchingAsset?.name ?? null,
    assetSize: matchingAsset?.size ?? null,
    downloadFileName,
    checkedAt: now,
  }

  await setAppSetting(UPGRADE_CHECK_RESULT_KEY, JSON.stringify(result))

  if (hasUpdate) {
    logger.info(
      {
        currentVersion: VERSION,
        latestVersion: release.version,
        hasMatchingAsset: !!matchingAsset,
        hasChecksum: !!checksumAsset,
      },
      'upgrade_available',
    )
  }

  return result
}

/** Retrieve the last cached check result from app settings */
export async function getLastCheckResult(): Promise<UpgradeCheckResult | null> {
  const raw = await getAppSetting(UPGRADE_CHECK_RESULT_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as UpgradeCheckResult
  } catch {
    return null
  }
}
