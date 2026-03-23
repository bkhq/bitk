# Frontend Code Quality Audit

**Date:** 2026-03-23
**Scope:** `apps/frontend/src/` — React/Vite frontend
**Mode:** READ-ONLY (no code modifications)

---

## Executive Summary

**Overall Quality Rating: B- (Good foundation, notable gaps)**

The frontend codebase demonstrates solid TypeScript practices, excellent i18n coverage, proper code splitting, and good use of shared types from `@bkd/shared`. However, several areas need attention: monolithic components (3 files exceed 800 lines), accessibility gaps (WCAG violations in ARIA, keyboard navigation, focus management), performance concerns (unvirtualized log lists, missing memoization), and state management inconsistencies (staleTime strategy, window listener leaks, broad query invalidations).

**Findings Summary:**

| Severity | Count |
|----------|-------|
| CRITICAL | 7 |
| HIGH | 18 |
| MEDIUM | 24 |
| LOW | 7 |
| **Total** | **56** |

---

## 1. React Patterns

### 1.1 Component Size and Complexity

| # | Severity | File | Lines | Description |
|---|----------|------|-------|-------------|
| R-01 | CRITICAL | `components/AppSettingsDialog.tsx` | 1619 | Contains 9 complete settings sections (General, Models, Logs, Cleanup, RecycleBin, MCP, Webhooks, Upgrade, About) with independent logic, 30+ hooks. Each section 100-200 lines with its own API calls. **Suggestion:** Extract into `components/settings/GeneralSection.tsx`, `ModelsSection.tsx`, etc. Lazy load each section. |
| R-02 | CRITICAL | `components/issue-detail/ChatInput.tsx` | 990 | Handles file uploads, command parsing, model selection, permission modes, textarea resizing, attachment preview, message sending, slash commands, keyboard shortcuts — 11+ useState calls. **Suggestion:** Extract `FileUploadZone.tsx`, `AttachmentPreview.tsx`, `CommandMenu.tsx`; create `useCommandFiltering()` and `useInputTextarea()` hooks. |
| R-03 | HIGH | `hooks/use-kanban.ts` | 975 | 70+ query/mutation hooks, 40+ query keys mixing projects, issues, engines, settings, webhooks, cron concerns. **Suggestion:** Split into `use-project-queries.ts`, `use-issue-queries.ts`, `use-engine-queries.ts`, `use-settings-queries.ts`, `use-webhook-queries.ts`, `use-cron-queries.ts`. |
| R-04 | HIGH | `components/notes/NotesDrawer.tsx` | 704 | 4 sub-components inline (NotesDrawer, NoteListItem, NoteEditor, MobileNoteEditor) plus width resize logic. **Suggestion:** Extract each component to its own file; create `useNotesDrawerResize()` hook. |
| R-05 | HIGH | `components/issue-detail/ToolItems.tsx` | 609 | Renders tool groups, handles collapsing, streaming updates, result expansion — all in one component. **Suggestion:** Extract `ToolGroup.tsx`, `ToolStreamingView.tsx`, `ToolResult.tsx`. |

### 1.2 Hook Usage Issues

| # | Severity | File:Line | Description |
|---|----------|-----------|-------------|
| R-06 | HIGH | `hooks/use-issue-stream.ts:58-77` | `mergeLogsPreferLive()` redefined every render inside `useMemo`. Expensive merge of 500-entry arrays. **Suggestion:** Extract function outside component or wrap in `useCallback`. |
| R-07 | HIGH | `components/issue-detail/ChatBody.tsx:229-242` | Scroll `useEffect` includes `logs.length` in dependency array but handler doesn't reference it — implicit coupling creates stale closure risk. **Suggestion:** Remove `logs.length` from deps unless handler uses it. |
| R-08 | HIGH | `components/issue-detail/ChatInput.tsx:240-244` | Uses `prevFilteredRef` to manually track previous `filteredCommands` and sets state during render (side-effect in render). Double-executes in Strict Mode. **Suggestion:** Replace with `useEffect(() => setCommandIndex(0), [filteredCommands])`. |

