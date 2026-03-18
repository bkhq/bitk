import { describe, expect, test } from 'bun:test'
import { parseAcpModel, toScopedAcpModelId } from '@/engines/executors/acp/agents'
import { AcpLogNormalizer, normalizeAcpEvent } from '@/engines/executors/acp/acp-client'

describe('normalizeAcpEvent', () => {
  test('maps assistant chunks to streaming assistant messages', () => {
    const result = normalizeAcpEvent(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.000Z',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: 'hello from acp',
        },
      },
    }))

    expect(result).toBeTruthy()
    const entries = Array.isArray(result) ? result : [result]
    expect(entries[0]?.entryType).toBe('assistant-message')
    expect(entries[0]?.content).toBe('hello from acp')
    expect(entries[0]?.metadata?.streaming).toBe(true)
  })

  test('marks prompt result as a turn completion entry', () => {
    const result = normalizeAcpEvent(JSON.stringify({
      type: 'acp-prompt-result',
      timestamp: '2026-03-13T00:00:01.000Z',
      stopReason: 'end_turn',
      durationMs: 42,
    }))

    expect(result).toBeTruthy()
    const entries = Array.isArray(result) ? result : [result]
    expect(entries).toHaveLength(1)
    expect(entries[0]?.entryType).toBe('system-message')
    expect(entries[0]?.metadata?.turnCompleted).toBe(true)
    expect(entries[0]?.metadata?.resultSubtype).toBe('success')
  })

  test('marks prompt failures as logical failures', () => {
    const result = normalizeAcpEvent(JSON.stringify({
      type: 'acp-prompt-result',
      timestamp: '2026-03-13T00:00:01.000Z',
      stopReason: 'error',
      error: 'quota exhausted',
    }))

    expect(result).toBeTruthy()
    const entries = Array.isArray(result) ? result : [result]
    expect(entries[0]?.metadata?.turnCompleted).toBe(true)
    expect(entries[0]?.metadata?.resultSubtype).toBe('error')
    expect(entries[0]?.metadata?.isError).toBe(true)
  })
})

