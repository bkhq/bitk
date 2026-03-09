export interface ReleaseInfo {
  version: string
  tag: string
  publishedAt: string
  htmlUrl: string
  assets: ReleaseAsset[]
}

export interface ReleaseAsset {
  name: string
  size: number
  downloadUrl: string
  contentType: string
}

export interface UpgradeCheckResult {
  hasUpdate: boolean
  currentVersion: string
  currentCommit: string
  latestVersion: string | null
  latestTag: string | null
  publishedAt: string | null
  downloadUrl: string | null
  checksumUrl: string | null
  assetName: string | null
  assetSize: number | null
  downloadFileName: string | null
  checkedAt: string
}

export interface DownloadStatus {
  status: 'idle' | 'downloading' | 'verifying' | 'verified' | 'completed' | 'failed'
  progress: number // 0-100
  fileName: string | null
  filePath: string | null
  error: string | null
  checksumMatch: boolean | null
}
