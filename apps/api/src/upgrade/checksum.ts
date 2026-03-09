import { VERSION } from '@/version'

/** Compute SHA-256 hash of a file */
export async function computeFileSha256(filePath: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256')
  const data = await Bun.file(filePath).arrayBuffer()
  hasher.update(new Uint8Array(data))
  return hasher.digest('hex')
}

/**
 * Fetch the expected checksum for an asset from a checksums file.
 * Parses checksums.txt format: each line is "<sha256>  <filename>".
 */
export async function fetchExpectedChecksum(
  checksumUrl: string,
  assetName: string,
): Promise<string | null> {
  try {
    const res = await fetch(checksumUrl, {
      headers: { 'User-Agent': `bkd/${VERSION}` },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    const text = await res.text()
    for (const line of text.trim().split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 2 && parts[1] === assetName) {
        const hash = parts[0].toLowerCase()
        return /^[a-f0-9]{64}$/.test(hash) ? hash : null
      }
    }
    return null
  } catch {
    return null
  }
}
