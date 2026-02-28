export function toISO(v: Date | number | string): string {
  if (v instanceof Date) return v.toISOString()
  return new Date(typeof v === 'string' ? v : v * 1000).toISOString()
}
