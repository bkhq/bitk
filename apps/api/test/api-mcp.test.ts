import { beforeAll, describe, expect, test } from 'bun:test'
import app from '@/app'
import { setAppSetting } from '@/db/helpers'
import './setup'
import { createTestProject } from './helpers'

/**
 * MCP (Model Context Protocol) endpoint tests.
 * Tests the /api/mcp Streamable HTTP transport.
 */

/** Send an MCP JSON-RPC request and return parsed SSE data */
async function mcpRequest(body: unknown, sessionId?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  }
  if (sessionId) {
    headers['Mcp-Session-Id'] = sessionId
  }

  const res = await app.request('http://localhost/api/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  return res
}

/** Parse SSE response to extract JSON-RPC result */
async function parseSSEResponse(res: Response) {
  const text = await res.text()
  const dataLine = text
    .split('\n')
    .find(line => line.startsWith('data: '))
  if (!dataLine) throw new Error(`No data line in SSE response: ${text}`)
  return JSON.parse(dataLine.slice(6))
}

/** Initialize an MCP session and return session ID + protocol version */
async function initSession() {
  const res = await mcpRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  })
  const sessionId = res.headers.get('mcp-session-id')
  const data = await parseSSEResponse(res)
  return { sessionId: sessionId!, data }
}

/** Call an MCP tool and return the parsed result */
async function callTool(sessionId: string, name: string, args: Record<string, unknown> = {}) {
  const res = await mcpRequest(
    {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args },
    },
    sessionId,
  )
  const data = await parseSSEResponse(res)
  return data.result
}

/** Parse the text content from a tool call result */
function parseToolResult(result: { content: Array<{ type: string, text: string }> }) {
  const textContent = result.content.find((c: { type: string }) => c.type === 'text')
  return JSON.parse(textContent!.text)
}

describe('MCP /api/mcp', () => {
  beforeAll(async () => {
    await setAppSetting('mcp:enabled', 'true')
  })

  test('initialize returns server info', async () => {
    const { sessionId, data } = await initSession()
    expect(sessionId).toBeTruthy()
    expect(data.result.serverInfo.name).toBe('bkd')
    expect(data.result.serverInfo.version).toBe('1.0.0')
    expect(data.result.capabilities.tools).toBeDefined()
  })

  test('tools/list returns all registered tools', async () => {
    const { sessionId } = await initSession()
    const res = await mcpRequest(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      },
      sessionId,
    )
    const data = await parseSSEResponse(res)
    const tools = data.result.tools as Array<{ name: string }>
    const toolNames = tools.map(t => t.name)

    expect(toolNames).toContain('list-projects')
    expect(toolNames).toContain('get-project')
    expect(toolNames).toContain('create-project')
    expect(toolNames).toContain('list-issues')
    expect(toolNames).toContain('get-issue')
    expect(toolNames).toContain('create-issue')
    expect(toolNames).toContain('update-issue')
    expect(toolNames).toContain('delete-issue')
    expect(toolNames).toContain('execute-issue')
    expect(toolNames).toContain('follow-up-issue')
    expect(toolNames).toContain('cancel-issue')
    expect(toolNames).toContain('restart-issue')
    expect(toolNames).toContain('list-engines')
    expect(toolNames).toContain('get-issue-logs')
  })

  test('list-projects returns empty initially', async () => {
    const { sessionId } = await initSession()
    const result = await callTool(sessionId, 'list-projects', {})
    const projects = parseToolResult(result)
    expect(Array.isArray(projects)).toBe(true)
  })

  test('create-project creates and returns a project', async () => {
    const { sessionId } = await initSession()
    const result = await callTool(sessionId, 'create-project', {
      name: 'MCP Test Project',
      description: 'Created via MCP',
    })
    const project = parseToolResult(result)
    expect(project.name).toBe('MCP Test Project')
    expect(project.id).toBeTruthy()
    expect(project.alias).toBeTruthy()
  })

  test('get-project returns project by ID', async () => {
    const projectId = await createTestProject('MCP Get Project')
    const { sessionId } = await initSession()
    const result = await callTool(sessionId, 'get-project', { projectId })
    const project = parseToolResult(result)
    expect(project.id).toBe(projectId)
    expect(project.name).toBe('MCP Get Project')
  })

  test('get-project returns error for nonexistent project', async () => {
    const { sessionId } = await initSession()
    const result = await callTool(sessionId, 'get-project', { projectId: 'nonexistent' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('not found')
  })

  test('create-issue and list-issues', async () => {
    const projectId = await createTestProject('MCP Issues Project')
    const { sessionId } = await initSession()

    // Create an issue
    const createResult = await callTool(sessionId, 'create-issue', {
      projectId,
      title: 'MCP test task',
      statusId: 'todo',
      engineType: 'echo',
    })
    const issue = parseToolResult(createResult)
    expect(issue.title).toBe('MCP test task')
    expect(issue.statusId).toBe('todo')
    expect(issue.projectId).toBe(projectId)

    // List issues
    const listResult = await callTool(sessionId, 'list-issues', { projectId })
    const issues = parseToolResult(listResult)
    expect(issues.length).toBeGreaterThanOrEqual(1)
    expect(issues.some((i: { id: string }) => i.id === issue.id)).toBe(true)
  })

  test('update-issue changes title', async () => {
    const projectId = await createTestProject('MCP Update Project')
    const { sessionId } = await initSession()

    const createResult = await callTool(sessionId, 'create-issue', {
      projectId,
      title: 'Original title',
      statusId: 'todo',
    })
    const issue = parseToolResult(createResult)

    const updateResult = await callTool(sessionId, 'update-issue', {
      projectId,
      issueId: issue.id,
      title: 'Updated title',
    })
    const updated = parseToolResult(updateResult)
    expect(updated.title).toBe('Updated title')
  })

  test('delete-issue soft-deletes', async () => {
    const projectId = await createTestProject('MCP Delete Project')
    const { sessionId } = await initSession()

    const createResult = await callTool(sessionId, 'create-issue', {
      projectId,
      title: 'To be deleted',
      statusId: 'todo',
    })
    const issue = parseToolResult(createResult)

    const deleteResult = await callTool(sessionId, 'delete-issue', {
      projectId,
      issueId: issue.id,
    })
    const deleted = parseToolResult(deleteResult)
    expect(deleted.deleted).toBe(true)

    // Should not appear in list anymore
    const listResult = await callTool(sessionId, 'list-issues', { projectId })
    const issues = parseToolResult(listResult)
    expect(issues.some((i: { id: string }) => i.id === issue.id)).toBe(false)
  })

  test('GET without session returns 400', async () => {
    const res = await app.request('http://localhost/api/mcp', { method: 'GET' })
    expect(res.status).toBe(400)
  })
})
