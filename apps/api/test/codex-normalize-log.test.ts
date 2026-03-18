import { describe, expect, test } from 'bun:test'
import { CodexExecutor, CodexLogNormalizer } from '@/engines/executors/codex'
import type { NormalizedLogEntry } from '@/engines/types'

const executor = new CodexExecutor()

function asSingleEntry(
  result: NormalizedLogEntry | NormalizedLogEntry[] | null,
): NormalizedLogEntry | null {
  if (!result) return null
  return Array.isArray(result) ? (result[0] ?? null) : result
}

function normalize(method: string, params?: Record<string, unknown>) {
  return asSingleEntry(executor.normalizeLog(JSON.stringify({ method, params })))
}

function parseSingle(normalizer: CodexLogNormalizer, rawLine: string) {
  return asSingleEntry(normalizer.parse(rawLine))
}

/** Helper: build a codex/event/* notification line */
function codexEvent(eventType: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    method: 'codex/event/xxx',
    params: { msg: { type: eventType, ...extra } },
  })
}

describe('CodexExecutor.normalizeLog', () => {
  // ------------------------------------------------------------------
  // 1. item/agentMessage/delta
  // ------------------------------------------------------------------
  describe('item/agentMessage/delta', () => {
    test('returns null (canonical text emitted by item/completed)', () => {
      const entry = normalize('item/agentMessage/delta', {
        delta: 'Hello world',
      })
      expect(entry).toBeNull()
    })

    test('returns null when delta is empty', () => {
      const entry = normalize('item/agentMessage/delta', {})
      expect(entry).toBeNull()
    })
  })

  // ------------------------------------------------------------------
  // 2. item/started
  // ------------------------------------------------------------------
  describe('item/started', () => {
    test('commandExecution returns tool-use', () => {
      const entry = normalize('item/started', {
        item: { type: 'commandExecution', id: 'cmd-1' },
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('tool-use')
      expect(entry!.content).toBe('Tool: Bash')
      expect(entry!.metadata?.toolName).toBe('Bash')
      expect(entry!.metadata?.toolCallId).toBe('cmd-1')
    })

    test('fileChange returns tool-use with path', () => {
      const entry = normalize('item/started', {
        item: { type: 'fileChange', id: 'fc-1', path: '/tmp/test.ts' },
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('tool-use')
      expect(entry!.content).toBe('Tool: Edit')
      expect(entry!.metadata?.path).toBe('/tmp/test.ts')
    })

    test('agentMessage returns null (canonical text emitted by item/completed)', () => {
      const entry = normalize('item/started', {
        item: { type: 'agentMessage', text: 'I will help you' },
      })
      expect(entry).toBeNull()
    })

    test('reasoning returns null', () => {
      const entry = normalize('item/started', {
        item: { type: 'reasoning', text: 'thinking...' },
      })
      expect(entry).toBeNull()
    })

    test('unknown item type returns null', () => {
      const entry = normalize('item/started', {
        item: { type: 'unknown_type' },
      })
      expect(entry).toBeNull()
    })
  })

  // ------------------------------------------------------------------
  // 3. item/completed
  // ------------------------------------------------------------------
  describe('item/completed', () => {
    test('commandExecution with stdout and exit code', () => {
      const entry = normalize('item/completed', {
        item: {
          type: 'commandExecution',
          id: 'cmd-done',
          command: ['ls', '-la'],
          stdout: 'file1.ts\nfile2.ts',
          stderr: '',
          exitCode: 0,
          duration: 150,
        },
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('tool-use')
      expect(entry!.content).toBe('file1.ts\nfile2.ts')
      expect(entry!.metadata?.isResult).toBe(true)
      expect(entry!.metadata?.exitCode).toBe(0)
      expect(entry!.metadata?.duration).toBe(150)
      expect(entry!.toolAction).toEqual({
        kind: 'command-run',
        command: 'ls -la',
        result: 'file1.ts\nfile2.ts',
        category: 'read',
      })
    })

    test('commandExecution with stderr combined', () => {
      const entry = normalize('item/completed', {
        item: {
          type: 'commandExecution',
          command: ['npm', 'install'],
          stdout: 'added 10 packages',
          stderr: 'WARN deprecated',
          exitCode: 0,
        },
      })
      expect(entry).not.toBeNull()
      expect(entry!.content).toBe('added 10 packages\nWARN deprecated')
    })

    test('fileChange with patches', () => {
      const entry = normalize('item/completed', {
        item: {
          type: 'fileChange',
          path: '/app/index.ts',
          patches: [{ op: 'replace' }, { op: 'add' }],
        },
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('tool-use')
      expect(entry!.content).toBe('File changed: /app/index.ts (2 patches)')
      expect(entry!.metadata?.isResult).toBe(true)
      expect(entry!.metadata?.path).toBe('/app/index.ts')
      expect(entry!.toolAction).toEqual({
        kind: 'file-edit',
        path: '/app/index.ts',
      })
    })

    test('fileChange single patch uses singular', () => {
      const entry = normalize('item/completed', {
        item: {
          type: 'fileChange',
          path: '/app/test.ts',
          patches: [{ op: 'replace' }],
        },
      })
      expect(entry).not.toBeNull()
      expect(entry!.content).toBe('File changed: /app/test.ts (1 patch)')
    })

    test('agentMessage returns null (handled by v2 codex/event/agent_message)', () => {
      const entry = normalize('item/completed', {
        item: { type: 'agentMessage', text: 'Done!' },
      })
      expect(entry).toBeNull()
    })

    test('reasoning returns null', () => {
      const entry = normalize('item/completed', {
        item: { type: 'reasoning' },
      })
      expect(entry).toBeNull()
    })
  })

  // ------------------------------------------------------------------
  // 4. Streaming output deltas
  // ------------------------------------------------------------------
  describe('streaming deltas', () => {
    test('commandExecution/outputDelta returns tool-use streaming', () => {
      const entry = normalize('item/commandExecution/outputDelta', {
        delta: 'some output\n',
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('tool-use')
      expect(entry!.content).toBe('some output\n')
      expect(entry!.metadata?.isResult).toBe(true)
      expect(entry!.metadata?.streaming).toBe(true)
    })

    test('commandExecution/outputDelta returns null on empty delta', () => {
      const entry = normalize('item/commandExecution/outputDelta', {})
      expect(entry).toBeNull()
    })

    test('fileChange/outputDelta returns tool-use streaming', () => {
      const entry = normalize('item/fileChange/outputDelta', {
        delta: 'diff content',
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('tool-use')
      expect(entry!.content).toBe('diff content')
      expect(entry!.metadata?.streaming).toBe(true)
    })

    test('fileChange/outputDelta returns null on empty delta', () => {
      const entry = normalize('item/fileChange/outputDelta', {})
      expect(entry).toBeNull()
    })
  })

  // ------------------------------------------------------------------
  // 5. Turn lifecycle
  // ------------------------------------------------------------------
  describe('turn lifecycle', () => {
    test('turn/started returns system-message with turn ID', () => {
      const entry = normalize('turn/started', { turn: { id: 'turn-123' } })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('system-message')
      expect(entry!.content).toBe('Turn started')
      expect(entry!.metadata?.subtype).toBe('turn_started')
      expect(entry!.metadata?.turnId).toBe('turn-123')
    })

    test('turn/completed with token usage formats large numbers', () => {
      const entry = normalize('turn/completed', {
        turn: {
          id: 'turn-done',
          usage: { inputTokens: 12500, outputTokens: 3400 },
        },
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('system-message')
      expect(entry!.content).toBe('12.5k input \u00B7 3.4k output')
      expect(entry!.metadata?.turnCompleted).toBe(true)
      expect(entry!.metadata?.inputTokens).toBe(12500)
      expect(entry!.metadata?.outputTokens).toBe(3400)
    })

    test('turn/completed with small token numbers uses raw count', () => {
      const entry = normalize('turn/completed', {
        turn: {
          id: 'turn-small',
          usage: { inputTokens: 500, outputTokens: 100 },
        },
      })
      expect(entry).not.toBeNull()
      expect(entry!.content).toBe('500 input \u00B7 100 output')
    })

    test('turn/completed without usage says Turn completed', () => {
      const entry = normalize('turn/completed', {
        turn: { id: 'turn-no-usage' },
      })
      expect(entry).not.toBeNull()
      expect(entry!.content).toBe('Turn completed')
    })
  })

  // ------------------------------------------------------------------
  // 6. Thread lifecycle
  // ------------------------------------------------------------------
  describe('thread lifecycle', () => {
    test('thread/started returns system-message', () => {
      const entry = normalize('thread/started', { threadId: 'thr-abc' })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('system-message')
      expect(entry!.content).toBe('Thread started')
      expect(entry!.metadata?.threadId).toBe('thr-abc')
    })

    test('thread/status/changed with systemError returns error-message', () => {
      const entry = normalize('thread/status/changed', {
        status: 'systemError',
        message: 'connection lost',
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('error-message')
      expect(entry!.content).toBe('Thread error: connection lost')
    })

    test('thread/status/changed with non-error returns null', () => {
      const entry = normalize('thread/status/changed', { status: 'idle' })
      expect(entry).toBeNull()
    })
  })

  // ------------------------------------------------------------------
  // 7. Error notification
  // ------------------------------------------------------------------
  describe('error notification', () => {
    test('error method returns error-message with willRetry', () => {
      const entry = normalize('error', {
        error: { code: 429, message: 'Rate limited' },
        willRetry: true,
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('error-message')
      expect(entry!.content).toBe('Rate limited')
      expect(entry!.metadata?.code).toBe(429)
      expect(entry!.metadata?.willRetry).toBe(true)
    })

    test('error without message shows Unknown error', () => {
      const entry = normalize('error', { error: {} })
      expect(entry).not.toBeNull()
      expect(entry!.content).toBe('Unknown error')
    })
  })

  // ------------------------------------------------------------------
  // 8. Reasoning (skipped)
  // ------------------------------------------------------------------
  describe('reasoning', () => {
    test('item/reasoning/textDelta returns null', () => {
      expect(normalize('item/reasoning/textDelta', { delta: 'thinking...' })).toBeNull()
    })

    test('item/reasoning/summaryTextDelta returns null', () => {
      expect(normalize('item/reasoning/summaryTextDelta', { delta: 'summary' })).toBeNull()
    })
  })

  // ------------------------------------------------------------------
  // 9. Edge cases
  // ------------------------------------------------------------------
  describe('edge cases', () => {
    test('unknown notification method returns null', () => {
      expect(normalize('some/future/method', { data: 'whatever' })).toBeNull()
    })

    test('no method field returns null', () => {
      const entry = executor.normalizeLog(JSON.stringify({ data: 'no method' }))
      expect(entry).toBeNull()
    })

    test('non-JSON line returns system-message', () => {
      const entry = executor.normalizeLog('some plain text output')
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('system-message')
      expect(entry!.content).toBe('some plain text output')
    })

    test('empty string returns null', () => {
      const entry = executor.normalizeLog('')
      expect(entry).toBeNull()
    })

    test('whitespace-only string returns null', () => {
      const entry = executor.normalizeLog('   ')
      expect(entry).toBeNull()
    })

    test('all entries have a timestamp', () => {
      const entry = normalize('turn/started', { turn: { id: 'ts-1' } })
      expect(entry).not.toBeNull()
      expect(entry!.timestamp).toBeTruthy()
      // Verify ISO 8601 format
      expect(() => new Date(entry!.timestamp!)).not.toThrow()
    })
  })
})

// ==================================================================
// Stateful CodexLogNormalizer — codex/event/* protocol tests
// ==================================================================
describe('CodexLogNormalizer (codex/event/*)', () => {
  // ------------------------------------------------------------------
  // Streaming assistant message accumulation
  // ------------------------------------------------------------------
  describe('agent_message_delta (streaming)', () => {
    test('accumulates deltas into full assistant-message', () => {
      const n = new CodexLogNormalizer()
      const r1 = parseSingle(n, codexEvent('agent_message_delta', { delta: 'Hello ' }))
      expect(r1).not.toBeNull()
      expect(r1!.entryType).toBe('assistant-message')
      expect(r1!.content).toBe('Hello ')
      expect(r1!.metadata?.streaming).toBe(true)

      const r2 = parseSingle(n, codexEvent('agent_message_delta', { delta: 'world!' }))
      expect(r2!.content).toBe('Hello world!')
    })

    test('empty delta returns null', () => {
      const n = new CodexLogNormalizer()
      expect(n.parse(codexEvent('agent_message_delta', { delta: '' }))).toBeNull()
    })

    test('resets thinking state when assistant delta arrives', () => {
      const n = new CodexLogNormalizer()
      n.parse(codexEvent('agent_reasoning_delta', { delta: 'thinking...' }))
      const r = parseSingle(n, codexEvent('agent_message_delta', { delta: 'Hi' }))
      expect(r!.entryType).toBe('assistant-message')
      expect(r!.content).toBe('Hi')
    })
  })

  describe('agent_message (complete)', () => {
    test('returns complete assistant-message and resets state', () => {
      const n = new CodexLogNormalizer()
      // Accumulate some deltas first
      n.parse(codexEvent('agent_message_delta', { delta: 'partial' }))
      const r = parseSingle(n, codexEvent('agent_message', { message: 'Full message' }))
      expect(r!.entryType).toBe('assistant-message')
      expect(r!.content).toBe('Full message')
      expect(r!.metadata?.streaming).toBeUndefined()

      // Next delta should start fresh
      const r2 = parseSingle(n, codexEvent('agent_message_delta', { delta: 'New' }))
      expect(r2!.content).toBe('New')
    })
  })

  // ------------------------------------------------------------------
  // Reasoning (thinking) events
  // ------------------------------------------------------------------
  describe('agent_reasoning_delta', () => {
    test('accumulates thinking text', () => {
      const n = new CodexLogNormalizer()
      const r1 = parseSingle(n, codexEvent('agent_reasoning_delta', { delta: 'Let me ' }))
      expect(r1!.entryType).toBe('thinking')
      expect(r1!.content).toBe('Let me ')
      expect(r1!.metadata?.streaming).toBe(true)

      const r2 = parseSingle(n, codexEvent('agent_reasoning_delta', { delta: 'think...' }))
      expect(r2!.content).toBe('Let me think...')
    })
  })

  describe('agent_reasoning (complete)', () => {
    test('returns complete thinking entry', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('agent_reasoning', { text: 'Full reasoning' }))
      expect(r!.entryType).toBe('thinking')
      expect(r!.content).toBe('Full reasoning')
      expect(r!.metadata?.streaming).toBeUndefined()
    })
  })

  // ------------------------------------------------------------------
  // Command execution events
  // ------------------------------------------------------------------
  describe('exec_command_begin', () => {
    test('returns tool-use with command', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('exec_command_begin', {
        command: ['git', 'status'],
        call_id: 'call-1',
      }))
      expect(r!.entryType).toBe('tool-use')
      expect(r!.content).toBe('Tool: Bash')
      expect(r!.metadata?.toolName).toBe('Bash')
      expect(r!.metadata?.toolCallId).toBe('call-1')
      expect(r!.metadata?.input).toEqual({ command: 'git status' })
      expect(r!.toolAction?.kind).toBe('command-run')
    })

    test('returns null for empty command', () => {
      const n = new CodexLogNormalizer()
      expect(n.parse(codexEvent('exec_command_begin', { command: [] }))).toBeNull()
    })
  })

  describe('exec_command_output_delta', () => {
    test('returns streaming tool output', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('exec_command_output_delta', {
        chunk: 'output text',
        stream: 'stdout',
      }))
      expect(r!.entryType).toBe('tool-use')
      expect(r!.content).toBe('output text')
      expect(r!.metadata?.streaming).toBe(true)
      expect(r!.metadata?.outputStream).toBe('stdout')
    })
  })

  describe('exec_command_end', () => {
    test('returns tool result with exit code', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('exec_command_end', {
        command: ['ls', '-la'],
        exit_code: 0,
        formatted_output: 'file1.ts\nfile2.ts',
        call_id: 'call-2',
      }))
      expect(r!.entryType).toBe('tool-use')
      expect(r!.content).toBe('file1.ts\nfile2.ts')
      expect(r!.metadata?.isResult).toBe(true)
      expect(r!.metadata?.exitCode).toBe(0)
      expect(r!.toolAction?.kind).toBe('command-run')
    })
  })

  // ------------------------------------------------------------------
  // File patch events
  // ------------------------------------------------------------------
  describe('patch_apply_begin', () => {
    test('returns tool-use entries for each changed file', () => {
      const n = new CodexLogNormalizer()
      const r = n.parse(
        codexEvent('patch_apply_begin', {
          changes: {
            '/app/a.ts': { type: 'add', content: 'new file content' },
            '/app/b.ts': { type: 'update', unified_diff: '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new' },
          },
          call_id: 'patch-1',
        }),
      )
      expect(Array.isArray(r)).toBe(true)
      const entries = r as any[]
      expect(entries.length).toBe(2)
      expect(entries[0].metadata?.path).toBe('/app/a.ts')
      expect(entries[0].metadata?.input).toEqual({ file_path: '/app/a.ts', content: 'new file content' })
      expect(entries[1].metadata?.path).toBe('/app/b.ts')
      expect(entries[1].metadata?.input).toEqual({
        file_path: '/app/b.ts',
        unified_diff: '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new',
      })
    })

    test('single file returns single entry (not array)', () => {
      const n = new CodexLogNormalizer()
      const r = n.parse(
        codexEvent('patch_apply_begin', {
          changes: { '/app/x.ts': { type: 'add', content: 'hello' } },
        }),
      )
      expect(Array.isArray(r)).toBe(false)
      expect((r as any).metadata?.path).toBe('/app/x.ts')
      expect((r as any).metadata?.input?.content).toBe('hello')
    })

    test('delete type sets deleted flag', () => {
      const n = new CodexLogNormalizer()
      const r = n.parse(
        codexEvent('patch_apply_begin', {
          changes: { '/app/del.ts': { type: 'delete', content: 'old content' } },
        }),
      )
      expect((r as any).metadata?.input).toEqual({ file_path: '/app/del.ts', deleted: true })
    })

    test('non-object fileChange falls back to path-only input', () => {
      const n = new CodexLogNormalizer()
      const r = n.parse(
        codexEvent('patch_apply_begin', {
          changes: { '/app/x.ts': '+line' },
        }),
      )
      expect((r as any).metadata?.input).toEqual({ file_path: '/app/x.ts' })
    })
  })

  describe('patch_apply_end', () => {
    test('returns success result', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('patch_apply_end', { success: true }))
      expect(r!.content).toBe('Patch applied successfully')
      expect(r!.metadata?.exitCode).toBe(0)
    })

    test('returns failure result', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('patch_apply_end', { success: false }))
      expect(r!.content).toBe('Patch apply failed')
      expect(r!.metadata?.exitCode).toBe(1)
    })
  })

  // ------------------------------------------------------------------
  // MCP tool call events
  // ------------------------------------------------------------------
  describe('mcp_tool_call_begin', () => {
    test('returns tool-use with server:tool name', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('mcp_tool_call_begin', {
        invocation: {
          server: 'fs',
          tool: 'readFile',
          arguments: { path: '/tmp' },
        },
      }))
      expect(r!.metadata?.toolName).toBe('mcp:fs:readFile')
      expect(r!.toolAction?.kind).toBe('tool')
    })
  })

  describe('mcp_tool_call_end', () => {
    test('extracts text content from result', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('mcp_tool_call_end', {
        invocation: { server: 'fs', tool: 'readFile' },
        result: {
          content: [{ type: 'text', text: 'file contents' }],
          is_error: false,
        },
      }))
      expect(r!.content).toBe('file contents')
      expect(r!.metadata?.exitCode).toBe(0)
    })

    test('handles error result', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('mcp_tool_call_end', {
        invocation: { server: 'fs', tool: 'readFile' },
        result: { is_error: true },
      }))
      expect(r!.content).toBe('MCP tool call failed')
      expect(r!.metadata?.exitCode).toBe(1)
    })
  })

  // ------------------------------------------------------------------
  // Error / warning / system events
  // ------------------------------------------------------------------
  describe('error and warning events', () => {
    test('error returns error-message', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('error', { message: 'API error' }))
      expect(r!.entryType).toBe('error-message')
      expect(r!.content).toBe('Error: API error')
    })

    test('stream_error returns error-message', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('stream_error', { message: 'connection lost' }))
      expect(r!.entryType).toBe('error-message')
      expect(r!.content).toBe('Stream error: connection lost')
    })

    test('warning returns error-message', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('warning', { message: 'Deprecated API' }))
      expect(r!.entryType).toBe('error-message')
      expect(r!.content).toBe('Deprecated API')
    })

    test('warning with empty message returns null', () => {
      const n = new CodexLogNormalizer()
      expect(n.parse(codexEvent('warning', { message: '' }))).toBeNull()
    })
  })

  describe('system events', () => {
    test('model_reroute', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('model_reroute', {
        from_model: 'gpt-4o',
        to_model: 'gpt-5.3-codex',
      }))
      expect(r!.entryType).toBe('system-message')
      expect(r!.content).toBe('Model rerouted from gpt-4o to gpt-5.3-codex')
    })

    test('token_count', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('token_count', {
        info: {
          last_token_usage: { total_tokens: 5000 },
          model_context_window: 128000,
        },
      }))
      expect(r!.entryType).toBe('token-usage')
      expect(r!.metadata?.totalTokens).toBe(5000)
      expect(r!.metadata?.contextWindow).toBe(128000)
    })

    test('context_compacted', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('context_compacted'))
      expect(r!.content).toBe('Context compacted')
    })

    test('session_configured', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('session_configured', {
        model: 'gpt-5.3-codex',
        session_id: 'sess-123',
      }))
      expect(r!.content).toBe('model: gpt-5.3-codex')
      expect(r!.metadata?.sessionId).toBe('sess-123')
    })
  })

  // ------------------------------------------------------------------
  // Skipped events
  // ------------------------------------------------------------------
  describe('skipped events', () => {
    const skipTypes = [
      'mcp_startup_update',
      'mcp_startup_complete',
      'user_message',
      'turn_diff',
      'shutdown_complete',
    ]
    for (const type of skipTypes) {
      test(`${type} returns null`, () => {
        const n = new CodexLogNormalizer()
        expect(n.parse(codexEvent(type))).toBeNull()
      })
    }
  })

  // ------------------------------------------------------------------
  // Streaming state reset on tool use
  // ------------------------------------------------------------------
  describe('streaming state management', () => {
    test('exec_command_begin resets accumulated assistant text', () => {
      const n = new CodexLogNormalizer()
      n.parse(codexEvent('agent_message_delta', { delta: 'partial text' }))
      n.parse(codexEvent('exec_command_begin', { command: ['ls'] }))
      // Next delta should start fresh
      const r = parseSingle(n, codexEvent('agent_message_delta', { delta: 'New' }))
      expect(r!.content).toBe('New')
    })

    test('agent_reasoning_section_break resets all state', () => {
      const n = new CodexLogNormalizer()
      n.parse(codexEvent('agent_reasoning_delta', { delta: 'thinking' }))
      n.parse(codexEvent('agent_reasoning_section_break'))
      const r = parseSingle(n, codexEvent('agent_reasoning_delta', { delta: 'fresh' }))
      expect(r!.content).toBe('fresh')
    })

    test('plan_update resets assistant buffer so next delta starts fresh', () => {
      const n = new CodexLogNormalizer()
      n.parse(codexEvent('plan_delta', { delta: 'Step 1: do X' }))
      n.parse(
        codexEvent('plan_update', {
          plan: [{ step: 'Step 1', status: 'done' }],
        }),
      )
      // Next agent_message_delta should NOT include stale plan text
      const r = parseSingle(n, codexEvent('agent_message_delta', { delta: 'Answer' }))
      expect(r!.content).toBe('Answer')
    })

    test('turn_complete resets streaming state', () => {
      const n = new CodexLogNormalizer()
      n.parse(codexEvent('agent_message_delta', { delta: 'partial' }))
      n.parse(codexEvent('turn_complete'))
      // Next delta should start fresh
      const r = parseSingle(n, codexEvent('agent_message_delta', { delta: 'New turn' }))
      expect(r!.content).toBe('New turn')
    })
  })

  // ------------------------------------------------------------------
  // JSON-RPC response handling (session configured)
  // ------------------------------------------------------------------
  describe('JSON-RPC response handling', () => {
    test('thread/start response with model emits session_configured', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, JSON.stringify({
        id: 1,
        result: { thread: { id: 'thr-1' }, model: 'gpt-5.3-codex' },
      }))
      expect(r!.entryType).toBe('system-message')
      expect(r!.content).toBe('model: gpt-5.3-codex')
    })

    test('response without thread returns null', () => {
      const n = new CodexLogNormalizer()
      expect(n.parse(JSON.stringify({ id: 1, result: {} }))).toBeNull()
    })
  })

  // ------------------------------------------------------------------
  // Turn complete / turn started (v2 codex/event)
  // ------------------------------------------------------------------
  describe('turn_complete event', () => {
    test('emits completion entry with turnCompleted metadata', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('turn_complete'))
      expect(r).not.toBeNull()
      expect(r!.entryType).toBe('system-message')
      expect(r!.metadata?.turnCompleted).toBe(true)
    })

    test('extracts turn_id and ignores last_agent_message (already streamed)', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('turn_complete', {
        turn_id: 'turn-42',
        last_agent_message: 'Done!',
      }))
      // last_agent_message is NOT used — the same text was already streamed via agent_message_delta
      expect(r!.content).toBe('Turn completed')
      expect(r!.metadata?.turnId).toBe('turn-42')
    })

    test('task_complete alias works', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('task_complete', { turn_id: 'tc-1' }))
      expect(r!.metadata?.turnCompleted).toBe(true)
      expect(r!.metadata?.turnId).toBe('tc-1')
    })
  })

  describe('turn_started event', () => {
    test('extracts turn_id and context window', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('turn_started', {
        turn_id: 'ts-1',
        model_context_window: 128000,
        collaboration_mode_kind: 'default',
      }))
      expect(r!.entryType).toBe('system-message')
      expect(r!.metadata?.turnId).toBe('ts-1')
      expect(r!.metadata?.contextWindow).toBe(128000)
      expect(r!.metadata?.collabMode).toBe('default')
    })

    test('task_started alias works', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('task_started', { turn_id: 'ts-2' }))
      expect(r!.metadata?.subtype).toBe('turn_started')
      expect(r!.metadata?.turnId).toBe('ts-2')
    })
  })

  describe('turn_aborted event', () => {
    test('emits system-message with turnCompleted', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('turn_aborted'))
      expect(r!.entryType).toBe('system-message')
      expect(r!.content).toBe('Turn aborted')
      expect(r!.metadata?.turnCompleted).toBe(true)
    })
  })

  // ------------------------------------------------------------------
  // Plan events
  // ------------------------------------------------------------------
  describe('plan events', () => {
    test('plan_delta accumulates plan text', () => {
      const n = new CodexLogNormalizer()
      const r1 = parseSingle(n, codexEvent('plan_delta', { delta: 'Step 1: ' }))
      expect(r1!.content).toBe('Step 1: ')
      expect(r1!.metadata?.isPlan).toBe(true)

      const r2 = parseSingle(n, codexEvent('plan_delta', { delta: 'do something' }))
      expect(r2!.content).toBe('Step 1: do something')
    })

    test('plan_update with steps', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('plan_update', {
        plan: [
          { step: 'Read file', status: 'done' },
          { step: 'Edit file', status: 'pending' },
        ],
        explanation: 'Updated plan',
      }))
      expect(r!.entryType).toBe('system-message')
      expect(r!.content).toBe('Updated plan')
    })
  })

  // ------------------------------------------------------------------
  // exec_command_begin enriched fields
  // ------------------------------------------------------------------
  describe('exec_command_begin enriched fields', () => {
    test('includes cwd, source, and parsed_cmd description', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('exec_command_begin', {
        command: ['cat', '/app/file.ts'],
        call_id: 'c1',
        cwd: '/app',
        source: 'agent',
        parsed_cmd: [{ type: 'read', cmd: 'cat', name: 'cat', path: '/app/file.ts' }],
      }))
      expect(r!.metadata?.cwd).toBe('/app')
      expect(r!.metadata?.source).toBe('agent')
      expect((r!.metadata?.input as { description?: string } | undefined)?.description).toBe('Read /app/file.ts')
    })

    test('parsed_cmd search type', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('exec_command_begin', {
        command: ['grep', '-r', 'foo', '/app'],
        call_id: 'c2',
        parsed_cmd: [{ type: 'search', cmd: 'grep', query: 'foo', path: '/app' }],
      }))
      expect((r!.metadata?.input as { description?: string } | undefined)?.description).toBe('Search "foo" in /app')
    })

    test('parsed_cmd unknown type has no description', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('exec_command_begin', {
        command: ['echo', 'hi'],
        call_id: 'c3',
        parsed_cmd: [{ type: 'unknown', cmd: 'echo' }],
      }))
      expect((r!.metadata?.input as { description?: string } | undefined)?.description).toBeUndefined()
    })
  })

  // ------------------------------------------------------------------
  // exec_command_end enriched fields
  // ------------------------------------------------------------------
  describe('exec_command_end duration', () => {
    test('includes duration string', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('exec_command_end', {
        command: ['ls'],
        exit_code: 0,
        formatted_output: 'file1',
        duration: '1.2s',
      }))
      expect(r!.metadata?.duration).toBe('1.2s')
    })
  })

  // ------------------------------------------------------------------
  // patch_apply_begin enriched fields
  // ------------------------------------------------------------------
  describe('patch_apply_begin auto_approved', () => {
    test('includes autoApproved metadata', () => {
      const n = new CodexLogNormalizer()
      const r = n.parse(
        codexEvent('patch_apply_begin', {
          changes: { '/app/x.ts': { type: 'add', content: 'hi' } },
          auto_approved: true,
        }),
      )
      expect((r as any).metadata?.autoApproved).toBe(true)
    })
  })

  // ------------------------------------------------------------------
  // patch_apply_end enriched fields
  // ------------------------------------------------------------------
  describe('patch_apply_end enriched', () => {
    test('includes stdout/stderr in content', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('patch_apply_end', {
        success: true,
        call_id: 'p1',
        stdout: 'Applied 2 edits',
        stderr: '',
        changes: { '/app/a.ts': { type: 'update', unified_diff: 'diff' } },
      }))
      expect(r!.content).toBe('Applied 2 edits')
      expect(r!.metadata?.changedPaths).toEqual(['/app/a.ts'])
    })

    test('falls back to default message when no stdout/stderr', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('patch_apply_end', { success: false }))
      expect(r!.content).toBe('Patch apply failed')
    })
  })

  // ------------------------------------------------------------------
  // exec_approval_request enriched fields
  // ------------------------------------------------------------------
  describe('exec_approval_request enriched', () => {
    test('includes cwd and reason', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('exec_approval_request', {
        command: ['rm', '-rf', '/tmp/build'],
        call_id: 'ea-1',
        cwd: '/app',
        reason: 'Needs elevated permissions',
        parsed_cmd: [{ type: 'unknown', cmd: 'rm' }],
      }))
      expect(r!.metadata?.cwd).toBe('/app')
      expect(r!.metadata?.reason).toBe('Needs elevated permissions')
    })
  })

  // ------------------------------------------------------------------
  // apply_patch_approval_request enriched fields
  // ------------------------------------------------------------------
  describe('apply_patch_approval_request enriched', () => {
    test('includes reason', () => {
      const n = new CodexLogNormalizer()
      const r = n.parse(
        codexEvent('apply_patch_approval_request', {
          changes: { '/app/x.ts': { type: 'add', content: 'new' } },
          call_id: 'pa-1',
          reason: 'Write to protected path',
        }),
      )
      expect((r as any).metadata?.reason).toBe('Write to protected path')
    })
  })

  // ------------------------------------------------------------------
  // mcp_tool_call_end Ok/Err envelope
  // ------------------------------------------------------------------
  describe('mcp_tool_call_end Ok/Err envelope', () => {
    test('unwraps Ok envelope', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('mcp_tool_call_end', {
        invocation: { server: 'fs', tool: 'read' },
        result: { Ok: { content: [{ type: 'text', text: 'contents' }] } },
        duration: '0.5s',
      }))
      expect(r!.content).toBe('contents')
      expect(r!.metadata?.exitCode).toBe(0)
      expect(r!.metadata?.duration).toBe('0.5s')
    })

    test('unwraps Err envelope', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('mcp_tool_call_end', {
        invocation: { server: 'fs', tool: 'read' },
        result: { Err: 'file not found' },
      }))
      expect(r!.content).toBe('file not found')
      expect(r!.metadata?.exitCode).toBe(1)
    })

    test('backwards compat: flat result without Ok/Err', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('mcp_tool_call_end', {
        invocation: { server: 'fs', tool: 'read' },
        result: { content: [{ type: 'text', text: 'flat' }], is_error: false },
      }))
      expect(r!.content).toBe('flat')
      expect(r!.metadata?.exitCode).toBe(0)
    })
  })

  // ------------------------------------------------------------------
  // session_configured enriched fields
  // ------------------------------------------------------------------
  describe('session_configured enriched', () => {
    test('includes provider, cwd, approval policy', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('session_configured', {
        model: 'o3',
        session_id: 's1',
        model_provider_id: 'openai',
        cwd: '/app',
        approval_policy: 'never',
        reasoning_effort: 'high',
        forked_from_id: 'parent-s1',
        thread_name: 'my thread',
      }))
      expect(r!.content).toBe('model: o3  provider: openai')
      expect(r!.metadata?.modelProviderId).toBe('openai')
      expect(r!.metadata?.cwd).toBe('/app')
      expect(r!.metadata?.approvalPolicy).toBe('never')
      expect(r!.metadata?.reasoningEffort).toBe('high')
      expect(r!.metadata?.forkedFromId).toBe('parent-s1')
      expect(r!.metadata?.threadName).toBe('my thread')
    })
  })

  // ------------------------------------------------------------------
  // error event with codex_error_info
  // ------------------------------------------------------------------
  describe('error with codex_error_info', () => {
    test('extracts string error type', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('error', {
        message: 'Context exceeded',
        codex_error_info: 'context_window_exceeded',
      }))
      expect(r!.metadata?.errorType).toBe('context_window_exceeded')
    })

    test('extracts object error type key', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('error', {
        message: 'HTTP error',
        codex_error_info: { http_connection_failed: { http_status_code: 429 } },
      }))
      expect(r!.metadata?.errorType).toBe('http_connection_failed')
    })

    test('no error info has no errorType', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('error', { message: 'plain error' }))
      expect(r!.metadata?.errorType).toBeUndefined()
    })
  })

  // ------------------------------------------------------------------
  // token_count enriched fields
  // ------------------------------------------------------------------
  describe('token_count enriched', () => {
    test('includes input/output tokens and rate limits', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('token_count', {
        info: {
          last_token_usage: { total_tokens: 5000, input_tokens: 3000, output_tokens: 2000 },
          model_context_window: 128000,
        },
        rate_limits: { requests_remaining: 10 },
      }))
      expect(r!.metadata?.inputTokens).toBe(3000)
      expect(r!.metadata?.outputTokens).toBe(2000)
      expect(r!.metadata?.rateLimits).toEqual({ requests_remaining: 10 })
    })
  })

  // ------------------------------------------------------------------
  // Interactive events (previously dropped)
  // ------------------------------------------------------------------
  describe('request_user_input', () => {
    test('returns system-message with questions', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('request_user_input', {
        call_id: 'rui-1',
        turn_id: 't1',
        questions: [{ question: 'Do you want to proceed?' }],
      }))
      expect(r!.entryType).toBe('system-message')
      expect(r!.content).toBe('Do you want to proceed?')
      expect(r!.metadata?.subtype).toBe('request_user_input')
    })
  })

  describe('dynamic_tool_call_request', () => {
    test('returns tool-use entry', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('dynamic_tool_call_request', {
        callId: 'dtc-1',
        turnId: 't1',
        tool: 'custom_tool',
        arguments: { key: 'value' },
      }))
      expect(r!.entryType).toBe('tool-use')
      expect(r!.metadata?.toolName).toBe('custom_tool')
      expect(r!.metadata?.input).toEqual({ key: 'value' })
    })
  })

  describe('terminal_interaction', () => {
    test('returns system-message with stdin', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('terminal_interaction', {
        call_id: 'ti-1',
        process_id: 'pid-1',
        stdin: 'yes\n',
      }))
      expect(r!.entryType).toBe('system-message')
      expect(r!.content).toContain('yes')
      expect(r!.metadata?.subtype).toBe('terminal_interaction')
      expect(r!.metadata?.processId).toBe('pid-1')
    })
  })

  // ------------------------------------------------------------------
  // Review mode events
  // ------------------------------------------------------------------
  describe('review mode events', () => {
    test('entered_review_mode returns system-message', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('entered_review_mode', { user_facing_hint: 'Review changes' }))
      expect(r!.entryType).toBe('system-message')
      expect(r!.content).toBe('Review changes')
      expect(r!.metadata?.subtype).toBe('entered_review_mode')
    })

    test('exited_review_mode returns system-message', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('exited_review_mode'))
      expect(r!.entryType).toBe('system-message')
      expect(r!.content).toBe('Exited review mode')
    })
  })

  // ------------------------------------------------------------------
  // Collaboration events
  // ------------------------------------------------------------------
  describe('collaboration events', () => {
    test('collab_agent_spawn_begin returns system-message with prompt', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('collab_agent_spawn_begin', {
        call_id: 'cs-1',
        sender_thread_id: 'sender-1',
        prompt: 'Fix the bug in auth module',
      }))
      expect(r!.entryType).toBe('system-message')
      expect(r!.content).toContain('Fix the bug')
      expect(r!.metadata?.subtype).toBe('collab_agent_spawn_begin')
    })

    test('collab_agent_spawn_end returns system-message with status', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('collab_agent_spawn_end', {
        call_id: 'cs-1',
        new_thread_id: 'new-1',
        status: 'running',
        prompt: '',
        sender_thread_id: 'sender-1',
      }))
      expect(r!.content).toBe('Agent spawned: running')
      expect(r!.metadata?.newThreadId).toBe('new-1')
    })

    test('collab_agent_interaction_begin returns system-message', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('collab_agent_interaction_begin', {
        call_id: 'ci-1',
        prompt: 'Check status',
      }))
      expect(r!.content).toContain('Check status')
    })

    test('collab_waiting_begin shows count', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('collab_waiting_begin', {
        call_id: 'cw-1',
        receiver_thread_ids: ['t1', 't2', 't3'],
      }))
      expect(r!.content).toBe('Waiting for 3 agent(s)')
    })
  })

  // ------------------------------------------------------------------
  // Elicitation request
  // ------------------------------------------------------------------
  describe('elicitation_request', () => {
    test('returns system-message with server name', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('elicitation_request', {
        server_name: 'github',
        message: 'Please authenticate',
        id: 'el-1',
      }))
      expect(r!.entryType).toBe('system-message')
      expect(r!.content).toBe('Please authenticate')
      expect(r!.metadata?.serverName).toBe('github')
    })
  })

  // ------------------------------------------------------------------
  // web_search_end enriched
  // ------------------------------------------------------------------
  describe('web_search_end enriched', () => {
    test('includes action type', () => {
      const n = new CodexLogNormalizer()
      const r = parseSingle(n, codexEvent('web_search_end', {
        call_id: 'ws-1',
        query: 'how to fix TypeScript errors',
        action: { type: 'search' },
      }))
      expect(r!.metadata?.actionType).toBe('search')
    })
  })
})