### 1.3 Key Prop Issues

| # | Severity | File:Line | Description |
|---|----------|-----------|-------------|
| R-09 | HIGH | `components/issue-detail/SessionMessages.tsx:100-125` | `key={idx}` for todo items that reorder/complete. Causes animation jank, stale icon state. **Suggestion:** Use `key={item.content + ':' + item.status}` or item ID. |
| R-10 | HIGH | `components/AppSettingsDialog.tsx:586-588` | `key={i}` for filtered/searchable log lines. When filter changes, wrong components reused. **Suggestion:** Use timestamp-based key. |
| R-11 | MEDIUM | `components/AppSettingsDialog.tsx:595-614` | `key={'h' + i}` for highlight text marks. Minor (marks stateless) but inconsistent. |

### 1.4 Memoization & Re-render Issues

| # | Severity | File:Line | Description |
|---|----------|-----------|-------------|
| R-12 | MEDIUM | `components/issue-detail/ChatBody.tsx` | 371-line component with 11+ props, not wrapped in `React.memo()`. Re-renders on every SSE log, scroll event, and parent state change. Cascades to ChatInput and SessionMessages. |
| R-13 | MEDIUM | `components/issue-detail/ChatInput.tsx` | 990-line component, no `React.memo()`. Every keystroke triggers full re-render of all input UI. |
| R-14 | MEDIUM | `components/issue-detail/IssueListPanel.tsx:166` | Inline arrow `onNavigate={issueId => navigate(...)}` creates new function every render, bypassing `IssueRow` memoization. **Suggestion:** Extract to `useCallback`. |
| R-15 | MEDIUM | `components/issue-detail/ReviewListPanel.tsx:127` | Same inline arrow pattern, breaks `ReviewIssueRow` memoization. |

### 1.5 Prop Drilling

| # | Severity | File | Description |
|---|----------|------|-------------|
| R-16 | MEDIUM | `components/issue-detail/ChatBody.tsx` | Receives `projectId, issueId, issue, showDiff, onToggleDiff, scrollRef, onAfterDelete` and passes most directly to children without transformation. **Suggestion:** Create `ChatContext` to reduce drilling. |
| R-17 | MEDIUM | `components/issue-detail/SessionMessages.tsx:136-180` | 10+ props spread directly to `LegacySessionMessages` without filtering. |
| R-18 | MEDIUM | `components/issue-detail/IssueListPanel.tsx:157-168` | 3-level callback drilling (IssueListPanel → StatusGroup → IssueRow). |

---

## 2. State Management

### 2.1 TanStack Query

| # | Severity | File:Line | Description |
|---|----------|-----------|-------------|
| S-01 | HIGH | `hooks/use-kanban.ts` (multiple) | Inconsistent `staleTime` with no documented strategy: `Infinity` (slash commands), `60_000` (slash commands duplicate), `30_000` (engine settings), `5_000` (download status), default `0` (most queries). **Suggestion:** Document and standardize — config data: `Infinity`, frequent data: `30_000`, polling: `5_000`. |
| S-02 | MEDIUM | `hooks/use-kanban.ts:81,103-106,233,246,266,294,305,315` | Overly broad query invalidations. Updating a single issue invalidates all projects. **Suggestion:** Use exact matching and invalidate only affected project's issues. |
| S-03 | MEDIUM | `hooks/use-kanban.ts:856-862` | `useAllProcesses()` polls every 5s unconditionally, even when no processes exist. **Suggestion:** Use dynamic `refetchInterval` based on whether processes exist. |
| S-04 | MEDIUM | `lib/kanban-api.ts:554-558` + `stores/notes-store.ts` | Notes API exists but no React Query hooks. Data fetched manually without cache, dedup, or loading/error states. **Suggestion:** Add `useNotes()`, `useCreateNote()`, etc. hooks. |

### 2.2 Zustand Stores

