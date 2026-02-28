import { describe, expect, it } from 'vitest'
import {
  formatFileSize,
  formatModelName,
  getProjectInitials,
} from '../../lib/format'

describe('formatFileSize', () => {
  it('formats bytes below 1024', () => {
    expect(formatFileSize(500)).toBe('500B')
  })

  it('formats zero bytes', () => {
    expect(formatFileSize(0)).toBe('0B')
  })

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1.0KB')
  })

  it('formats kilobytes with decimals', () => {
    expect(formatFileSize(2560)).toBe('2.5KB')
  })

  it('formats megabytes', () => {
    expect(formatFileSize(1048576)).toBe('1.0MB')
  })

  it('formats megabytes with decimals', () => {
    expect(formatFileSize(5242880)).toBe('5.0MB')
  })
})

describe('formatModelName', () => {
  it('formats claude opus model', () => {
    expect(formatModelName('claude-opus-4-6')).toBe('Claude Opus 4.6')
  })

  it('formats claude sonnet model', () => {
    expect(formatModelName('claude-sonnet-4-5')).toBe('Claude Sonnet 4.5')
  })

  it('formats claude haiku model', () => {
    expect(formatModelName('claude-haiku-3-5')).toBe('Claude Haiku 3.5')
  })

  it('returns unknown model IDs unchanged', () => {
    expect(formatModelName('gpt-4o')).toBe('gpt-4o')
  })

  it('handles model with suffix', () => {
    expect(formatModelName('claude-opus-4-5[thinking]')).toBe(
      'Claude Opus 4.5[thinking]',
    )
  })
})

describe('getProjectInitials', () => {
  it('returns first 2 chars uppercase for single word', () => {
    expect(getProjectInitials('hello')).toBe('HE')
  })

  it('returns initials for multi-word name', () => {
    expect(getProjectInitials('My Project')).toBe('MP')
  })

  it('returns ?? for empty string', () => {
    expect(getProjectInitials('')).toBe('??')
  })

  it('returns ?? for whitespace-only string', () => {
    expect(getProjectInitials('   ')).toBe('??')
  })

  it('handles three-word name (uses first two)', () => {
    expect(getProjectInitials('A Big Project')).toBe('AB')
  })

  it('uppercases lowercase initials', () => {
    expect(getProjectInitials('my project')).toBe('MP')
  })
})
