import { beforeEach, describe, expect, test } from 'bun:test'
import type { NormalizedLogEntry } from '@bkd/shared'
import { rebuildMessages } from '@/engines/issue/store/message-rebuilder'
import type { WriteFilterRule } from '@/engines/write-filter'

const DEFAULT_RULES: WriteFilterRule[] = [
  { id: 'read', type: 'tool-name', match: 'Read', enabled: true },
  { id: 'glob', type: 'tool-name', match: 'Glob', enabled: true },
  { id: 'grep', type: 'tool-name', match: 'Grep', enabled: true },
]

const opts = { devMode: false, filterRules: DEFAULT_RULES }
const devOpts = { devMode: true, filterRules: DEFAULT_RULES }

function entry(overrides: Partial<NormalizedLogEntry> = {}): NormalizedLogEntry {
  return {
    entryType: 'assistant-message',
    content: '',
    turnIndex: 0,
    ...overrides,
  }
}

function toolCall(toolCallId: string, toolName: string, kind: string): NormalizedLogEntry {
  return entry({
    entryType: 'tool-use',
    content: `calling ${toolName}`,
    toolDetail: { kind, toolName, toolCallId, isResult: false },
    metadata: { toolName, toolCallId },
  })
}

function toolResult(toolCallId: string, toolName: string, kind: string): NormalizedLogEntry {
  return entry({
    entryType: 'tool-use',
    content: `result of ${toolName}`,
    toolDetail: { kind, toolName, toolCallId, isResult: true },
    metadata: { toolName, toolCallId, isResult: true },
  })
}

