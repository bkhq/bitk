# Data Flow

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                             │
│                                                             │
│  React Components                                           │
│       │                                                     │
│       ├── React Query hooks ──── kanban-api.ts ──► HTTP ────┼──► Backend API
│       ├── Zustand stores (UI state)                         │
│       └── EventBus (SSE) ◄──────────────────────────────────┼──◄ SSE /api/events
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                        Backend                              │
│                                                             │
│  Hono Routes ── Zod Validation ── Engine Orchestration      │
│       │                              │                      │
│       ├── Drizzle ORM ──► SQLite     ├── ProcessManager     │
│       ├── In-Memory Cache            ├── SSE Emitter        │
│       └── Event Emitters             └── Subprocess (CLI)   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Frontend → Backend HTTP

### Request Path

```
Component ─► React Query hook ─► kanbanApi.xxx() ─► fetch() ─► Hono Route
                                                                   │
                                                          Zod Validator
                                                                   │
                                                          Route Handler
                                                                   │
                                                          Drizzle ORM ─► SQLite
```

### Response Path

```
Route Handler
     │
     ▼
{ success: true, data: T }  ──► kanbanApi ──► React Query cache ──► Component re-render
{ success: false, error }
```

### API Client

- **File**: `frontend/src/lib/kanban-api.ts`
- Core: `request<T>()` wraps fetch, unwraps envelope, throws on error
- Methods: `get()`, `post()`, `patch()`, `del()`, `postFormData()`

### Endpoints

| Method | Path | API Client | React Query Hook |
|--------|------|-----------|-----------------|
| GET | `/api/projects` | `getProjects()` | `useProjects()` |
| POST | `/api/projects` | `createProject()` | `useCreateProject()` |
| GET | `/api/projects/:id` | `getProject()` | `useProject()` |
| PATCH | `/api/projects/:id` | `updateProject()` | `useUpdateProject()` |
| GET | `/api/projects/:pid/issues` | `getIssues()` | `useIssues()` |
| POST | `/api/projects/:pid/issues` | `createIssue()` | `useCreateIssue()` |
| GET | `/api/projects/:pid/issues/:id` | `getIssue()` | `useIssue()` |
| PATCH | `/api/projects/:pid/issues/:id` | `updateIssue()` | `useUpdateIssue()` |
| PATCH | `/api/projects/:pid/issues/bulk` | `bulkUpdateIssues()` | `useBulkUpdateIssues()` |
| DELETE | `/api/projects/:pid/issues/:id` | `deleteIssue()` | `useDeleteIssue()` |
| POST | `/api/projects/:pid/issues/:id/execute` | `executeIssue()` | `useExecuteIssue()` |
| POST | `/api/projects/:pid/issues/:id/follow-up` | `followUpIssue()` | `useFollowUpIssue()` |
| POST | `/api/projects/:pid/issues/:id/restart` | `restartIssue()` | `useRestartIssue()` |
| POST | `/api/projects/:pid/issues/:id/cancel` | `cancelIssue()` | `useCancelIssue()` |
| GET | `/api/projects/:pid/issues/:id/logs` | `getIssueLogs()` | `useIssueStream()` |
| GET | `/api/projects/:pid/issues/:id/changes` | `getIssueChanges()` | `useIssueChanges()` |
| GET | `/api/projects/:pid/issues/:id/changes/file` | `getIssueFilePatch()` | `useIssueFilePatch()` |
| GET | `/api/projects/:pid/issues/:id/slash-commands` | `getSlashCommands()` | `useSlashCommands()` |
| POST | `/api/projects/:pid/issues/:id/auto-title` | `autoTitleIssue()` | `useAutoTitleIssue()` |
| GET | `/api/engines/available` | `getEngineAvailability()` | `useEngineAvailability()` |
| GET | `/api/engines/profiles` | `getEngineProfiles()` | `useEngineProfiles()` |
| GET | `/api/engines/settings` | `getEngineSettings()` | `useEngineSettings()` |
| PATCH | `/api/engines/:type/settings` | `updateEngineModelSetting()` | `useUpdateEngineModelSetting()` |
| POST | `/api/engines/default-engine` | `updateDefaultEngine()` | `useUpdateDefaultEngine()` |
| POST | `/api/engines/probe` | `probeEngines()` | `useProbeEngines()` |
| GET | `/api/settings/workspace-path` | `getWorkspacePath()` | `useWorkspacePath()` |
| PATCH | `/api/settings/workspace-path` | `updateWorkspacePath()` | `useUpdateWorkspacePath()` |
| GET | `/api/settings/slash-commands` | `getSlashCommandSettings()` | `useGlobalSlashCommands()` |
| GET | `/api/events` | — (EventSource) | `useEventConnection()` |