| # | Severity | File | Description |
|---|----------|------|-------------|
| S-05 | HIGH | All 5 drawer stores (`terminal-store`, `file-browser-store`, `panel-store`, `process-manager-store`, `notes-store`) | Window resize listeners attached via global flag, **never removed**. Listeners accumulate on HMR. **Suggestion:** Use proper cleanup with stored handler reference. |
| S-06 | HIGH | Same 5 stores | Components using stores without selectors (e.g., `const { groupedItems, syncFromServer } = useBoardStore()`) cause full re-render when any field changes, even if only `isOpen` is needed. **Suggestion:** Add per-field selector exports: `useTerminalOpen = () => useTerminalStore(s => s.isOpen)`. |

### 2.3 Real-Time Data (SSE/EventBus)

| # | Severity | File:Line | Description |
|---|----------|-----------|-------------|
| S-07 | MEDIUM | `lib/event-bus.ts:129-135,145-150,252-256` | Listener errors silently swallowed with empty `catch {}`. No logging even in development. **Suggestion:** Add `console.warn` in development. |
| S-08 | MEDIUM | `lib/event-bus.ts:162-179` | Dual retry strategy (fast fixed vs exponential backoff) logic is confusing. `hasConnectedOnce` checked twice with different side effects. **Suggestion:** Extract to named `getRetryDelay()` method. |
| S-09 | MEDIUM | `hooks/use-changes-summary.ts:35-39,50-59` | Race condition: if query re-fetches identical data, `dataUpdatedAt` doesn't update, keeping stale SSE overlay permanently. **Suggestion:** Clear SSE overlay on successful query completion or after timeout. |

### 2.4 API Client

| # | Severity | File:Line | Description |
|---|----------|-----------|-------------|
| S-10 | MEDIUM | `lib/kanban-api.ts:73-90` | All API errors thrown as generic `Error`. Components can't distinguish validation errors (show to user) from server errors (show generic message) from network errors (suggest retry). **Suggestion:** Create `ApiError` class with `statusCode` and `isUserError` fields. |
| S-11 | MEDIUM | `lib/kanban-api.ts:108-127` | `postFormData` duplicates error handling from `request()`. If one is updated, the other must be updated separately. **Suggestion:** Consolidate into shared error handling. |

---

## 3. TypeScript Quality

### 3.1 Type Safety

| # | Severity | File:Line | Description |
|---|----------|-----------|-------------|
| T-01 | HIGH | 5 stores: `terminal-store.ts:58`, `file-browser-store.ts:196`, `panel-store.ts:69`, `process-manager-store.ts:57`, `notes-store.ts:62` | Double-cast `(window as unknown as Record<string, unknown>)` bypasses type safety for hydration keys. **Suggestion:** Create type-safe `getWindowKey<T>(key)` utility. |
| T-02 | MEDIUM | `lib/event-bus.ts:15,127` | Issue-updated listener uses untyped `Record<string, unknown>` payload. No IDE autocomplete. **Suggestion:** Define `IssueChanges` interface. |
| T-03 | MEDIUM | `hooks/use-issue-stream.ts:226` | `(metadata.attachments as unknown[]).length > 0` — casting instead of properly typing metadata. |
| T-04 | LOW | `components/EngineIcons.tsx:71` | `Partial<Record<string, React.FC<IconProps>>>` — functional but unclear. |

### 3.2 Shared Types (Positive)

- **No type duplication** — all types sourced from `@bkd/shared` via `types/kanban.ts`
- **`import type` used consistently** across 64 files
- Query key factory provides type-safe cache key management

### 3.3 Bundle Size & Imports (Positive)

- All 7 pages use `React.lazy()` for route-level code splitting
- No circular imports detected
- Individual icon imports from `lucide-react` (tree-shaking friendly)
- All HTML rendering uses `DOMPurify.sanitize()` (4 locations)
- No `eval()` or `Function()` patterns

---

## 4. Accessibility

