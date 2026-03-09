# PLAN-007 Fix tool group grouping + visibility + collapsible UI

- **task**: UI-001
- **status**: completed
- **owner**: —

## Context

### Data analysis (from 2 real session JSONLs)

**Session 1** (bca07ec6): 2653 lines, 211 tool_use, 88 text, 15 thinking.
**Session 2** (1e28cac6): 6497 lines, 992 tool_use, 414 text, 63 thinking.

Combined tool distribution: Bash(488), Read(301), Edit(183), Grep(115), TodoWrite(39), Write(28), Agent(15), Glob(18), ToolSearch(9), Skill(4).

**Actual message flow pattern** (from Claude Code stream-json protocol):

```
USER message
  THINK → TEXT → [TOOL TOOL TOOL ... RESULT RESULT RESULT ...] → TEXT → [TOOL ...] → ...
```

- Tool calls come in **batches** within a single assistant turn (e.g., 6 consecutive Glob, 4 Bash, 8 Edit)
- `text` blocks (assistant messages) naturally separate tool groups
- `thinking` blocks appear before tool batches — should become group descriptions
- `system` events with `subtype: 'task_progress'` appear between tool calls but carry **no useful content** (content = the subtype name itself "task_progress")

### System subtypes coverage

| Subtype | Count | Normalizer | Frontend | Status |
|---------|-------|-----------|----------|--------|
| `init` | many | handled (line 86) | skipped in LogEntry | OK |
| `compact_boundary` | 6 | handled (line 101) | rendered as divider | OK |
| `task_started` | — | suppressed (line 112) | — | OK |
| `status` | — | handled (line 114) | inline text | OK |
| `hook_response` | — | handled (line 124) | skipped in LogEntry | OK |
| `task_progress` | many | **BUG**: default → content="task_progress" | **BUG**: flushes tool buffer | Fix in Step 2+3 |
| `stop_hook_summary` | 49 | **BUG**: default → content="stop_hook_summary" | renders as raw text | Fix in Step 2 |
| `command_output` | — | handled in parseUser | collapsible in LogEntry | OK |

### Tool group separator analysis (session 2)