---

## 2. Real-Time SSE

### Connection

```
Browser EventSource ──► GET /api/events ──► streamSSE (Hono)
     ▲                                          │
     │                              ┌───────────┴───────────┐
     │                              │  Subscribe callbacks  │
     │                              │  issueEngine.onLog()  │
     │                              │  issueEngine.onState() │
     │                              │  issueEngine.onSettled()│
     │                              │  onIssueUpdated()     │
     │                              │  onChangesSummary()   │
     │                              └───────────────────────┘
     │
  EventBus singleton (frontend/src/lib/event-bus.ts)
     │
     ├── subscribe(issueId, handler) ── per-issue log/state/done
     ├── onIssueUpdated(cb)          ── global issue mutation
     ├── onChangesSummary(cb)        ── global file stats
     ├── onIssueActivity(cb)         ── global activity
     └── onConnectionChange(cb)      ── connection status
```

### SSE Event Types

| Event | Payload | Source | Frontend Handler |
|-------|---------|--------|-----------------|
| `log` | `{ issueId, entry }` | `emitLog()` | `useIssueStream` → append log |
| `state` | `{ issueId, executionId, state }` | `emitStateChange()` (non-terminal) / `emitIssueSettled()` (terminal) | `useIssueStream` → update sessionStatus, invalidate React Query |
| `done` | `{ issueId, finalStatus }` | `emitIssueSettled()` | `useIssueStream` → invalidate issues list |
| `issue-updated` | `{ issueId, changes }` | `emitIssueUpdated()` | `main.tsx` → invalidate projects queries |
| `changes-summary` | `{ issueId, fileCount, additions, deletions }` | `onChangesSummary()` | `useChangesSummary` → update diff panel |
| `heartbeat` | `{ ts }` | 15s interval | Reset watchdog timer |

### Reconnection

```
First connection failed → retry every 1.5s (fixed)
After first success    → exponential backoff: 1s → 2s → 4s → ... → 30s max
Heartbeat missed (35s) → force reconnect
On reconnect           → invalidate ALL React Query caches
```

### useIssueStream Data Flow

```
                    ┌─────────────────────────┐
                    │    useIssueStream()      │
                    │                          │
  Mount ──────────► │ 1. Fetch historical logs │ ◄── kanbanApi.getIssueLogs()
                    │    from DB               │
                    │                          │
  SSE log ────────► │ 2. Append with dedup     │ ──► logs[] state
                    │    (by messageId)         │
                    │                          │
  SSE state ──────► │ 3. Track executionId     │ ──► sessionStatus state
                    │    Filter stale events   │ ──► invalidate React Query
                    │                          │
  SSE done ───────► │ 4. Invalidate queries    │ ──► React Query refetch
                    └─────────────────────────┘
```

---

## 3. State Management

### React Query (Server State)

- **File**: `frontend/src/hooks/use-kanban.ts`
- **Defaults**: `staleTime: 30s`, `retry: 1`
- **Special**: Engine profiles & global slash commands → `staleTime: Infinity`

```
Query Key Hierarchy:
['settings', 'workspacePath']
['engines', 'availability']
['engines', 'profiles']
['engines', 'settings']
['projects']
['projects', projectId]
['projects', projectId, 'issues']
['projects', projectId, 'issues', issueId]
['projects', projectId, 'issues', issueId, 'changes']
['projects', projectId, 'issues', issueId, 'changes', 'file', path]
['projects', projectId, 'issues', 'children', parentId]
['projects', projectId, 'issues', issueId, 'slash-commands']
```

### Zustand (UI State)

| Store | File | State | Persistence |
|-------|------|-------|-------------|
| Board | `stores/board-store.ts` | `groupedItems`, `isDragging` | — |
| Panel | `stores/panel-store.ts` | `panel`, `width`, `createDialogOpen` | — |
| View Mode | `stores/view-mode-store.ts` | `mode` (kanban/list) | `localStorage: bitk-view-mode` |

### Thinking Indicator Flow

```
issue.sessionStatus (React Query)
         │
         ▼
useSessionState() ── effectiveStatus === 'running' | 'pending'
         │
         ▼
isThinking = true/false
         │
         ▼
SessionMessages ── renders animated dots + "AI 思考中..."
```

---

## 4. Execution Lifecycle

### Full Path