| # | Severity | File:Line | Description |
|---|----------|-----------|-------------|
| A-01 | CRITICAL | `components/kanban/KanbanBoard.tsx`, `KanbanCard.tsx` | Drag-and-drop is mouse-only. No keyboard navigation, no screen reader support. **Suggestion:** Add arrow key reordering; implement `aria-live` for drag state. |
| A-02 | CRITICAL | `components/issue-detail/ChatBody.tsx:287-311` | Scroll buttons have only `title` attribute, missing `aria-label`. Screen readers won't announce purpose. |
| A-03 | CRITICAL | All 4 drawers (Terminal, FileBrowser, ProcessManager, Notes) | Focus not trapped in drawers. Focus can escape to background content. **Suggestion:** Implement focus trap; return focus on close. |
| A-04 | CRITICAL | `components/issue-detail/ChatInput.tsx:592-625` | Inline command menu missing `role="listbox"` and `aria-label`. Items missing `role="option"`. |
| A-05 | HIGH | `components/issue-detail/ChatBody.tsx:256-283` | Dynamic SSE log entries not announced to screen readers. **Suggestion:** Add `aria-live="polite" aria-atomic="false"` wrapper. |
| A-06 | HIGH | `components/issue-detail/ChatInput.tsx:628-639` | Textarea missing associated `<label>` element. |
| A-07 | HIGH | `components/issue-detail/ChatArea.tsx:152-236` | Issue status/session state changes not announced. No `aria-live` region for status bar. |

---

## 5. Performance

| # | Severity | File:Line | Description |
|---|----------|-----------|-------------|
| P-01 | MEDIUM | `hooks/use-issue-stream.ts:33-34`, `components/issue-detail/ChatBody.tsx:256-283` | 500 live log entries all rendered in DOM with no virtualization. Long sessions cause DOM bloat. **Suggestion:** Use `@tanstack/react-virtual` or `react-window`. |
| P-02 | MEDIUM | `components/issue-detail/ChatBody.tsx:229-242` | Scroll and resize events unthrottled, triggering state updates every pixel. **Suggestion:** Debounce scroll (50ms); add `{ passive: true }`. |
| P-03 | MEDIUM | `components/issue-detail/ChatInput.tsx:869-910` | ModelSelect dropdown renders all models without memoization. Re-renders on every parent update. |
| P-04 | LOW | `components/issue-detail/ChatInput.tsx:744-800` | Images in file preview not optimized — no `loading="lazy"` or `decoding="async"`. |

---

## 6. UI/UX Patterns

### 6.1 Error Handling

| # | Severity | File:Line | Description |
|---|----------|-----------|-------------|
| U-01 | HIGH | `components/issue-detail/ChatBody.tsx:221` | Session failure shows only toast; no error details or retry path. **Suggestion:** Show error modal with details, log access, and retry button. |
| U-02 | HIGH | `lib/event-bus.ts:162-179` | Network disconnection auto-recovers but user has no visibility. **Suggestion:** Add connection status indicator; allow manual reconnect. |
| U-03 | MEDIUM | `hooks/use-issue-stream.ts:289-291` | `loadOlderLogs` error only logged to console. No UI feedback. **Suggestion:** Add `loadOlderError` state; show error toast or inline message. |
| U-04 | MEDIUM | `components/issue-detail/ChatInput.tsx:256-268,584-590` | File upload errors auto-dismiss after 5s with no persistent record. **Suggestion:** Keep errors visible until dismissed. |
| U-05 | MEDIUM | `components/kanban/KanbanBoard.tsx`, `HomePage.tsx` | Inconsistent empty states. No "create first item" CTAs for 0 projects/issues. |

### 6.2 Mobile/Responsive

| # | Severity | File:Line | Description |
|---|----------|-----------|-------------|
| U-06 | HIGH | `components/issue-detail/ChatInput.tsx:515-521` | Textarea resize handle uses `onMouseDown` only — no touch support. |
| U-07 | MEDIUM | `components/issue-detail/ChatArea.tsx:250-292` | Mobile diff panel is full-screen overlay with no header/breadcrumb. **Suggestion:** Add mobile header with back arrow. |
| U-08 | LOW | `components/issue-detail/ChatInput.tsx:930-953` | CommandPicker popover fixed at 260px; may overflow narrow mobile. **Suggestion:** Use `w-[min(260px,calc(100vw-2rem))]`. |

