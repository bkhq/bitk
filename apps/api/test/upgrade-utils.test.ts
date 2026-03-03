import { describe, expect, it } from 'bun:test'
import {
  detectPlatformAssetSuffix,
  isNewerVersion,
  isPathWithinDir,
  parseVersionFromFileName,
  resolveDownloadFileName,
  VALID_FILE_NAME_RE,
} from '@/upgrade/utils'

describe('isNewerVersion', () => {
  it('dev is always behind any real version', () => {
    expect(isNewerVersion('dev', '0.0.1')).toBe(true)
    expect(isNewerVersion('dev', '1.0.0')).toBe(true)
  })

  it('detects newer patch version', () => {
    expect(isNewerVersion('0.0.1', '0.0.2')).toBe(true)
    expect(isNewerVersion('0.0.5', '0.0.6')).toBe(true)
  })

  it('detects newer minor version', () => {
    expect(isNewerVersion('0.1.0', '0.2.0')).toBe(true)
  })

  it('detects newer major version', () => {
    expect(isNewerVersion('1.0.0', '2.0.0')).toBe(true)
  })

  it('returns false for same version', () => {
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
    expect(isNewerVersion('0.0.5', '0.0.5')).toBe(false)
  })

  it('returns false for older version', () => {
    expect(isNewerVersion('0.0.6', '0.0.5')).toBe(false)
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(false)
    expect(isNewerVersion('2.0.0', '1.99.99')).toBe(false)
  })

  it('handles versions with v prefix', () => {
    expect(isNewerVersion('v0.0.5', 'v0.0.6')).toBe(true)
    expect(isNewerVersion('v0.0.6', 'v0.0.5')).toBe(false)
  })

  it('handles double-digit version segments correctly', () => {
    expect(isNewerVersion('0.0.9', '0.0.10')).toBe(true)
    expect(isNewerVersion('0.0.10', '0.0.9')).toBe(false)
    expect(isNewerVersion('0.9.0', '0.10.0')).toBe(true)
  })
})

describe('parseVersionFromFileName', () => {
  it('extracts version from valid app package filenames', () => {
    expect(parseVersionFromFileName('bitk-app-v0.0.5.tar.gz')).toBe('0.0.5')
    expect(parseVersionFromFileName('bitk-app-v1.2.3.tar.gz')).toBe('1.2.3')
    expect(parseVersionFromFileName('bitk-app-v10.20.30.tar.gz')).toBe(
      '10.20.30',
    )
  })

  it('returns null for binary filenames', () => {
    expect(parseVersionFromFileName('bitk-linux-x64-v0.0.5')).toBeNull()
    expect(parseVersionFromFileName('bitk-darwin-arm64-v0.0.5')).toBeNull()
  })

  it('returns null for checksum files', () => {
    expect(parseVersionFromFileName('bitk-app-v0.0.5.tar.gz.sha256')).toBeNull()
  })

  it('returns null for empty or garbage input', () => {
    expect(parseVersionFromFileName('')).toBeNull()
    expect(parseVersionFromFileName('random-file.txt')).toBeNull()
    expect(parseVersionFromFileName('../../../etc/passwd')).toBeNull()
  })

  it('returns null for non-semver versions', () => {
    expect(parseVersionFromFileName('bitk-app-v1.tar.gz')).toBeNull()
    expect(parseVersionFromFileName('bitk-app-v1.2.tar.gz')).toBeNull()
    expect(parseVersionFromFileName('bitk-app-vabc.tar.gz')).toBeNull()
  })
})