```
User clicks Execute
         │
         ▼
┌─ POST /execute ─────────────────────────────────────┐
│  1. Validate prompt (Zod)                           │
│  2. ensureWorking() — move issue to working status  │
│  3. updateIssueSession({ sessionStatus: 'running' })│
│  4. cacheDel() — invalidate issue cache             │
│  5. Create worktree (optional)                      │
│  6. Capture base commit hash                        │
│  7. Spawn executor subprocess                       │
│  8. register() — track in ProcessManager            │
│  9. emitStateChange('running') ─► SSE               │
│ 10. persistUserMessage() ─► DB                      │
│ 11. monitorCompletion() — async exit watcher        │
│ 12. Return { executionId, messageId }               │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─ Subprocess Running ────────────────────────────────┐
│  stdout/stderr ─► log normalizer ─► emitLog() ─► SSE│
│  Turn completed signal ─► handleTurnCompleted()     │
│  Process exit ─► monitorCompletion() fires          │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─ Turn Completion ───────────────────────────────────┐
│  1. Check for pending follow-up inputs              │
│     ├── Yes: flush inputs to subprocess, continue   │
│     └── No: proceed to settlement                   │
│  2. Check for pending DB messages                   │
│     ├── Yes: auto-spawn follow-up, skip settle      │
│     └── No: proceed to settlement                   │
│  3. emitStateChange(finalStatus) ─► SSE             │
│  4. updateIssueSession({ sessionStatus })           │
│  5. cacheDel() — invalidate issue cache             │
│  6. autoMoveToReview()                              │
│  7. emitIssueSettled() ─► SSE (state + done)        │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─ Process Exit (completion-monitor.ts) ──────────────┐
│  exitCode === 0 && !logicalFailure                  │
│     ├── Yes: settle as 'completed'                  │
│     └── No:  settle as 'failed'                     │
│              ├── retryCount < MAX? auto-retry        │
│              └── sessionIdError? reset & retry       │
│  cancelledByUser? settle as 'cancelled'             │
└─────────────────────────────────────────────────────┘
```

### Follow-Up Message Path

```
User sends message
         │
         ▼
┌─ POST /follow-up ──────────────────────────────────┐
│  Issue in todo/done?                                │
│     └── Yes: persistPendingMessage() → queue only   │
│                                                     │
│  Issue working + turn in-flight?                    │
│     └── Yes: persistPendingMessage() → queue        │
│                                                     │
│  Issue working + idle?                              │
│     └── Yes: ensureWorking()                        │
│              collectPendingMessages()               │
│              issueEngine.followUpIssue()             │
│                  │                                  │
│                  ├── Active process exists?          │
│                  │   └── sendInputToRunningProcess() │
│                  │       emitStateChange('running')  │
│                  │                                  │
│                  └── No active process?              │
│                      └── spawnFollowUpProcess()      │
│                          emitStateChange('running')  │
└─────────────────────────────────────────────────────┘
```

### Pending Message Auto-Flush

```
Turn completes → check getPendingMessages(issueId)
     │
     ├── Messages found → concatenate prompts
     │                     followUpIssue(issueId, prompt)
     │                     markPendingMessagesDispatched()
     │                     (skip normal settlement)
     │
     └── No messages → proceed with normal settlement
```

---

## 5. Drag & Drop (Kanban Board)

```
User drags card
     │
     ▼
board-store.applyDragOver()         ◄── instant UI update (optimistic)
     │
User drops card
     │
     ▼
board-store.applyDragEnd()          ◄── compute status/order mutations
     │
     ▼
useBulkUpdateIssues.mutate()
     │
     ├── onMutate:  cancel queries, snapshot, apply optimistic update
     ├── onError:   rollback to snapshot
     └── onSettled: invalidate queries, resetDragging()
                         │
                         ▼
              board-store.syncFromServer(issues)
              (only syncs when isDragging === false)
```

---

## 6. File Upload

```
User attaches files in ChatInput
     │
     ▼
Client validation (10MB max, 10 files max, blocked extensions)
     │
     ▼
postFormData('/follow-up', FormData { prompt, files[] })
     │
     ▼
Backend: parseFollowUpBody() → extract files from FormData
     │
     ├── validateFiles() — server-side recheck
     ├── saveUploadedFile() — write to data/uploads/{ulid}{ext}
     ├── buildFileContext() — create text description for AI
     ├── insertAttachmentRecords() — save metadata to DB
     └── fullPrompt = prompt + fileContext → engine
```

---

## 7. Caching

### Backend In-Memory Cache (`app/cache.ts`)

```
cacheGetOrSet(key, ttlSeconds, fetcher)
     │
     ├── Cache hit (not expired) → return cached value
     └── Cache miss → call fetcher() → store with TTL → return

Max 500 entries, LRU eviction, 5-min periodic sweep
```

