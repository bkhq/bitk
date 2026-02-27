import { useRef } from 'react'
import { useCancelIssue, useUpdateIssue } from '@/hooks/use-kanban'
import { useIssueStream } from '@/hooks/use-issue-stream'
import { STATUS_MAP } from '@/lib/statuses'
import type { Issue, NormalizedLogEntry } from '@/types/kanban'
import { IssueDetail } from './IssueDetail'
import { ChatInput } from './ChatInput'
import { SessionMessages } from './SessionMessages'

// ---------- shared session-state helpers ----------

function hasUnfinishedSegmentIn(logs: NormalizedLogEntry[]): boolean {
  for (let i = logs.length - 1; i >= 0; i--) {
    const entry = logs[i]
    const md = entry.metadata
    if (
      md &&
      (md.turnCompleted === true ||
        'resultSubtype' in md ||
        (entry.entryType === 'system-message' && 'duration' in md))
    ) {
      return false
    }
    if (
      entry.entryType === 'user-message' ||
      entry.entryType === 'assistant-message' ||
      entry.entryType === 'tool-use' ||
      entry.entryType === 'thinking' ||
      entry.entryType === 'loading'
    ) {
      return true
    }
  }
  return false
}

function deriveWorkingStep(logs: NormalizedLogEntry[]): string | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const entry = logs[i]
    if (entry.entryType !== 'tool-use') continue
    const md = entry.metadata
    if (!md || md.isResult === true || md.toolName !== 'TodoWrite') continue
    const input = md.input as
      | { todos?: Array<Record<string, unknown>> }
      | undefined
    const todos = Array.isArray(input?.todos) ? input.todos : []
    if (todos.length === 0) continue
    const inProgress = todos.find((todo) => todo.status === 'in_progress')
    const pending = todos.find((todo) => todo.status === 'pending')
    const completed = [...todos]
      .reverse()
      .find((todo) => todo.status === 'completed')
    const current = inProgress ?? pending ?? completed ?? todos[0]
    const activeForm =
      typeof current.activeForm === 'string' ? current.activeForm : null
    const content = typeof current.content === 'string' ? current.content : null
    return activeForm ?? content ?? null
  }
  return null
}

// ---------- exported hook (for title bars that need isThinking) ----------

export function useSessionState(
  projectId: string,
  issueId: string | null,
  issue: Issue | null | undefined,
) {
  const hasSession = !!issue?.sessionStatus
  const isTodo = issue?.statusId === 'todo'
  const isDone = issue?.statusId === 'done'
  const streamEnabled = hasSession || isTodo || isDone

  const { logs, appendServerMessage } = useIssueStream({
    projectId,
    issueId: streamEnabled ? issueId : null,
    sessionStatus: issue?.sessionStatus ?? null,
    enabled: !!(issueId && streamEnabled),
  })

  const effectiveStatus = issue?.sessionStatus ?? null
  const isSessionActive =
    effectiveStatus === 'running' || effectiveStatus === 'pending'

  const isThinking = isSessionActive
    ? logs.length === 0
      ? true
      : hasUnfinishedSegmentIn(logs)
    : false

  const workingStep = deriveWorkingStep(logs)

  return {
    logs,
    isThinking,
    workingStep,
    isTodo,
    isDone,
    appendServerMessage,
  }
}

// ---------- ChatBody component ----------

export function ChatBody({
  projectId,
  issueId,
  issue,
  showDiff,
  onToggleDiff,
  scrollRef: externalScrollRef,
}: {
  projectId: string
  issueId: string
  issue: Issue
  showDiff: boolean
  onToggleDiff: () => void
  scrollRef?: React.RefObject<HTMLDivElement | null>
}) {
  const internalScrollRef = useRef<HTMLDivElement>(null)
  const scrollRef = externalScrollRef ?? internalScrollRef

  const updateIssue = useUpdateIssue(projectId)
  const cancelIssue = useCancelIssue(projectId)

  const { logs, isThinking, workingStep, isTodo, isDone, appendServerMessage } =
    useSessionState(projectId, issueId, issue)

  return (
    <>
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex flex-col min-h-full justify-end py-2">
          <SessionMessages
            logs={logs}
            scrollRef={scrollRef}
            isRunning={isThinking}
            workingStep={workingStep}
            onCancel={() => cancelIssue.mutate(issueId)}
            isCancelling={cancelIssue.isPending}
            devMode={issue.devMode}
          />
        </div>
      </div>

      {/* Issue metadata bar — fixed above input */}
      <IssueDetail
        issue={issue}
        status={STATUS_MAP.get(issue.statusId)}
        onUpdate={(fields) => updateIssue.mutate({ id: issueId, ...fields })}
      />

      {/* Input */}
      <ChatInput
        projectId={projectId}
        issueId={issueId}
        diffOpen={showDiff}
        onToggleDiff={onToggleDiff}
        scrollRef={scrollRef}
        engineType={issue.engineType ?? undefined}
        model={issue.model ?? undefined}
        sessionStatus={issue.sessionStatus}
        statusId={issue.statusId}
        isThinking={isThinking}
        onMessageSent={(messageId, prompt, metadata) => {
          appendServerMessage(messageId, prompt, metadata)
        }}
      />
    </>
  )
}
