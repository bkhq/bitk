import { describe, expect, test } from 'bun:test'
import { countTextLines, isPathInsideRoot } from '@/utils/changes'

describe('isPathInsideRoot', () => {
  test('allows simple relative paths', () => {
    expect(isPathInsideRoot('/repo', 'src/file.ts')).toBe(true)
  })

  test('allows nested paths', () => {
    expect(isPathInsideRoot('/repo', 'a/b/c/d.txt')).toBe(true)
  })

  test('rejects parent traversal', () => {
    expect(isPathInsideRoot('/repo', '../etc/passwd')).toBe(false)
  })

  test('rejects traversal via intermediate ..', () => {
    expect(isPathInsideRoot('/repo', 'src/../../etc/passwd')).toBe(false)
  })

  test('rejects absolute path outside root', () => {
    expect(isPathInsideRoot('/repo', '/etc/passwd')).toBe(false)
  })

  test('allows root itself', () => {
    expect(isPathInsideRoot('/repo', '.')).toBe(true)
  })

  test('handles root with trailing slash', () => {
    expect(isPathInsideRoot('/repo/', 'file.ts')).toBe(true)
    expect(isPathInsideRoot('/repo/', '../x')).toBe(false)
  })
})

describe('countTextLines', () => {
  test('counts simple lines', () => {
    expect(countTextLines('a\nb\nc')).toBe(3)
  })

  test('handles trailing newline', () => {
    expect(countTextLines('a\nb\nc\n')).toBe(3)
  })

  test('handles CRLF', () => {
    expect(countTextLines('a\r\nb\r\nc')).toBe(3)
  })

  test('returns 0 for empty string', () => {
    expect(countTextLines('')).toBe(0)
  })

  test('single line no newline', () => {
    expect(countTextLines('hello')).toBe(1)
  })

  test('single line with newline', () => {
    expect(countTextLines('hello\n')).toBe(1)
  })
})