What separates consecutive tool batches in the real data:
- `text` (414) — assistant text messages, natural separators ✅
- `thinking` (63) — absorbed as tool group description ✅
- `USER` (51) — real user messages, natural separators ✅
- `stop_hook_summary` (34) — **renders as raw text** (doesn't break groups, but visible noise)
- `USER_INJECT` (6) — skill/hook injected text (synthetic user messages)
- `compact_boundary` (5) — rendered as divider ✅

### TodoWrite pattern (from real data)

TodoWrite appears 8 times, always **mixed within tool batches**:

```
Pattern A: [tools...] → TodoWrite → text → [tools...]     (most common)
Pattern B: [tools...] → TodoWrite → TodoWrite → [tools...] (consecutive updates)
Pattern C: TodoWrite → [tools...]                          (batch start)
```

Key: only the **last** TodoWrite in a buffer matters (contains full current plan state). The existing `flushToolBuffer` correctly separates TodoWrite from non-todo items.

### Root causes

1. **Visibility filter too aggressive (BUG-004 regression)**: `isVisibleForMode()` in non-dev mode only allows `user-message` and `assistant-message`. This blocks **all** tool-use (including TodoWrite), thinking, system-message, and error-message from both HTTP API and SSE. The CHAT-001 redesign built UI for tool groups, task plans, thinking — but BUG-004 made them invisible.

   Pipeline:
   - `visibility.ts:16` — `return entry.entryType === 'user-message' || entry.entryType === 'assistant-message'`
   - `queries.ts:87` — SQL `VISIBLE_ENTRIES_CONDITION` = same restriction
   - `events.ts:46` — SSE filter uses same `isVisibleForMode()`

2. **Broken grouping**: `task_progress` handler in `use-chat-messages.ts` calls `flushToolBuffer()`, splitting every batch into 1-item groups

3. **Raw text rendering**: normalizer `parseSystem()` default case sets `content = data.subtype` when no message/content exists, producing literal text for subtypes without content. Affects: `task_progress` (renders "task_progress") and `stop_hook_summary` (renders "stop_hook_summary", 49 occurrences across 2 sessions)

4. **No collapse**: `ToolGroupMessage` always shows all items with no toggle

### Affected files

- `apps/api/src/engines/issue/utils/visibility.ts` — visibility filter
- `apps/api/src/engines/issue/persistence/queries.ts` — SQL + JS filters
- `apps/api/src/engines/executors/claude/normalizer.ts` — `parseSystem` default case
- `apps/frontend/src/hooks/use-chat-messages.ts` — `rebuildMessages()` grouping logic
- `apps/frontend/src/components/issue-detail/ToolItems.tsx` — `ToolGroupMessage` component

## Plan

### Step 1: Fix visibility filter — allow all entry types in non-dev mode

**File**: `apps/api/src/engines/issue/utils/visibility.ts`

The BUG-004 restriction was too broad. The CHAT-001 redesign requires tool-use, thinking, system-message, and error-message to be visible. The original BUG-004 intent was to hide internal noise (meta-turns, hook responses, init messages) — that filtering already happens in the frontend `rebuildMessages` (skips token-usage, loading, init, hook_response, hook_started, hook_completed, source=result, etc.).

Change `isVisibleForMode` to allow all entry types, keeping only the meta-turn filter:

```typescript
export function isVisibleForMode(entry: NormalizedLogEntry, devMode: boolean): boolean {
  if (devMode) return true
  // Meta-turn entries (auto-title etc.) are always hidden
  if (entry.metadata?.type === 'system') return false
  // Allow all entry types — frontend rebuildMessages handles display filtering
  return true
}
```

**File**: `apps/api/src/engines/issue/persistence/queries.ts`

Remove the SQL `VISIBLE_ENTRIES_CONDITION` filter for non-dev mode (line 87), since the JS-level `isVisibleForMode` at line 157 now allows all non-meta-turn entries. Remove or update the dead `VISIBLE_ENTRIES_CONDITION` constant.

### Step 2: Fix normalizer — suppress content-less system subtypes

**File**: `apps/api/src/engines/executors/claude/normalizer.ts`

In `parseSystem()` switch (line 85), add explicit cases for subtypes that have no user-facing content:

```typescript
case 'task_progress':
case 'stop_hook_summary':
  // Internal signals with no user-facing content — suppress
  return null
```

Both subtypes carry metadata (hook info, progress state) but no `message`/`content` field. The default case falls through to `content = data.subtype`, producing raw subtype names as visible text.

### Step 3: Fix grouping — don't flush tool buffer for task_progress

**File**: `apps/frontend/src/hooks/use-chat-messages.ts`

Change the `task_progress` handler (line 220-229) to simply `continue` (skip) instead of flushing the tool buffer. Safety net for historical data that still has these entries in DB:

```typescript
if (entry.entryType === 'system-message' && entry.metadata?.subtype === 'task_progress') {
  continue
}
```

**Effect on TodoWrite**: with task_progress no longer breaking the buffer, consecutive tool calls + TodoWrite calls stay in the same buffer. The existing `flushToolBuffer` logic correctly extracts TodoWrite items into `TaskPlanMessage` and keeps non-todo items as `ToolGroupMessage`.

### Step 4: Make ToolGroupMessage collapsible

**File**: `apps/frontend/src/components/issue-detail/ToolItems.tsx`

Wrap `ToolGroupMessage` items in `<details open>`:
- Header becomes `<summary>` with chevron indicator
- Default: **open** (user clicks to collapse)

## Verification

1. `bun run build` — no type errors
2. `bun run test:frontend` — all tests pass
3. `bun run test:api` — backend tests pass (visibility change may affect test expectations)
4. `bun run lint` — no new lint errors
5. Manual: non-dev mode issues should show tool groups, task plans, thinking, and errors

## Risks

- **Step 1 is a behavior change**: non-dev mode will now show tool-use, thinking, system-message, error-message entries that were previously hidden. This is intentional — the CHAT-001 redesign built UI for all these types. The frontend `rebuildMessages` already filters display noise (token-usage, loading, init, hook_response, etc.)
- Backend tests may need updating if they assert on non-dev mode entry counts
- Steps 2-4 are safe, minimal changes
