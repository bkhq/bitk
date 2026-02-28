import { describe, expect, test } from 'bun:test'
import { CodexExecutor } from '@/engines/executors/codex'

const executor = new CodexExecutor()

function normalize(method: string, params?: Record<string, unknown>) {
  return executor.normalizeLog(JSON.stringify({ method, params }))
}

describe('CodexExecutor.normalizeLog', () => {
  // ------------------------------------------------------------------
  // 1. item/agentMessage/delta
  // ------------------------------------------------------------------
  describe('item/agentMessage/delta', () => {
    test('returns assistant-message with delta content', () => {
      const entry = normalize('item/agentMessage/delta', { delta: 'Hello world' })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('assistant-message')
      expect(entry!.content).toBe('Hello world')
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
      expect(entry!.content).toBe('Tool: command')
      expect(entry!.metadata?.toolName).toBe('command')
      expect(entry!.metadata?.itemId).toBe('cmd-1')
    })

    test('fileChange returns tool-use with path', () => {
      const entry = normalize('item/started', {
        item: { type: 'fileChange', id: 'fc-1', path: '/tmp/test.ts' },
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('tool-use')
      expect(entry!.content).toBe('Tool: fileChange')
      expect(entry!.metadata?.path).toBe('/tmp/test.ts')
    })

    test('agentMessage returns assistant-message', () => {
      const entry = normalize('item/started', {
        item: { type: 'agentMessage', text: 'I will help you' },
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('assistant-message')
      expect(entry!.content).toBe('I will help you')
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

    test('agentMessage returns assistant-message', () => {
      const entry = normalize('item/completed', {
        item: { type: 'agentMessage', text: 'Done!' },
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('assistant-message')
      expect(entry!.content).toBe('Done!')
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
      const entry = normalize('item/commandExecution/outputDelta', { delta: 'some output\n' })
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
      const entry = normalize('item/fileChange/outputDelta', { delta: 'diff content' })
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
      const entry = normalize('turn/completed', { turn: { id: 'turn-no-usage' } })
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
      const entry = normalize('item/agentMessage/delta', { delta: 'test' })
      expect(entry).not.toBeNull()
      expect(entry!.timestamp).toBeTruthy()
      // Verify ISO 8601 format
      expect(() => new Date(entry!.timestamp!)).not.toThrow()
    })
  })
})
