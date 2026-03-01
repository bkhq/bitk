/**
 * Test helpers — utility functions for API tests.
 * DB_PATH is set by preload.ts before this module loads.
 */
import app from '@/app'

type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

/** Make a typed request to the Hono app */
export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: ApiResult<T> }> {
  const url = `http://localhost${path}`
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }

  const res = await app.request(url, init)
  const json = (await res.json()) as ApiResult<T>
  return { status: res.status, json }
}

export function get<T>(path: string) {
  return api<T>('GET', path)
}

export function post<T>(path: string, body: unknown) {
  return api<T>('POST', path, body)
}

export function patch<T>(path: string, body: unknown) {
  return api<T>('PATCH', path, body)
}

/** Expect success response */
export function expectSuccess<T>(result: {
  status: number
  json: ApiResult<T>
}): T {
  if (!result.json.success) {
    throw new Error(
      `Expected success but got error: ${result.json.error} (status ${result.status})`,
    )
  }
  return result.json.data
}

/** Expect error response */
export function expectError(
  result: { status: number; json: ApiResult<unknown> },
  expectedStatus?: number,
) {
  if (result.json.success) {
    throw new Error(`Expected error but got success (status ${result.status})`)
  }
  if (expectedStatus !== undefined && result.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus} but got ${result.status}`,
    )
  }
  return result.json.error
}

/** Create a test project and return its ID */
export async function createTestProject(
  name = 'Test Project',
): Promise<string> {
  const result = await post<{ id: string }>('/api/projects', { name })
  const data = expectSuccess(result)
  return data.id
}

/** Create a test issue and return the full response */
export async function createTestIssue(
  projectId: string,
  opts: {
    title?: string
    statusId?: string
    engineType?: string
    model?: string
    description?: string
    priority?: string
  } = {},
) {
  const result = await post<Record<string, unknown>>(
    `/api/projects/${projectId}/issues`,
    {
      title: opts.title ?? 'Test Issue',
      statusId: opts.statusId ?? 'todo',
      engineType: opts.engineType ?? 'echo',
      model: opts.model ?? 'auto',
      description: opts.description,
      priority: opts.priority,
    },
  )
  return result
}

/** Wait for a condition to become true, polling at interval */
export async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 100,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return
    await Bun.sleep(intervalMs)
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`)
}
