import { describe, expect, test } from 'bun:test'
import { ClaudeLogNormalizer } from '@/engines/executors/claude'
import type { NormalizedLogEntry } from '@/engines/types'

function line(obj: Record<string, unknown>): string {
  return JSON.stringify(obj)
}

// Helper to flatten parse result into array
function parseAll(
  normalizer: ClaudeLogNormalizer,
  rawLine: string,
): NormalizedLogEntry[] {
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
          message: {
            id: 'msg1',
            content: [{ type: 'text', text: 'Hello world' }],
          },
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.entryType).toBe('assistant-message')
      expect(entries[0]!.content).toBe('Hello world')
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
              {
                type: 'tool_use',
                id: 'tu_1',
                name: 'Read',
                input: { file_path: '/foo' },
              },
            ],
          },
        }),
      )
      expect(entries).toHaveLength(2)
      expect(entries[0]!.entryType).toBe('assistant-message')
      expect(entries[1]!.entryType).toBe('tool-use')
      // Content now shows the path instead of generic "Tool: Read"
      expect(entries[1]!.content).toBe('/foo')
      expect(entries[1]!.toolDetail?.toolName).toBe('Read')
      expect(entries[1]!.toolDetail?.kind).toBe('file-read')
      expect(entries[1]!.toolDetail?.isResult).toBe(false)
    })

    test('standalone tool_use', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'tool_use',
          name: 'Bash',
          id: 'tu_2',
          input: { command: 'ls' },
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.entryType).toBe('tool-use')
      expect(entries[0]!.toolAction?.kind).toBe('command-run')
      expect(entries[0]!.content).toBe('ls')
    })

    test('tool_result', () => {
      const entries = parseAll(
        normalizer,
        line({ type: 'tool_result', tool_use_id: 'tu_2', content: 'file.txt' }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.entryType).toBe('tool-use')
      expect(entries[0]!.metadata?.isResult).toBe(true)
    })

    test('tool_result correlates with tool_use via toolMap', () => {
      const n = new ClaudeLogNormalizer()
      // First emit tool_use
      n.parse(
        line({
          type: 'tool_use',
          name: 'Bash',
          id: 'tu_corr',
          input: { command: 'echo hi' },
        }),
      )
      // Then emit tool_result
      const entries = parseAll(
        n,
        line({
          type: 'tool_result',
          tool_use_id: 'tu_corr',
          content: 'hi',
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.metadata?.toolName).toBe('Bash')
      expect(entries[0]!.toolDetail?.toolName).toBe('Bash')
      expect(entries[0]!.toolDetail?.isResult).toBe(true)
    })

    test('error message', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'error',
          error: { type: 'api_error', message: 'Rate limit' },
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.entryType).toBe('error-message')
      expect(entries[0]!.content).toBe('Rate limit')
    })

    test('system init', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'system',
          subtype: 'init',
          session_id: 's1',
          cwd: '/home',
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.entryType).toBe('system-message')
      expect(entries[0]!.content).toContain('/home')
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
      expect(entries[0]!.entryType).toBe('system-message')
      expect(entries[0]!.content).toContain('5.0s')
      expect(entries[0]!.metadata?.turnCompleted).toBe(true)
    })

    test('thinking blocks produce thinking entries', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'assistant',
          message: { content: [{ type: 'thinking', thinking: 'hmm' }] },
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.entryType).toBe('thinking')
      expect(entries[0]!.content).toBe('hmm')
    })

    test('result with deduplicated assistant text', () => {
      const n = new ClaudeLogNormalizer()
      // First emit an assistant message
      n.parse(
        line({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Done!' }] },
        }),
      )
      // Then result with same text — should NOT produce assistant-message
      const entries = parseAll(
        n,
        line({
          type: 'result',
          subtype: 'success',
          result: 'Done!',
        }),
      )
      // Only the result system-message entry
      expect(entries).toHaveLength(1)
      expect(entries[0]!.entryType).toBe('system-message')
    })

    test('result with new assistant text', () => {
      const n = new ClaudeLogNormalizer()
      // Result with text that was NOT emitted as assistant message
      const entries = parseAll(
        n,
        line({
          type: 'result',
          subtype: 'success',
          result: 'Final answer',
          duration_ms: 1000,
        }),
      )
      expect(entries).toHaveLength(2)
      expect(entries[0]!.entryType).toBe('system-message')
      expect(entries[1]!.entryType).toBe('assistant-message')
      expect(entries[1]!.content).toBe('Final answer')
    })
  })

  describe('streaming events', () => {
    const normalizer = new ClaudeLogNormalizer()

    test('content_block_delta text is ignored (complete assistant message used instead)', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hi' },
        }),
      )
      expect(entries).toHaveLength(0)
    })

    test('content_block_delta thinking is ignored (complete assistant message used instead)', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'content_block_delta',
          delta: { type: 'thinking_delta', thinking: 'pondering...' },
        }),
      )
      expect(entries).toHaveLength(0)
    })

    test('message_start with model emits system init', () => {
      const n = new ClaudeLogNormalizer()
      const entries = parseAll(
        n,
        line({
          type: 'message_start',
          message: { model: 'claude-opus-4-6', role: 'assistant' },
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.entryType).toBe('system-message')
      expect(entries[0]!.content).toContain('claude-opus-4-6')
    })

    test('message_delta with usage emits token-usage', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'message_delta',
          usage: { input_tokens: 500, output_tokens: 200 },
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.entryType).toBe('token-usage')
      expect(entries[0]!.content).toContain('500')
    })

    test('message_delta from subagent is suppressed', () => {
      const result = normalizer.parse(
        line({
          type: 'message_delta',
          parent_tool_use_id: 'tu_sub1',
          usage: { input_tokens: 500, output_tokens: 200 },
        }),
      )
      expect(result).toBeNull()
    })
  })

  describe('rate limit events', () => {
    test('rate_limit event produces system-message', () => {
      const normalizer = new ClaudeLogNormalizer()
      const entries = parseAll(
        normalizer,
        line({ type: 'rate_limit', rate_limit_info: { retryAfter: 30 } }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.entryType).toBe('system-message')
      expect(entries[0]!.content).toBe('Rate limit reached')
    })
  })

  describe('replay and synthetic messages', () => {
    const normalizer = new ClaudeLogNormalizer()

    test('replay user messages are skipped', () => {
      const result = normalizer.parse(
        line({
          type: 'user',
          isReplay: true,
          message: { content: 'old message' },
        }),
      )
      expect(result).toBeNull()
    })

    test('synthetic user messages produce system-message', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'user',
          isSynthetic: true,
          message: {
            content: [{ type: 'text', text: 'injected by hook' }],
          },
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.entryType).toBe('system-message')
      expect(entries[0]!.content).toBe('injected by hook')
    })
  })

  describe('Read/Glob/Grep tool_use entries are preserved (no filtering)', () => {
    const normalizer = new ClaudeLogNormalizer()

    test('standalone Read tool_use is preserved', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'tool_use',
          name: 'Read',
          id: 'tu_read1',
          input: { file_path: '/bar' },
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.entryType).toBe('tool-use')
      expect(entries[0]!.toolDetail?.toolName).toBe('Read')
    })

    test('standalone Bash tool_use is preserved', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'tool_use',
          name: 'Bash',
          id: 'tu_bash1',
          input: { command: 'echo hi' },
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.content).toBe('echo hi')
    })
  })

  describe('assistant mixed message preserves all tool_use entries', () => {
    const normalizer = new ClaudeLogNormalizer()

    test('text + Read tool_use both preserved', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'assistant',
          message: {
            id: 'msg3',
            content: [
              { type: 'text', text: 'Let me check' },
              {
                type: 'tool_use',
                id: 'tu_r1',
                name: 'Read',
                input: { file_path: '/x' },
              },
            ],
          },
        }),
      )
      expect(entries).toHaveLength(2)
      expect(entries[0]!.entryType).toBe('assistant-message')
      expect(entries[0]!.content).toBe('Let me check')
      expect(entries[1]!.entryType).toBe('tool-use')
      expect(entries[1]!.toolDetail?.toolName).toBe('Read')
    })

    test('Read-only assistant message produces tool-use entry', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'assistant',
          message: {
            id: 'msg4',
            content: [
              {
                type: 'tool_use',
                id: 'tu_r2',
                name: 'Read',
                input: { file_path: '/y' },
              },
            ],
          },
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.entryType).toBe('tool-use')
      expect(entries[0]!.toolDetail?.toolName).toBe('Read')
    })

    test('mixed Read + Edit: both preserved', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'assistant',
          message: {
            id: 'msg5',
            content: [
              {
                type: 'tool_use',
                id: 'tu_r3',
                name: 'Read',
                input: { file_path: '/a' },
              },
              {
                type: 'tool_use',
                id: 'tu_e1',
                name: 'Edit',
                input: { file_path: '/b' },
              },
            ],
          },
        }),
      )
      expect(entries).toHaveLength(2)
      expect(entries[0]!.toolDetail?.toolName).toBe('Read')
      expect(entries[1]!.toolDetail?.toolName).toBe('Edit')
      expect(entries[1]!.content).toBe('/b')
    })
  })

  describe('tool_result correlation — all results preserved', () => {
    test('tool_result for Read is preserved', () => {
      const normalizer = new ClaudeLogNormalizer()

      // Parse the tool_use first (registers in toolMap)
      normalizer.parse(
        line({
          type: 'tool_use',
          name: 'Read',
          id: 'tu_corr1',
          input: { file_path: '/z' },
        }),
      )

      // tool_result is now also preserved
      const entries = parseAll(
        normalizer,
        line({
          type: 'tool_result',
          tool_use_id: 'tu_corr1',
          content: 'file contents',
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.content).toBe('file contents')
      expect(entries[0]!.metadata?.toolName).toBe('Read')
    })

    test('tool_result for Bash is preserved', () => {
      const normalizer = new ClaudeLogNormalizer()

      normalizer.parse(
        line({
          type: 'tool_use',
          name: 'Bash',
          id: 'tu_corr2',
          input: { command: 'ls' },
        }),
      )

      const entries = parseAll(
        normalizer,
        line({
          type: 'tool_result',
          tool_use_id: 'tu_corr2',
          content: 'output',
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.content).toBe('output')
    })

    test('user message with tool_result blocks — all preserved', () => {
      const normalizer = new ClaudeLogNormalizer()

      // Parse assistant message with Read + Edit tool_use
      normalizer.parse(
        line({
          type: 'assistant',
          message: {
            id: 'msg6',
            content: [
              {
                type: 'tool_use',
                id: 'tu_uc1',
                name: 'Read',
                input: { file_path: '/f' },
              },
              {
                type: 'tool_use',
                id: 'tu_uc2',
                name: 'Edit',
                input: { file_path: '/g' },
              },
            ],
          },
        }),
      )

      // User message with two tool_results — both preserved
      const entries = parseAll(
        normalizer,
        line({
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tu_uc1',
                content: 'read result',
              },
              {
                type: 'tool_result',
                tool_use_id: 'tu_uc2',
                content: 'edit result',
              },
            ],
          },
        }),
      )
      expect(entries).toHaveLength(2)
      expect(entries[0]!.content).toBe('read result')
      expect(entries[1]!.content).toBe('edit result')
    })

    test('user message with Read + Glob tool_results — all preserved', () => {
      const normalizer = new ClaudeLogNormalizer()

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

      const entries = parseAll(
        normalizer,
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
      expect(entries).toHaveLength(2)
      expect(entries[0]!.content).toBe('a')
      expect(entries[1]!.content).toBe('b')
    })
  })

  describe('tools pass through with concise content', () => {
    const normalizer = new ClaudeLogNormalizer()

    test('Edit shows file path', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'tool_use',
          name: 'Edit',
          id: 'tu_edit',
          input: { file_path: '/x' },
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.content).toBe('/x')
    })

    test('Bash shows command', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'tool_use',
          name: 'Bash',
          id: 'tu_bash',
          input: { command: 'echo' },
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.content).toBe('echo')
    })

    test('Write shows file path', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'tool_use',
          name: 'Write',
          id: 'tu_write',
          input: { file_path: '/w' },
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.content).toBe('/w')
    })
  })

  describe('concise content generation', () => {
    const normalizer = new ClaudeLogNormalizer()

    test('Grep shows pattern', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'tool_use',
          name: 'Grep',
          id: 'tu_grep',
          input: { pattern: 'TODO', path: 'src/' },
        }),
      )
      expect(entries[0]!.content).toBe('TODO in src/')
    })

    test('Glob shows pattern', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'tool_use',
          name: 'Glob',
          id: 'tu_glob',
          input: { pattern: '**/*.ts' },
        }),
      )
      expect(entries[0]!.content).toBe('**/*.ts')
    })

    test('WebFetch shows URL', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'tool_use',
          name: 'WebFetch',
          id: 'tu_wf',
          input: { url: 'https://example.com' },
        }),
      )
      expect(entries[0]!.content).toBe('https://example.com')
    })

    test('MCP tool shows formatted name', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'tool_use',
          name: 'mcp__server__tool_name',
          id: 'tu_mcp',
          input: {},
        }),
      )
      expect(entries[0]!.content).toBe('mcp:server:tool_name')
    })

    test('Task shows description', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'tool_use',
          name: 'Task',
          id: 'tu_task',
          input: { description: 'research something' },
        }),
      )
      expect(entries[0]!.content).toBe('Task: research something')
    })
  })

  describe('JSON parse failure returns system-message', () => {
    const normalizer = new ClaudeLogNormalizer()

    test('invalid JSON returns system-message with raw content', () => {
      const entries = parseAll(normalizer, 'this is not json')
      expect(entries).toHaveLength(1)
      expect(entries[0]!.entryType).toBe('system-message')
      expect(entries[0]!.content).toBe('this is not json')
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
        line({
          type: 'tool_use',
          name: 'Read',
          id: 'tu_dis1',
          input: { file_path: '/d' },
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.content).toBe('/d')
    })
  })

  describe('content_block_delta', () => {
    const normalizer = new ClaudeLogNormalizer()

    test('text_delta is ignored (complete assistant message used instead)', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hi' },
        }),
      )
      expect(entries).toHaveLength(0)
    })

    test('thinking_delta is ignored (complete assistant message used instead)', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'content_block_delta',
          delta: { type: 'thinking_delta', thinking: 'deep thought' },
        }),
      )
      expect(entries).toHaveLength(0)
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
      expect(entries[0]!.entryType).toBe('system-message')
      expect(entries[0]!.content).toBe('cost info')
    })
  })

  describe('toolMap cleanup after tool_result', () => {
    test('toolMap entry is removed after matching tool_result', () => {
      const normalizer = new ClaudeLogNormalizer()

      // Parse tool_use (registers in toolMap)
      normalizer.parse(
        line({ type: 'tool_use', name: 'Read', id: 'tu_clean1', input: {} }),
      )

      // First result consumes the toolMap entry
      const first = parseAll(
        normalizer,
        line({
          type: 'tool_result',
          tool_use_id: 'tu_clean1',
          content: 'data',
        }),
      )
      expect(first).toHaveLength(1)
      expect(first[0]!.metadata?.toolName).toBe('Read')

      // Second result with same id — no toolMap entry, so toolName is undefined
      const second = parseAll(
        normalizer,
        line({
          type: 'tool_result',
          tool_use_id: 'tu_clean1',
          content: 'duplicate',
        }),
      )
      expect(second).toHaveLength(1)
      expect(second[0]!.content).toBe('duplicate')
      expect(second[0]!.metadata?.toolName).toBeUndefined()
    })
  })

  describe('system subtypes', () => {
    const normalizer = new ClaudeLogNormalizer()

    test('compact_boundary', () => {
      const entries = parseAll(
        normalizer,
        line({ type: 'system', subtype: 'compact_boundary' }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.content).toBe('Context compacted')
    })

    test('task_started is suppressed', () => {
      const result = normalizer.parse(
        line({ type: 'system', subtype: 'task_started' }),
      )
      expect(result).toBeNull()
    })

    test('status with text', () => {
      const entries = parseAll(
        normalizer,
        line({ type: 'system', subtype: 'status', status: 'Working...' }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.content).toBe('Working...')
    })

    test('hook_response with output', () => {
      const entries = parseAll(
        normalizer,
        line({
          type: 'system',
          subtype: 'hook_response',
          output: 'hook result',
          hook_name: 'pre-commit',
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.content).toBe('hook result')
      expect(entries[0]!.metadata?.hookName).toBe('pre-commit')
    })
  })

  describe('result error handling', () => {
    test('error result with error details', () => {
      const normalizer = new ClaudeLogNormalizer()
      const entries = parseAll(
        normalizer,
        line({
          type: 'result',
          subtype: 'error',
          is_error: true,
          errors: ['Something went wrong'],
        }),
      )
      expect(entries).toHaveLength(1)
      expect(entries[0]!.entryType).toBe('error-message')
      expect(entries[0]!.content).toContain('Something went wrong')
      expect(entries[0]!.metadata?.isError).toBe(true)
    })
  })
})