describe('AcpLogNormalizer', () => {
  test('flushes a final assistant message before turn completion', () => {
    const normalizer = new AcpLogNormalizer()

    const chunk = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.000Z',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: 'hello from acp',
        },
      },
    }))

    expect(chunk).toBeTruthy()
    expect(Array.isArray(chunk)).toBe(false)
    expect((chunk as { metadata?: Record<string, unknown> })?.metadata?.streaming).toBe(true)

    const result = normalizer.parse(JSON.stringify({
      type: 'acp-prompt-result',
      timestamp: '2026-03-13T00:00:01.000Z',
      stopReason: 'end_turn',
      durationMs: 42,
    }))

    expect(Array.isArray(result)).toBe(true)
    const entries = result as Array<{ entryType: string, content: string, metadata?: Record<string, unknown> }>
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      entryType: 'assistant-message',
      content: 'hello from acp',
    })
    expect(entries[0]?.metadata?.streaming).toBeUndefined()
    expect(entries[1]?.entryType).toBe('system-message')
    expect(entries[1]?.metadata?.turnCompleted).toBe(true)
  })

  test('pairs tool call actions with terminal results', () => {
    const normalizer = new AcpLogNormalizer()

    const action = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.000Z',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Read src/app.ts',
        kind: 'read',
        status: 'in_progress',
        rawInput: { path: 'src/app.ts' },
        locations: [{ path: 'src/app.ts', line: 12 }],
      },
    }))

    expect(Array.isArray(action)).toBe(false)
    expect(action).toMatchObject({
      entryType: 'tool-use',
      content: 'Read src/app.ts',
      metadata: {
        toolCallId: 'tool-1',
        toolName: 'Read src/app.ts',
        status: 'in_progress',
        kind: 'read',
      },
      toolDetail: {
        kind: 'file-read',
        toolCallId: 'tool-1',
        isResult: false,
      },
      toolAction: {
        kind: 'file-read',
        path: 'src/app.ts',
      },
    })

    const result = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:01.000Z',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        status: 'completed',
        rawOutput: { text: 'file contents' },
      },
    }))

    expect(Array.isArray(result)).toBe(false)
    expect(result).toMatchObject({
      entryType: 'tool-use',
      content: 'file contents',
      metadata: {
        toolCallId: 'tool-1',
        toolName: 'Read src/app.ts',
        status: 'completed',
        kind: 'read',
        isResult: true,
      },
      toolDetail: {
        kind: 'file-read',
        toolCallId: 'tool-1',
        isResult: true,
      },
    })
  })

  test('does not emit duplicate placeholder and specialized actions for the same tool call', () => {
    const normalizer = new AcpLogNormalizer()

    const placeholder = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.000Z',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-read-1',
        title: 'Read File',
      },
    }))

    expect(placeholder).toBeNull()

    const specialized = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.500Z',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-read-1',
        title: 'Read File',
        kind: 'read',
        locations: [{ path: '/app/test/acp/docs/task/API-001.md', line: 1 }],
      },
    }))

    expect(Array.isArray(specialized)).toBe(false)
    expect(specialized).toMatchObject({
      entryType: 'tool-use',
      toolDetail: {
        toolCallId: 'tool-read-1',
        kind: 'file-read',
        isResult: false,
      },
      toolAction: {
        kind: 'file-read',
        path: '/app/test/acp/docs/task/API-001.md',
      },
    })

    const result = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:01.000Z',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-read-1',
        status: 'completed',
        rawOutput: {
          formatted_output: '# API-001\\n\\n- **status**: completed',
        },
      },
    }))

    expect(Array.isArray(result)).toBe(false)
    expect(result).toMatchObject({
      entryType: 'tool-use',
      toolDetail: {
        toolCallId: 'tool-read-1',
        isResult: true,
      },
    })
  })

  test('prefers formatted tool output text over raw json output', () => {
    const normalizer = new AcpLogNormalizer()

    normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.000Z',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-3',
        title: 'List PMA skill files',
        kind: 'execute',
        status: 'in_progress',
        rawInput: { command: 'find /root/.agents/skills/pma -maxdepth 2 -type f | sort' },
      },
    }))

    const result = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:01.000Z',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-3',
        status: 'completed',
        rawOutput: {
          stdout: '/tmp/a\n/tmp/b\n',
          formatted_output: '/root/.agents/skills/pma/SKILL.md\n/root/.agents/skills/pma/docs/plan-format.md\n',
          aggregated_output: '/tmp/a\n/tmp/b\n',
          exit_code: 0,
        },
      },
    }))

    expect(Array.isArray(result)).toBe(false)
    expect(result).toMatchObject({
      entryType: 'tool-use',
      content: '/root/.agents/skills/pma/SKILL.md\n/root/.agents/skills/pma/docs/plan-format.md',
      metadata: {
        toolCallId: 'tool-3',
        toolName: 'List PMA skill files',
        status: 'completed',
        kind: 'execute',
        isResult: true,
      },
      toolDetail: {
        kind: 'command-run',
        toolCallId: 'tool-3',
        isResult: true,
      },
    })
  })

  test('flushes outstanding tool results at prompt completion', () => {
    const normalizer = new AcpLogNormalizer()

    normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.000Z',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-2',
        title: 'Search workspace',
        kind: 'search',
        rawInput: { query: 'acp-client' },
      },
    }))

    normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.500Z',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-2',
        status: 'in_progress',
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: 'found 3 matches',
            },
          },
        ],
      },
    }))

    const result = normalizer.parse(JSON.stringify({
      type: 'acp-prompt-result',
      timestamp: '2026-03-13T00:00:01.000Z',
      stopReason: 'end_turn',
      durationMs: 42,
    }))

    expect(Array.isArray(result)).toBe(true)
    const entries = result as Array<{ entryType: string, content: string, metadata?: Record<string, unknown> }>
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      entryType: 'tool-use',
      content: 'found 3 matches',
      metadata: {
        toolCallId: 'tool-2',
        toolName: 'Search workspace',
        isResult: true,
      },
    })
    expect(entries[1]?.entryType).toBe('system-message')
    expect(entries[1]?.metadata?.turnCompleted).toBe(true)
  })
})

describe('parseAcpModel', () => {
  test('parses scoped gemini model ids', () => {
    expect(parseAcpModel('acp:gemini:gemini-2.5-pro')).toEqual({
      agentId: 'gemini',
      modelId: 'gemini-2.5-pro',
      raw: 'acp:gemini:gemini-2.5-pro',
      scoped: true,
    })
  })

  test('parses scoped codex model ids', () => {
    expect(parseAcpModel('acp:codex:gpt-5.4')).toEqual({
      agentId: 'codex',
      modelId: 'gpt-5.4',
      raw: 'acp:codex:gpt-5.4',
      scoped: true,
    })
  })

  test('parses scoped claude model ids', () => {
    expect(parseAcpModel('acp:claude:claude-sonnet-4-6')).toEqual({
      agentId: 'claude',
      modelId: 'claude-sonnet-4-6',
      raw: 'acp:claude:claude-sonnet-4-6',
      scoped: true,
    })
  })

  test('keeps legacy plain models on default gemini agent', () => {
    expect(parseAcpModel('gemini-2.5-flash')).toEqual({
      agentId: 'gemini',
      modelId: 'gemini-2.5-flash',
      raw: 'gemini-2.5-flash',
      scoped: false,
    })
  })

  test('formats scoped ids consistently', () => {
    expect(toScopedAcpModelId('codex', 'gpt-5.4')).toBe('acp:codex:gpt-5.4')
  })
})
