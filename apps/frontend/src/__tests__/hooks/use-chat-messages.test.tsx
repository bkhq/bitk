import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { NormalizedLogEntry } from '@/types/kanban'
import { useChatMessages } from '@/hooks/use-chat-messages'

describe('useChatMessages', () => {
  it('maps ACP plan system messages into task-plan messages', () => {
    const logs: NormalizedLogEntry[] = [{
      entryType: 'system-message',
      content: 'pending: Inspect repo\nin_progress: Implement ACP',
      timestamp: '2026-03-13T00:00:00.000Z',
      metadata: {
        subtype: 'plan',
        entries: [
          { content: 'Inspect repo', status: 'pending' },
          { content: 'Implement ACP', status: 'in_progress' },
        ],
      },
    }]

    const { result } = renderHook(() => useChatMessages(logs))

    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0]).toMatchObject({
      type: 'task-plan',
      completedCount: 0,
      todos: [
        { content: 'Inspect repo', status: 'pending' },
        { content: 'Implement ACP', status: 'in_progress' },
      ],
    })
  })
})