describe('rebuildMessages', () => {
  test('maps user and assistant messages', () => {
    const entries = [
      entry({ entryType: 'user-message', content: 'hello' }),
      entry({ entryType: 'assistant-message', content: 'hi' }),
    ]
    const msgs = rebuildMessages(entries, opts)
    expect(msgs).toHaveLength(2)
    expect(msgs[0].type).toBe('user')
    expect(msgs[1].type).toBe('assistant')
  })

  test('groups consecutive tool calls', () => {
    const entries = [
      entry({ entryType: 'assistant-message', content: 'let me check' }),
      toolCall('tc-1', 'Edit', 'file-edit'),
      toolResult('tc-1', 'Edit', 'file-edit'),
      toolCall('tc-2', 'Bash', 'command-run'),
      toolResult('tc-2', 'Bash', 'command-run'),
      entry({ entryType: 'assistant-message', content: 'done' }),
    ]
    const msgs = rebuildMessages(entries, opts)
    expect(msgs).toHaveLength(3)
    expect(msgs[0].type).toBe('assistant')
    expect(msgs[1].type).toBe('tool-group')
    expect(msgs[2].type).toBe('assistant')

    const tg = msgs[1]
    if (tg.type !== 'tool-group') throw new Error('expected tool-group')
    expect(tg.items).toHaveLength(2)
    expect(tg.count).toBe(2)
    expect(tg.stats['file-edit']).toBe(1)
    expect(tg.stats['command-run']).toBe(1)
    // Verify pairing
    expect(tg.items[0].result).not.toBeNull()
    expect(tg.items[1].result).not.toBeNull()
  })

  test('filters Read/Glob/Grep in normal mode, shows in devMode', () => {
    const entries = [
      toolCall('tc-1', 'Read', 'file-read'),
      toolResult('tc-1', 'Read', 'file-read'),
      toolCall('tc-2', 'Edit', 'file-edit'),
      toolResult('tc-2', 'Edit', 'file-edit'),
      toolCall('tc-3', 'Glob', 'search'),
      toolResult('tc-3', 'Glob', 'search'),
    ]

    // Normal mode: Read and Glob are hidden
    const msgs = rebuildMessages(entries, opts)
    expect(msgs).toHaveLength(1)
    const tg = msgs[0]
    if (tg.type !== 'tool-group') throw new Error('expected tool-group')
    expect(tg.items).toHaveLength(1) // Only Edit visible
    expect(tg.hiddenCount).toBe(2) // Read + Glob hidden
    expect(tg.count).toBe(3) // Total is still 3

    // Dev mode: all visible
    const devMsgs = rebuildMessages(entries, devOpts)
    const devTg = devMsgs[0]
    if (devTg.type !== 'tool-group') throw new Error('expected tool-group')
    expect(devTg.items).toHaveLength(3)
    expect(devTg.hiddenCount).toBe(0)
  })

  test('extracts TodoWrite as task-plan message', () => {
    const entries = [
      entry({
        entryType: 'tool-use',
        content: 'writing todos',
        toolDetail: {
          kind: 'tool',
          toolName: 'TodoWrite',
          toolCallId: 'tc-todo',
          isResult: false,
        },
        metadata: {
          toolName: 'TodoWrite',
          toolCallId: 'tc-todo',
          arguments: {
            todos: [
              { content: 'Task 1', status: 'completed' },
              { content: 'Task 2', status: 'pending' },
            ],
          },
        },
      }),
      entry({
        entryType: 'tool-use',
        content: 'result',
        toolDetail: {
          kind: 'tool',
          toolName: 'TodoWrite',
          toolCallId: 'tc-todo',
          isResult: true,
        },
        metadata: {
          toolName: 'TodoWrite',
          toolCallId: 'tc-todo',
          isResult: true,
        },
      }),
    ]

    const msgs = rebuildMessages(entries, opts)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].type).toBe('task-plan')
    if (msgs[0].type !== 'task-plan') throw new Error('expected task-plan')
    expect(msgs[0].todos).toHaveLength(2)
    expect(msgs[0].completedCount).toBe(1)
  })

  test('handles mixed TodoWrite + regular tools in same group', () => {
    const entries = [
      toolCall('tc-1', 'Edit', 'file-edit'),
      toolResult('tc-1', 'Edit', 'file-edit'),
      entry({
        entryType: 'tool-use',
        content: 'writing todos',
        toolDetail: {
          kind: 'tool',
          toolName: 'TodoWrite',
          toolCallId: 'tc-todo',
          isResult: false,
        },
        metadata: {
          toolName: 'TodoWrite',
          toolCallId: 'tc-todo',
          arguments: { todos: [{ content: 'Task', status: 'pending' }] },
        },
      }),
      toolCall('tc-2', 'Bash', 'command-run'),
      toolResult('tc-2', 'Bash', 'command-run'),
    ]

    const msgs = rebuildMessages(entries, opts)
    // Should have task-plan + tool-group (Edit + Bash)
    const types = msgs.map((m) => m.type)
    expect(types).toContain('task-plan')
    expect(types).toContain('tool-group')
  })

  test('handles unpaired tool calls (no result)', () => {
    const entries = [
      toolCall('tc-1', 'Read', 'file-read'),
      // No result for tc-1
      entry({ entryType: 'assistant-message', content: 'done' }),
    ]
    const msgs = rebuildMessages(entries, devOpts) // devMode to see Read
    expect(msgs).toHaveLength(2)
    const tg = msgs[0]
    if (tg.type !== 'tool-group') throw new Error('expected tool-group')
    expect(tg.items[0].result).toBeNull()
  })

  test('maps thinking, system, and error entries', () => {
    const entries = [
      entry({ entryType: 'thinking', content: 'hmm' }),
      entry({
        entryType: 'system-message',
        content: 'info',
        metadata: { subtype: 'warning' },
      }),
      entry({ entryType: 'error-message', content: 'oops' }),
    ]
    const msgs = rebuildMessages(entries, opts)
    expect(msgs).toHaveLength(3)
    expect(msgs[0].type).toBe('thinking')
    expect(msgs[1].type).toBe('system')
    if (msgs[1].type === 'system') {
      expect(msgs[1].subtype).toBe('warning')
    }
    expect(msgs[2].type).toBe('error')
  })

  test('skips token-usage and loading entries', () => {
    const entries = [
      entry({ entryType: 'token-usage', content: '{}' }),
      entry({ entryType: 'loading', content: '' }),
      entry({ entryType: 'assistant-message', content: 'hello' }),
    ]
    const msgs = rebuildMessages(entries, opts)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].type).toBe('assistant')
  })

  test('empty entries returns empty messages', () => {
    expect(rebuildMessages([], opts)).toEqual([])
  })

  test('all-filtered tool group is still emitted (with 0 visible items)', () => {
    const entries = [
      toolCall('tc-1', 'Read', 'file-read'),
      toolResult('tc-1', 'Read', 'file-read'),
      toolCall('tc-2', 'Glob', 'search'),
      toolResult('tc-2', 'Glob', 'search'),
      entry({ entryType: 'assistant-message', content: 'done' }),
    ]
    const msgs = rebuildMessages(entries, opts)
    // The tool group with all filtered items should still have hiddenCount
    // but since all non-todo items are filtered and there are 0 visible items,
    // the group is still emitted with empty items array
    expect(msgs).toHaveLength(2) // tool-group (empty visible) + assistant
    const tg = msgs[0]
    if (tg.type !== 'tool-group') throw new Error('expected tool-group')
    expect(tg.items).toHaveLength(0)
    expect(tg.hiddenCount).toBe(2)
    expect(tg.count).toBe(2)
  })

  test('detects result via metadata.isResult fallback (no toolDetail)', () => {
    const entries = [
      // Action with toolDetail
      toolCall('tc-1', 'Edit', 'file-edit'),
      // Result with isResult only in metadata (no toolDetail)
      entry({
        entryType: 'tool-use',
        content: 'edit result',
        metadata: { toolName: 'Edit', toolCallId: 'tc-1', isResult: true },
      }),
      entry({ entryType: 'assistant-message', content: 'done' }),
    ]
    const msgs = rebuildMessages(entries, opts)
    expect(msgs).toHaveLength(2) // tool-group + assistant
    const tg = msgs[0]
    if (tg.type !== 'tool-group') throw new Error('expected tool-group')
    expect(tg.items).toHaveLength(1)
    // The result should be paired
    expect(tg.items[0].result).not.toBeNull()
    expect(tg.items[0].result?.content).toBe('edit result')
  })
})
