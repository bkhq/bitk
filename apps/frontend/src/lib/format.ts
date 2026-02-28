export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

/** Turn a raw model ID like "claude-opus-4-6" into a shorter display name */
export function formatModelName(id: string): string {
  const m = id.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)(\[.*\])?$/)
  if (m) {
    const suffix = m[4] || ''
    return `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}${suffix}`
  }
  return id
}

export function getProjectInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '??'
  const words = trimmed.split(/\s+/)
  if (words.length >= 2) {
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase()
  }
  return trimmed.slice(0, 2).toUpperCase()
}