describe('VALID_FILE_NAME_RE', () => {
  it('matches valid binary filenames', () => {
    expect(VALID_FILE_NAME_RE.test('bitk-linux-x64-v0.0.5')).toBe(true)
    expect(VALID_FILE_NAME_RE.test('bitk-darwin-arm64-v1.2.3')).toBe(true)
    expect(VALID_FILE_NAME_RE.test('bitk-linux-arm64-v0.0.5')).toBe(true)
  })

  it('matches valid app package filenames', () => {
    expect(VALID_FILE_NAME_RE.test('bitk-app-v0.0.5.tar.gz')).toBe(true)
    expect(VALID_FILE_NAME_RE.test('bitk-app-v1.0.0.tar.gz')).toBe(true)
  })

  it('matches launcher filenames', () => {
    expect(VALID_FILE_NAME_RE.test('bitk-launcher-linux-x64-v0.0.5')).toBe(true)
    expect(VALID_FILE_NAME_RE.test('bitk-launcher-darwin-arm64-v1.0.0')).toBe(
      true,
    )
  })

  it('rejects path traversal attempts', () => {
    expect(VALID_FILE_NAME_RE.test('../../../etc/passwd')).toBe(false)
    expect(VALID_FILE_NAME_RE.test('../../evil')).toBe(false)
    expect(VALID_FILE_NAME_RE.test('/etc/passwd')).toBe(false)
  })

  it('rejects filenames without bitk prefix', () => {
    expect(VALID_FILE_NAME_RE.test('malware-v0.0.1')).toBe(false)
    expect(VALID_FILE_NAME_RE.test('v0.0.1')).toBe(false)
  })

  it('rejects filenames without version', () => {
    expect(VALID_FILE_NAME_RE.test('bitk-linux-x64')).toBe(false)
    expect(VALID_FILE_NAME_RE.test('bitk-app.tar.gz')).toBe(false)
  })

  it('rejects sha256 checksum files', () => {
    expect(VALID_FILE_NAME_RE.test('bitk-linux-x64-v0.0.5.sha256')).toBe(false)
    expect(VALID_FILE_NAME_RE.test('bitk-app-v0.0.5.tar.gz.sha256')).toBe(false)
  })

  it('rejects filenames with spaces or special characters', () => {
    expect(VALID_FILE_NAME_RE.test('bitk linux-x64-v0.0.5')).toBe(false)
    expect(VALID_FILE_NAME_RE.test('bitk-linux;rm -rf /-v0.0.5')).toBe(false)
  })
})

describe('isPathWithinDir', () => {
  it('accepts paths within the directory', () => {
    expect(isPathWithinDir('/data/updates/file.tar.gz', '/data/updates')).toBe(
      true,
    )
    expect(isPathWithinDir('/data/updates/subdir/file', '/data/updates')).toBe(
      true,
    )
  })

  it('rejects paths outside the directory', () => {
    expect(isPathWithinDir('/etc/passwd', '/data/updates')).toBe(false)
    expect(isPathWithinDir('/data/other/file', '/data/updates')).toBe(false)
  })

  it('rejects the directory itself (without trailing slash)', () => {
    expect(isPathWithinDir('/data/updates', '/data/updates')).toBe(false)
  })

  it('rejects directory prefix attacks', () => {
    // "/data/updates-evil/file" starts with "/data/updates" but is outside
    expect(isPathWithinDir('/data/updates-evil/file', '/data/updates')).toBe(
      false,
    )
  })
})

describe('resolveDownloadFileName', () => {
  it('returns original name when it already has a version suffix', () => {
    expect(
      resolveDownloadFileName('bitk-linux-x64-v0.0.3', '0.0.3', false),
    ).toBe('bitk-linux-x64-v0.0.3')
    expect(
      resolveDownloadFileName('bitk-app-v0.0.5.tar.gz', '0.0.5', true),
    ).toBe('bitk-app-v0.0.5.tar.gz')
  })

  it('constructs versioned filename for unversioned binary assets', () => {
    // Asset named "bitk-linux-x64" without version → construct from platform
    const result = resolveDownloadFileName('bitk-linux-x64', '0.0.3', false)
    // Should match VALID_FILE_NAME_RE
    expect(VALID_FILE_NAME_RE.test(result)).toBe(true)
    expect(result).toContain('v0.0.3')
  })

  it('constructs versioned filename for unversioned package assets', () => {
    const result = resolveDownloadFileName('bitk-app.tar.gz', '0.0.3', true)
    expect(result).toBe('bitk-app-v0.0.3.tar.gz')
    expect(VALID_FILE_NAME_RE.test(result)).toBe(true)
  })

  it('constructs filenames that pass VALID_FILE_NAME_RE', () => {
    // Simulate the exact scenario from the bug: GitHub asset lacks version suffix
    const binary = resolveDownloadFileName('bitk-darwin-arm64', '0.0.3', false)
    expect(VALID_FILE_NAME_RE.test(binary)).toBe(true)

    const pkg = resolveDownloadFileName('bitk-app.tar.gz', '1.2.3', true)
    expect(VALID_FILE_NAME_RE.test(pkg)).toBe(true)
  })
})

describe('detectPlatformAssetSuffix', () => {
  it('returns a non-empty string in the format os-arch', () => {
    const suffix = detectPlatformAssetSuffix()
    expect(suffix).toMatch(/^[\w]+-[\w]+$/)
  })
})