### 6.3 Visual Design

| # | Severity | File:Line | Description |
|---|----------|-----------|-------------|
| U-09 | LOW | `index.css:60-61` | Muted text contrast ~4.5:1 in dark mode — borderline WCAG AA. |
| U-10 | LOW | `components/ui/button.tsx:7` | Disabled buttons at 50% opacity; hard to distinguish from enabled. **Suggestion:** Add `disabled:grayscale`. |
| U-11 | LOW | `components/issue-detail/ChatInput.tsx:586` | Error banner uses color alone; color-blind users may miss it. **Suggestion:** Add alert icon. |

---

## 7. Code Organization

### 7.1 i18n (Positive)

- **551 entries per language** in both `en.json` and `zh.json`
- **24 identical root keys** — complete parity
- `useTranslation()` used in 141 locations
- **No hardcoded user-facing strings** detected
- Language preference persisted to localStorage

### 7.2 Positive Patterns

- Proper `ErrorBoundary` with i18n-aware fallback UI
- Consistent `cn()` utility (clsx + tailwind-merge)
- Good `queryKeys` factory pattern for type-safe cache keys
- DOMPurify sanitization on all `dangerouslySetInnerHTML` usage
- Fractional indexing for drag-and-drop ordering
- Proper `enabled` flag usage in queries
- Centralized auth header logic with consistent 401 handling

### 7.3 Areas to Improve

| # | Severity | Description |
|---|----------|-------------|
| O-01 | LOW | No barrel files for `components/`, `hooks/`, `stores/` — minor friction on API discoverability |
| O-02 | LOW | `console.warn` in production code (`use-issue-stream.ts:290,366`) — should use structured logging |
| O-03 | LOW | Potential dead code: verify `use-event-connection.ts` is still used |

---

## Summary Table

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| React Patterns | 2 | 6 | 7 | 0 | 15 |
| State Management | 0 | 3 | 8 | 0 | 11 |
| TypeScript Quality | 0 | 1 | 2 | 1 | 4 |
| Accessibility | 4 | 3 | 0 | 0 | 7 |
| Performance | 0 | 0 | 3 | 1 | 4 |
| UI/UX Patterns | 0 | 3 | 3 | 3 | 9 |
| Code Organization | 0 | 0 | 0 | 3 | 3 |
| **Total** | **6** | **16** | **23** | **8** | **53** |

---

## Priority Action Plan

### Phase 1: Quick Wins (< 30 min each)
1. Add `aria-label` to scroll buttons (ChatBody.tsx)
2. Add `aria-live="polite"` to message area (ChatBody.tsx)
3. Add `role="listbox"` to command menu (ChatInput.tsx)
4. Fix index-based keys → content-based keys (SessionMessages.tsx, AppSettingsDialog.tsx)
5. Extract navigation callbacks to `useCallback` (IssueListPanel.tsx, ReviewListPanel.tsx)
6. Replace `prevFilteredRef` with `useEffect` (ChatInput.tsx)

### Phase 2: High-Impact Refactors (1-4 hours each)
1. Split `AppSettingsDialog.tsx` (1619 lines) → 6-8 section components
2. Split `ChatInput.tsx` (990 lines) → 4 sub-components + hooks
3. Split `use-kanban.ts` (975 lines) → 5-6 domain-specific hook files
4. Add focus traps to all 4 drawers
5. Implement log virtualization with `@tanstack/react-virtual`
6. Fix window listener memory leaks in 5 stores
7. Add keyboard navigation for drag-and-drop

### Phase 3: Systemic Improvements (1-2 days)
1. Standardize staleTime/invalidation strategy across all queries
2. Create `ApiError` class hierarchy for typed error handling
3. Add `React.memo()` to ChatBody and ChatInput with proper comparison
4. Add connection status indicator for SSE
5. Consolidate drawer stores or add proper selector patterns
6. Add React Query hooks for Notes API
