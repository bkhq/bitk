import { describe, expect, test } from 'bun:test'
import type { NormalizedLogEntry } from '@bkd/shared'
import { ExecutionStore } from '@/engines/issue/store/execution-store'

function makeEntry(
  overrides: Partial<NormalizedLogEntry> = {},
): NormalizedLogEntry {
  return {
    entryType: 'assistant-message',
    content: 'hello',
    turnIndex: 0,
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

function makeToolEntry(
  toolCallId: string,
  isResult: boolean,
  overrides: Partial<NormalizedLogEntry> = {},
): NormalizedLogEntry {
  return makeEntry({
    entryType: 'tool-use',
    content: isResult ? 'result content' : 'tool call',
    toolDetail: {
      kind: 'file-read',
      toolName: 'Read',
      toolCallId,
      isResult,
    },
    ...overrides,
  })
}

describe('ExecutionStore', () => {
  test('append and retrieve entries by turn', () => {
    const store = new ExecutionStore('exec-1')
    store.append(makeEntry({ turnIndex: 0, content: 'turn 0' }))
    store.append(makeEntry({ turnIndex: 1, content: 'turn 1' }))
    store.append(makeEntry({ turnIndex: 0, content: 'turn 0 again' }))

    const turn0 = store.getByTurn(0)
    expect(turn0).toHaveLength(2)
    expect(turn0[0].content).toBe('turn 0')
    expect(turn0[1].content).toBe('turn 0 again')

    const turn1 = store.getByTurn(1)
    expect(turn1).toHaveLength(1)
    expect(turn1[0].content).toBe('turn 1')

    store.destroy()
  })

  test('getAllEntries returns insertion order', () => {
    const store = new ExecutionStore('exec-2')
    store.append(makeEntry({ content: 'first' }))
    store.append(makeEntry({ content: 'second' }))
    store.append(makeEntry({ content: 'third' }))

    const all = store.getAllEntries()
    expect(all).toHaveLength(3)
    expect(all.map((e) => e.content)).toEqual(['first', 'second', 'third'])

    store.destroy()
  })

  test('getToolPairs pairs action with result', () => {
    const store = new ExecutionStore('exec-3')
    store.append(makeToolEntry('tc-1', false, { turnIndex: 0 }))
    store.append(makeToolEntry('tc-1', true, { turnIndex: 0 }))
    store.append(makeToolEntry('tc-2', false, { turnIndex: 0 }))
    // tc-2 has no result

    const pairs = store.getToolPairs(0)
    expect(pairs).toHaveLength(2)
    expect(pairs[0].action.toolDetail?.toolCallId).toBe('tc-1')
    expect(pairs[0].result).not.toBeNull()
    expect(pairs[0].result?.toolDetail?.isResult).toBe(true)
    expect(pairs[1].action.toolDetail?.toolCallId).toBe('tc-2')
    expect(pairs[1].result).toBeNull()

    store.destroy()
  })

  test('getResult returns matching result entry', () => {
    const store = new ExecutionStore('exec-4')
    store.append(makeToolEntry('tc-1', false))
    store.append(makeToolEntry('tc-1', true))

    const result = store.getResult('tc-1')
    expect(result).not.toBeNull()
    expect(result?.content).toBe('result content')

    expect(store.getResult('nonexistent')).toBeNull()
    store.destroy()
  })

  test('getToolStats counts by kind', () => {
    const store = new ExecutionStore('exec-5')
    store.append(
      makeToolEntry('tc-1', false, {
        toolDetail: {
          kind: 'file-read',
          toolName: 'Read',
          toolCallId: 'tc-1',
          isResult: false,
        },
      }),
    )
    store.append(
      makeToolEntry('tc-2', false, {
        toolDetail: {
          kind: 'file-read',
          toolName: 'Read',
          toolCallId: 'tc-2',
          isResult: false,
        },
      }),
    )
    store.append(
      makeToolEntry('tc-3', false, {
        toolDetail: {
          kind: 'file-edit',
          toolName: 'Edit',
          toolCallId: 'tc-3',
          isResult: false,
        },
      }),
    )

    const stats = store.getToolStats(0)
    expect(stats['file-read']).toBe(2)
    expect(stats['file-edit']).toBe(1)

    store.destroy()
  })

  test('getEntryCount and totalEntries', () => {
    const store = new ExecutionStore('exec-6')
    store.append(makeEntry({ turnIndex: 0 }))
    store.append(makeEntry({ turnIndex: 0 }))
    store.append(makeEntry({ turnIndex: 1 }))

    expect(store.getEntryCount(0)).toBe(2)
    expect(store.getEntryCount(1)).toBe(1)
    expect(store.totalEntries).toBe(3)
    expect(store.length).toBe(3)

    store.destroy()
  })

  test('RingBuffer-compatible interface (push, toArray, length)', () => {
    const store = new ExecutionStore('exec-7')
    store.push(makeEntry({ content: 'a' }))
    store.push(makeEntry({ content: 'b' }))

    expect(store.length).toBe(2)
    const arr = store.toArray()
    expect(arr).toHaveLength(2)
    expect(arr[0].content).toBe('a')
    expect(arr[1].content).toBe('b')

    store.destroy()
  })

  test('metadata round-trips through JSON', () => {
    const store = new ExecutionStore('exec-8')
    store.append(
      makeEntry({
        metadata: { foo: 'bar', nested: { x: 1 } },
      }),
    )

    const entries = store.getByTurn(0)
    expect(entries[0].metadata).toEqual({ foo: 'bar', nested: { x: 1 } })

    store.destroy()
  })

  test('operations after destroy return empty', () => {
    const store = new ExecutionStore('exec-9')
    store.append(makeEntry({ content: 'before destroy' }))
    store.destroy()

    expect(store.isDestroyed).toBe(true)
    expect(store.getByTurn(0)).toEqual([])
    expect(store.getAllEntries()).toEqual([])
    expect(store.getToolPairs(0)).toEqual([])
    expect(store.getToolStats(0)).toEqual({})
    expect(store.getEntryCount(0)).toBe(0)
    expect(store.totalEntries).toBe(0)
    expect(store.length).toBe(0)
    expect(store.getResult('tc-1')).toBeNull()
    expect(store.hasEntry('id')).toBe(false)

    // append after destroy should be no-op
    store.append(makeEntry({ content: 'after destroy' }))
  })

  test('hasEntry checks messageId existence', () => {
    const store = new ExecutionStore('exec-10')
    store.append(makeEntry({ messageId: 'msg-1' }))
    store.append(makeEntry({ messageId: 'msg-2' }))

    expect(store.hasEntry('msg-1')).toBe(true)
    expect(store.hasEntry('msg-2')).toBe(true)
    expect(store.hasEntry('msg-3')).toBe(false)

    store.destroy()
  })

  test('toolAction round-trips through store', () => {
    const store = new ExecutionStore('exec-11')
    store.append(
      makeEntry({
        entryType: 'tool-use',
        content: 'reading file',
        toolAction: { kind: 'file-read', path: 'src/index.ts' },
        toolDetail: {
          kind: 'file-read',
          toolName: 'Read',
          toolCallId: 'tc-rt',
          isResult: false,
        },
      }),
    )

    const entries = store.getByTurn(0)
    expect(entries[0].toolAction).toEqual({
      kind: 'file-read',
      path: 'src/index.ts',
    })

    store.destroy()
  })
})
