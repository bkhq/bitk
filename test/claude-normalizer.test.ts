import { describe, expect, test } from 'bun:test'
import { ClaudeLogNormalizer } from '../app/engines/executors/claude'
import type { WriteFilterRule } from '../app/engines/write-filter'
import type { NormalizedLogEntry } from '../app/engines/types'

const READ_RULE: WriteFilterRule = { id: 'read', type: 'tool-name', match: 'Read', enabled: true }
const GLOB_RULE: WriteFilterRule = { id: 'glob', type: 'tool-name', match: 'Glob', enabled: true }
const GREP_RULE: WriteFilterRule = { id: 'grep', type: 'tool-name', match: 'Grep', enabled: true }
const ALL_RULES: WriteFilterRule[] = [READ_RULE, GLOB_RULE, GREP_RULE]

function line(obj: Record<string, unknown>): string {
  return JSON.stringify(obj)
}

// Helper to flatten parse result into array
function parseAll(normalizer: ClaudeLogNormalizer, rawLine: string): NormalizedLogEntry[] {
  const result = normalizer.parse(rawLine)
  if (!result) return []
  return Array.isArray(result) ? result : [result]
}

describe('ClaudeLogNormalizer', () => {
  describe('no rules — output matches original normalizeLog', () => {
    const normalizer = new ClaudeLogNormalizer()

    test('assistant text message', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'assistant',
          timestamp: '2025-01-01T00:00:00Z',
          message: { id: 'msg1', content: [{ type: 'text', text: 'Hello world' }] },
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0].entryType).toBe('assistant-message')
      expect(entries[0].content).toBe('Hello world')
    })

    test('assistant with tool_use', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'assistant',
          timestamp: '2025-01-01T00:00:00Z',
          message: {
            id: 'msg2',
            content: [
              { type: 'text', text: 'Let me read' },
              { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/foo' } },
            ],
          },
        }),
      )
      expect(entries).toHaveLength(2)
      expect(entries[0].entryType).toBe('assistant-message')
      expect(entries[1].entryType).toBe('tool-use')
      expect(entries[1].content).toBe('Tool: Read')
    })

    test('standalone tool_use', () => {
      const entries = parseAll(
        normalizer,
        line({ type: 'tool_use', name: 'Bash', id: 'tu_2', input: { command: 'ls' } }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0].entryType).toBe('tool-use')
      expect(entries[0].toolAction?.kind).toBe('command-run')
    })

    test('tool_result', () => {
      const entries = parseAll(
        normalizer,
        line({ type: 'tool_result', tool_use_id: 'tu_2', content: 'file.txt' }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0].entryType).toBe('tool-use')
      expect(entries[0].metadata?.isResult).toBe(true)
    })

    test('error message', () => {
      const entries = parseAll(
        normalizer,
        line({ type: 'error', error: { type: 'api_error', message: 'Rate limit' } }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0].entryType).toBe('error-message')
      expect(entries[0].content).toBe('Rate limit')
    })

    test('system init', () => {
      const entries = parseAll(
        normalizer,
        line({ type: 'system', subtype: 'init', session_id: 's1', cwd: '/home' }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0].entryType).toBe('system-message')
      expect(entries[0].content).toContain('/home')
    })

    test('result with metrics', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'result',
          subtype: 'success',
          duration_ms: 5000,
          input_tokens: 100,
          output_tokens: 50,
          cost_usd: 0.01,
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0].entryType).toBe('system-message')
      expect(entries[0].content).toContain('5.0s')
      expect(entries[0].metadata?.turnCompleted).toBe(true)
    })

    test('thinking-only blocks return null', () => {
      const result = normalizer.parse(
        line({
          type: 'assistant',
          message: { content: [{ type: 'thinking', thinking: 'hmm' }] },
        }),
      )
      expect(result).toBeNull()
    })
  })

  describe('filter Read — standalone tool_use returns null', () => {
    const normalizer = new ClaudeLogNormalizer([READ_RULE])

    test('standalone Read tool_use is filtered', () => {
      const result = normalizer.parse(
        line({ type: 'tool_use', name: 'Read', id: 'tu_read1', input: { file_path: '/bar' } }),
      )
      expect(result).toBeNull()
    })

    test('standalone Bash tool_use is NOT filtered', () => {
      const entries = parseAll(
        normalizer,
        line({ type: 'tool_use', name: 'Bash', id: 'tu_bash1', input: { command: 'echo hi' } }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0].content).toBe('Tool: Bash')
    })
  })

  describe('filter Read — assistant mixed message preserves text, strips tool_use', () => {
    const normalizer = new ClaudeLogNormalizer([READ_RULE])

    test('text preserved, Read tool_use removed', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'assistant',
          message: {
            id: 'msg3',
            content: [
              { type: 'text', text: 'Let me check' },
              { type: 'tool_use', id: 'tu_r1', name: 'Read', input: { file_path: '/x' } },
            ],
          },
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0].entryType).toBe('assistant-message')
      expect(entries[0].content).toBe('Let me check')
    })

    test('all tool_use filtered + no text → null', () => {
      const result = normalizer.parse(
        line({
          type: 'assistant',
          message: {
            id: 'msg4',
            content: [{ type: 'tool_use', id: 'tu_r2', name: 'Read', input: { file_path: '/y' } }],
          },
        }),
      )
      expect(result).toBeNull()
    })

    test('mixed: one filtered, one kept', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'assistant',
          message: {
            id: 'msg5',
            content: [
              { type: 'tool_use', id: 'tu_r3', name: 'Read', input: { file_path: '/a' } },
              { type: 'tool_use', id: 'tu_e1', name: 'Edit', input: { file_path: '/b' } },
            ],
          },
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0].entryType).toBe('tool-use')
      expect(entries[0].content).toBe('Tool: Edit')
    })
  })

  describe('tool_result correlation filtering', () => {
    test('tool_result for filtered Read returns null', () => {
      const normalizer = new ClaudeLogNormalizer([READ_RULE])

      // First, filter the tool_use
      normalizer.parse(
        line({ type: 'tool_use', name: 'Read', id: 'tu_corr1', input: { file_path: '/z' } }),
      )

      // Now the tool_result should also be filtered
      const result = normalizer.parse(
        line({ type: 'tool_result', tool_use_id: 'tu_corr1', content: 'file contents' }),
      )
      expect(result).toBeNull()
    })

    test('tool_result for non-filtered tool passes through', () => {
      const normalizer = new ClaudeLogNormalizer([READ_RULE])

      // Bash is not filtered
      normalizer.parse(
        line({ type: 'tool_use', name: 'Bash', id: 'tu_corr2', input: { command: 'ls' } }),
      )

      const entries = parseAll(
        normalizer,
        line({ type: 'tool_result', tool_use_id: 'tu_corr2', content: 'output' }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0].content).toBe('output')
    })

    test('user message with tool_result blocks — filtered ones removed', () => {
      const normalizer = new ClaudeLogNormalizer([READ_RULE])

      // Filter a Read tool_use (in assistant message)
      normalizer.parse(
        line({
          type: 'assistant',
          message: {
            id: 'msg6',
            content: [
              { type: 'tool_use', id: 'tu_uc1', name: 'Read', input: { file_path: '/f' } },
              { type: 'tool_use', id: 'tu_uc2', name: 'Edit', input: { file_path: '/g' } },
            ],
          },
        }),
      )

      // User message with two tool_results
      const entries = parseAll(
        normalizer,
        line({
          type: 'user',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'tu_uc1', content: 'read result' },
              { type: 'tool_result', tool_use_id: 'tu_uc2', content: 'edit result' },
            ],
          },
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0].content).toBe('edit result')
    })

    test('user message with all tool_results filtered → null', () => {
      const normalizer = new ClaudeLogNormalizer(ALL_RULES)

      // Filter Read and Glob
      normalizer.parse(
        line({
          type: 'assistant',
          message: {
            id: 'msg7',
            content: [
              { type: 'tool_use', id: 'tu_all1', name: 'Read', input: {} },
              { type: 'tool_use', id: 'tu_all2', name: 'Glob', input: {} },
            ],
          },
        }),
      )

      const result = normalizer.parse(
        line({
          type: 'user',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'tu_all1', content: 'a' },
              { type: 'tool_result', tool_use_id: 'tu_all2', content: 'b' },
            ],
          },
        }),
      )
      expect(result).toBeNull()
    })
  })

  describe('non-matching tools pass through', () => {
    const normalizer = new ClaudeLogNormalizer(ALL_RULES)

    test('Edit passes through', () => {
      const entries = parseAll(
        normalizer,
        line({ type: 'tool_use', name: 'Edit', id: 'tu_edit', input: { file_path: '/x' } }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0].content).toBe('Tool: Edit')
    })

    test('Bash passes through', () => {
      const entries = parseAll(
        normalizer,
        line({ type: 'tool_use', name: 'Bash', id: 'tu_bash', input: { command: 'echo' } }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0].content).toBe('Tool: Bash')
    })

    test('Write passes through', () => {
      const entries = parseAll(
        normalizer,
        line({ type: 'tool_use', name: 'Write', id: 'tu_write', input: { file_path: '/w' } }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0].content).toBe('Tool: Write')
    })
  })

  describe('JSON parse failure returns system-message', () => {
    const normalizer = new ClaudeLogNormalizer()

    test('invalid JSON returns system-message with raw content', () => {
      const entries = parseAll(normalizer, 'this is not json')
      expect(entries).toHaveLength(1)
      expect(entries[0].entryType).toBe('system-message')
      expect(entries[0].content).toBe('this is not json')
    })

    test('empty/whitespace returns null', () => {
      expect(normalizer.parse('')).toBeNull()
      expect(normalizer.parse('   ')).toBeNull()
    })
  })

  describe('disabled rules do not filter', () => {
    const disabledRule: WriteFilterRule = {
      id: 'read',
      type: 'tool-name',
      match: 'Read',
      enabled: false,
    }
    const normalizer = new ClaudeLogNormalizer([disabledRule])

    test('Read is NOT filtered when rule is disabled', () => {
      const entries = parseAll(
        normalizer,
        line({ type: 'tool_use', name: 'Read', id: 'tu_dis1', input: { file_path: '/d' } }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0].content).toBe('Tool: Read')
    })
  })

  describe('content_block_delta', () => {
    const normalizer = new ClaudeLogNormalizer()

    test('text_delta produces assistant-message', () => {
      const entries = parseAll(
        normalizer,
        line({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0].entryType).toBe('assistant-message')
      expect(entries[0].content).toBe('Hi')
    })

    test('thinking_delta returns null', () => {
      const result = normalizer.parse(
        line({ type: 'content_block_delta', delta: { type: 'thinking_delta' } }),
      )
      expect(result).toBeNull()
    })
  })

  describe('user slash command output', () => {
    const normalizer = new ClaudeLogNormalizer()

    test('extracts content from local-command-stdout wrapper', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'user',
          message: {
            content: '<local-command-stdout>cost info</local-command-stdout>',
          },
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0].entryType).toBe('system-message')
      expect(entries[0].content).toBe('cost info')
    })
  })

  describe('filteredToolCallIds cleanup', () => {
    test('id is removed from set after matching tool_result', () => {
      const normalizer = new ClaudeLogNormalizer([READ_RULE])

      // Filter the tool_use
      normalizer.parse(line({ type: 'tool_use', name: 'Read', id: 'tu_clean1', input: {} }))

      // First result is filtered and cleans up the id
      normalizer.parse(line({ type: 'tool_result', tool_use_id: 'tu_clean1', content: 'data' }))

      // Second result with same id should NOT be filtered (id was cleaned up)
      const entries = parseAll(
        normalizer,
        line({ type: 'tool_result', tool_use_id: 'tu_clean1', content: 'duplicate' }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0].content).toBe('duplicate')
    })
  })
})
