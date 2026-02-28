export interface CommandPreview {
  summary: string
  isTruncated: boolean
}

export function getCommandPreview(
  command: string,
  maxChars = 90,
): CommandPreview {
  const compact = command.replace(/\s+/g, ' ').trim()
  if (!compact) {
    return { summary: '', isTruncated: false }
  }
  const isTruncated = compact.length > maxChars
  const clipped = isTruncated ? compact.slice(0, maxChars).trimEnd() : compact

  return {
    summary: isTruncated ? `${clipped} .....` : clipped,
    isTruncated,
  }
}