| Cache Key Pattern | TTL | Invalidated By |
|-------------------|-----|----------------|
| `issue:{projectId}:{issueId}` | 30s | `updateIssueSession()`, `autoMoveToReview()`, `ensureWorking()`, route PATCH/DELETE |
| `childCounts:{projectId}` | 30s | Issue create/delete/reparent |
| `project:lookup:{idOrAlias}` | 30s | `invalidateProjectCache()` |
| `app_setting:{key}` | — | `setAppSetting()` |
| `engineDefaultModels:all` | — | `setEngineDefaultModel()` |

### Frontend React Query Cache

- Default `staleTime: 30s` — queries refetch on window focus if stale
- Mutations invalidate related query keys on success
- SSE events trigger targeted invalidations
- SSE reconnect → invalidate ALL queries

### Frontend localStorage

| Key | Purpose |
|-----|---------|
| `i18n-lang` | Language preference (zh/en) |
| `kanban-theme` | Theme mode (light/dark/system) |
| `bitk-view-mode` | Kanban/list toggle |

---

## 8. i18n

```
App startup (main.tsx)
     │
     ▼
import './i18n' → i18next.init({
  lng: localStorage.getItem('i18n-lang') || 'zh',
  fallbackLng: 'en',
  resources: { en: en.json, zh: zh.json }
})
     │
     ▼
Components: const { t } = useTranslation()
            t('session.thinking') → "AI 思考中..." | "AI is thinking..."
     │
Language change → i18n.changeLanguage(lng)
                → localStorage.setItem('i18n-lang', lng)
```

---

## 9. Reconciliation

Background process for recovering from stuck states.

```
Server startup
     │
     ▼
startupReconciliation()
  ├── Mark all running/pending sessions as 'failed'
  └── reconcileStaleWorkingIssues()

Every 60s (periodic)
     │
     ▼
reconcileStaleWorkingIssues()
  └── For each issue with statusId='working' and no active process:
      ├── sessionStatus non-terminal? → set 'failed' + move to 'review'
      └── sessionStatus terminal?     → move to 'review'
      └── cacheDel() + emitIssueUpdated()

On every issueSettled event (1s delay)
     │
     ▼
reconcileStaleWorkingIssues()  ◄── catch edge cases missed by normal settle
```

---

## 10. Key Files Index

### Frontend

| File | Role |
|------|------|
| `frontend/src/lib/kanban-api.ts` | HTTP API client |
| `frontend/src/lib/event-bus.ts` | SSE EventBus singleton |
| `frontend/src/hooks/use-kanban.ts` | React Query hooks + query keys |
| `frontend/src/hooks/use-issue-stream.ts` | SSE log/state subscription |
| `frontend/src/hooks/use-event-connection.ts` | SSE connection status |
| `frontend/src/hooks/use-changes-summary.ts` | File changes tracking |
| `frontend/src/stores/board-store.ts` | Kanban drag-and-drop state |
| `frontend/src/stores/panel-store.ts` | Side panel state |
| `frontend/src/stores/view-mode-store.ts` | Kanban/list toggle |
| `frontend/src/i18n/index.ts` | i18next initialization |
| `frontend/src/components/issue-detail/ChatBody.ts` | Thinking indicator logic (`useSessionState`) |

### Backend

| File | Role |
|------|------|
| `app/app.ts` | Hono app, middleware, route mounting |
| `app/cache.ts` | In-memory LRU+TTL cache |
| `app/db/schema.ts` | Drizzle ORM table definitions |
| `app/engines/engine-store.ts` | Issue session DB operations |
| `app/engines/process-manager.ts` | Subprocess lifecycle management |
| `app/engines/reconciler.ts` | Stale issue recovery |
| `app/engines/issue/events.ts` | SSE event emitters |
| `app/engines/issue/orchestration/execute.ts` | Execute orchestration |
| `app/engines/issue/orchestration/follow-up.ts` | Follow-up orchestration |
| `app/engines/issue/lifecycle/turn-completion.ts` | Turn settlement |
| `app/engines/issue/lifecycle/completion-monitor.ts` | Process exit monitoring |
| `app/engines/issue/lifecycle/settle.ts` | Issue settlement |
| `app/engines/issue/lifecycle/spawn.ts` | Process spawning |
| `app/engines/issue/user-message.ts` | User message persistence + SSE |
| `app/routes/events.ts` | SSE stream endpoint |
| `app/routes/issues/command.ts` | Execute/restart/cancel routes |
| `app/routes/issues/message.ts` | Follow-up route |
| `app/routes/issues/query.ts` | Issue GET routes |
| `app/routes/issues/update.ts` | Issue PATCH routes |
| `app/routes/issues/_shared.ts` | Shared helpers, Zod schemas |
