import { describe, expect, test } from 'bun:test'
import { expectSuccess, get } from './helpers'
import './setup'

describe('GET /api/processes/capacity', () => {
  test('returns active summary and available execution slots', async () => {
    const result = await get<{
      summary: {
        totalActive: number
        byState: Record<string, number>
        byEngine: Record<string, number>
        byProject: Record<string, { projectName: string, count: number }>
      }
      maxConcurrent: number
      availableSlots: number | null
      canStartNewExecution: boolean
    }>('/api/processes/capacity')

    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(typeof data.summary.totalActive).toBe('number')
    expect(data.summary.totalActive).toBe(0)
    expect(typeof data.maxConcurrent).toBe('number')
    expect(data.maxConcurrent).toBeGreaterThanOrEqual(1)
    expect(data.availableSlots).toBe(data.maxConcurrent)
    expect(data.canStartNewExecution).toBe(true)
    expect(data.summary.byState).toEqual({})
    expect(data.summary.byEngine).toEqual({})
    expect(data.summary.byProject).toEqual({})
  })
})
