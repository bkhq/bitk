import { describe, expect, test } from 'bun:test'
import { CodexProtocolHandler } from '@/engines/executors/codex'

/** Create a mock stdin (FileSink-like) that captures written data. */
function createMockStdin() {
  const written: string[] = []
  return {
    sink: {
      write(data: string) {
        written.push(data)
      },
      flush() {},
      end() {},
    } as unknown as import('bun').FileSink,
    written,
  }
}

/** Create a mock stdout (ReadableStream) that we can push data into. */
function createMockStdout() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })

  const encoder = new TextEncoder()
  return {
    stream,
    push(line: string) {
      controller.enqueue(encoder.encode(`${line}\n`))
    },
    close() {
      controller.close()
    },
  }
}

/** Small delay for async background reader processing. */
const tick = () => new Promise((r) => setTimeout(r, 30))

describe('CodexProtocolHandler', () => {
  test('initialize sends request and resolves on response', async () => {
    const { sink, written } = createMockStdin()
    const stdout = createMockStdout()

    const handler = new CodexProtocolHandler(sink, stdout.stream, 5000)

    // Start initialize — it will send request id=1
    const initPromise = handler.initialize()
    await tick()

    // Verify the request was written
    expect(written.length).toBeGreaterThanOrEqual(1)
    const req = JSON.parse(written[0]!)
    expect(req.id).toBe(1)
    expect(req.method).toBe('initialize')
    expect(req.params.clientInfo.name).toBe('bitk')

    // Simulate server response
    stdout.push(JSON.stringify({ id: 1, result: { userAgent: 'codex/1.0' } }))

    const result = await initPromise
    expect(result.userAgent).toBe('codex/1.0')

    // After initialize resolves, it sends 'initialized' notification
    // written[0] = initialize request, written[1] = initialized notification
    expect(written.length).toBeGreaterThanOrEqual(2)
    const notif = JSON.parse(written[1]!)
    expect(notif.method).toBe('initialized')
    expect(notif.id).toBeUndefined()

    handler.close()
    stdout.close()
  })

  test('startThread resolves thread ID and stores it', async () => {
    const { sink, written } = createMockStdin()
    const stdout = createMockStdout()

    const handler = new CodexProtocolHandler(sink, stdout.stream, 5000)

    const threadPromise = handler.startThread({ model: 'o3', cwd: '/tmp' })
    await tick()

    // Verify the request
    const req = JSON.parse(written[0]!)
    expect(req.method).toBe('thread/start')
    expect(req.params.model).toBe('o3')
    expect(req.params.cwd).toBe('/tmp')

    // Simulate response
    stdout.push(JSON.stringify({ id: req.id, result: { thread: { id: 'thread-abc' } } }))

    const threadId = await threadPromise
    expect(threadId).toBe('thread-abc')
    expect(handler.threadId).toBe('thread-abc')

    handler.close()
    stdout.close()
  })

  test('startThread throws when thread.id is missing', async () => {
    const { sink } = createMockStdin()
    const stdout = createMockStdout()

    const handler = new CodexProtocolHandler(sink, stdout.stream, 5000)

    const threadPromise = handler.startThread({})
    await tick()

    // Response without thread.id
    stdout.push(JSON.stringify({ id: 1, result: {} }))

    await expect(threadPromise).rejects.toThrow('thread/start response missing thread.id')

    handler.close()
    stdout.close()
  })

  test('startTurn resolves turn ID and stores it', async () => {
    const { sink, written } = createMockStdin()
    const stdout = createMockStdout()

    const handler = new CodexProtocolHandler(sink, stdout.stream, 5000)

    const turnPromise = handler.startTurn('thread-abc', 'Hello world')
    await tick()

    const req = JSON.parse(written[0]!)
    expect(req.method).toBe('turn/start')
    expect(req.params.threadId).toBe('thread-abc')
    expect(req.params.input).toEqual([{ type: 'text', text: 'Hello world' }])

    // Simulate response
    stdout.push(JSON.stringify({ id: req.id, result: { turn: { id: 'turn-001' } } }))

    const turnId = await turnPromise
    expect(turnId).toBe('turn-001')
    expect(handler.turnId).toBe('turn-001')

    handler.close()
    stdout.close()
  })

  test('auto-approves command execution approval requests', async () => {
    const { sink, written } = createMockStdin()
    const stdout = createMockStdout()

    const handler = new CodexProtocolHandler(sink, stdout.stream, 5000)
    await tick()

    // Server sends approval request
    stdout.push(
      JSON.stringify({
        id: 99,
        method: 'item/commandExecution/requestApproval',
        params: { command: ['ls', '-la'] },
      }),
    )
    await tick()

    // Handler should have auto-approved
    const approvalResp = written.find((w) => {
      try {
        const p = JSON.parse(w)
        return p.id === 99 && p.result?.decision === 'accept'
      } catch {
        return false
      }
    })
    expect(approvalResp).toBeTruthy()

    handler.close()
    stdout.close()
  })

  test('auto-approves file change approval requests', async () => {
    const { sink, written } = createMockStdin()
    const stdout = createMockStdout()

    const handler = new CodexProtocolHandler(sink, stdout.stream, 5000)
    await tick()

    // Server sends file change approval
    stdout.push(
      JSON.stringify({
        id: 100,
        method: 'item/fileChange/requestApproval',
        params: { path: '/tmp/test.ts' },
      }),
    )
    await tick()

    const approvalResp = written.find((w) => {
      try {
        const p = JSON.parse(w)
        return p.id === 100 && p.result?.decision === 'accept'
      } catch {
        return false
      }
    })
    expect(approvalResp).toBeTruthy()

    handler.close()
    stdout.close()
  })

  test('rejects unknown server requests with error', async () => {
    const { sink, written } = createMockStdin()
    const stdout = createMockStdout()

    const handler = new CodexProtocolHandler(sink, stdout.stream, 5000)
    await tick()

    // Server sends unknown request
    stdout.push(
      JSON.stringify({
        id: 200,
        method: 'unknown/method',
        params: {},
      }),
    )
    await tick()

    const errorResp = written.find((w) => {
      try {
        const p = JSON.parse(w)
        return p.id === 200 && p.error?.code === -32601
      } catch {
        return false
      }
    })
    expect(errorResp).toBeTruthy()

    handler.close()
    stdout.close()
  })

  test('notifications are pushed to the notifications stream', async () => {
    const { sink } = createMockStdin()
    const stdout = createMockStdout()

    const handler = new CodexProtocolHandler(sink, stdout.stream, 5000)

    // Get a reader for the notifications stream
    const reader = handler.notifications.getReader()
    const decoder = new TextDecoder()

    await tick()

    // Push a notification (no id)
    const notification = { method: 'item/agentMessage/delta', params: { delta: 'hello' } }
    stdout.push(JSON.stringify(notification))
    await tick()

    // Read from notifications — should get the notification line
    const { value, done } = await reader.read()
    expect(done).toBe(false)
    const text = decoder.decode(value).trim()
    const parsed = JSON.parse(text)
    expect(parsed.method).toBe('item/agentMessage/delta')

    reader.releaseLock()
    handler.close()
    stdout.close()
  })

  test('turn/completed notification clears turnId', async () => {
    const { sink, written } = createMockStdin()
    const stdout = createMockStdout()

    const handler = new CodexProtocolHandler(sink, stdout.stream, 5000)

    // Start a turn to set turnId
    const turnPromise = handler.startTurn('t1', 'test')
    await tick()
    const req = JSON.parse(written[0]!)
    stdout.push(JSON.stringify({ id: req.id, result: { turn: { id: 'turn-x' } } }))
    await turnPromise

    expect(handler.turnId).toBe('turn-x')

    // Start reading notifications to consume the stream
    const reader = handler.notifications.getReader()

    // Push turn/completed notification
    stdout.push(JSON.stringify({ method: 'turn/completed', params: {} }))
    await tick()

    // Read and discard the notification
    await reader.read()

    expect(handler.turnId).toBeUndefined()

    reader.releaseLock()
    handler.close()
    stdout.close()
  })

  test('close rejects pending requests', async () => {
    const { sink } = createMockStdin()
    const stdout = createMockStdout()

    const handler = new CodexProtocolHandler(sink, stdout.stream, 5000)

    // Start a request that won't get a response
    const promise = handler.startThread({ model: 'test' })
    await tick()

    // Close before response arrives
    handler.close()

    await expect(promise).rejects.toThrow('Connection closed')

    stdout.close()
  })

  test('RPC error response rejects the pending promise', async () => {
    const { sink, written } = createMockStdin()
    const stdout = createMockStdout()

    const handler = new CodexProtocolHandler(sink, stdout.stream, 5000)

    const promise = handler.startThread({})
    await tick()

    const req = JSON.parse(written[0]!)
    stdout.push(
      JSON.stringify({ id: req.id, error: { code: -1, message: 'thread creation failed' } }),
    )

    await expect(promise).rejects.toThrow('thread creation failed')

    handler.close()
    stdout.close()
  })

  test('non-JSON lines are pushed through notifications', async () => {
    const { sink } = createMockStdin()
    const stdout = createMockStdout()

    const handler = new CodexProtocolHandler(sink, stdout.stream, 5000)
    const reader = handler.notifications.getReader()
    const decoder = new TextDecoder()

    await tick()

    stdout.push('some plain text output')
    await tick()

    const { value } = await reader.read()
    expect(decoder.decode(value).trim()).toBe('some plain text output')

    reader.releaseLock()
    handler.close()
    stdout.close()
  })

  test('resumeThread stores the thread ID', async () => {
    const { sink, written } = createMockStdin()
    const stdout = createMockStdout()

    const handler = new CodexProtocolHandler(sink, stdout.stream, 5000)

    const resumePromise = handler.resumeThread('existing-thread')
    await tick()

    const req = JSON.parse(written[0]!)
    expect(req.method).toBe('thread/resume')
    expect(req.params.threadId).toBe('existing-thread')

    stdout.push(JSON.stringify({ id: req.id, result: {} }))

    await resumePromise
    expect(handler.threadId).toBe('existing-thread')

    handler.close()
    stdout.close()
  })

  test('sendUserMessage starts a new turn on existing thread', async () => {
    const { sink, written } = createMockStdin()
    const stdout = createMockStdout()

    const handler = new CodexProtocolHandler(sink, stdout.stream, 5000)

    // Manually set threadId by sending a request and responding
    const threadPromise = handler.startThread({})
    await tick()
    const req = JSON.parse(written[0]!)
    stdout.push(JSON.stringify({ id: req.id, result: { thread: { id: 'thread-msg' } } }))
    await threadPromise

    // Now send a user message
    handler.sendUserMessage('follow up question')
    await tick()

    // Should have sent a turn/start request
    const turnReq = written.find((w) => {
      try {
        const p = JSON.parse(w)
        return p.method === 'turn/start' && p.params.input?.[0]?.text === 'follow up question'
      } catch {
        return false
      }
    })
    expect(turnReq).toBeTruthy()

    // Respond to the fire-and-forget turn/start so close() doesn't reject a pending request
    const turnReqParsed = JSON.parse(turnReq!)
    stdout.push(JSON.stringify({ id: turnReqParsed.id, result: { turn: { id: 'turn-follow' } } }))
    await tick()

    handler.close()
    stdout.close()
  })
})
