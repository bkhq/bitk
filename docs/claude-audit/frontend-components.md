# Frontend Components Audit

## Summary

Audit of 45+ component files across 8 directories in `/app/ai/bkd/apps/frontend/src/components/`. The codebase demonstrates generally strong React patterns with consistent i18n usage, proper TypeScript typing, and good use of shadcn/ui primitives. Key concerns center on a few oversized files, duplicated resize/editor logic, missing memoization in performance-sensitive list components, and security-relevant `dangerouslySetInnerHTML` usage (properly sanitized with DOMPurify in all cases).

**Overall Quality Score: 3.8 / 5**

**Key Statistics:**
- Total files audited: 45+
- Files exceeding 400 lines: 7 (ChatInput 991, NotesDrawer 705, ProjectSettingsDialog 626, AppSettingsDialog 1618, ToolItems 530, CreateIssueDialog 530, IssueListPanel 436)
- `dangerouslySetInnerHTML` usages: 4 (all DOMPurify-sanitized)
- Components using `memo`: 4 (KanbanCard, IssueRow, ReviewIssueRow, IssueRow in IssueListPanel)

---

## Kanban Components

### AppSidebar.tsx
- **Lines**: 209
- **Quality**: 4/5
- **Performance**: Custom tooltip via manual state + getBoundingClientRect is unusual but functional. `ProjectButton` re-renders on every tooltip show/hide; no `memo`. The project list iterates and renders inline -- acceptable given typical project counts are small.
- **Accessibility**: Good -- `aria-label` on all icon buttons, `title` attributes present.
- **Issues Found**:
  - Custom tooltip implementation (lines 29-76) bypasses standard tooltip libraries, creating a portal-less floating element that may clip at viewport edges.
  - `scrollbarWidth: 'none'` inline style (line 119) hides scrollbar without accessibility alternative.
- **Recommendations**:
  - Replace custom tooltip with shadcn `Tooltip` for consistent behavior and accessibility.
  - Consider `memo` on `ProjectButton` if project list grows large.

### KanbanBoard.tsx
- **Lines**: 127
- **Quality**: 4/5
- **Performance**: Good use of `useRef` for callback refs to avoid re-registering the drag monitor. `useMemo` for `issuesByStatus` is correct. `useCallback` on `handleDrop` with empty deps is correct since it reads from refs.
- **Accessibility**: No keyboard drag-and-drop support (relies on @atlaskit which provides limited keyboard support).
- **Issues Found**:
  - `source: any, location: any` type cast on line 39 -- loses type safety.
  - `targets.find((t: any) => ...)` -- `any` types in drag handler.
- **Recommendations**:
  - Type the drag event parameters properly using `@atlaskit/pragmatic-drag-and-drop` types.
  - Add ARIA live region to announce drag results for screen readers.

### KanbanCard.tsx
- **Lines**: 137
- **Quality**: 4/5
- **Performance**: Correctly wrapped in `memo`. Effect re-registers drag handlers when `issue.id`, `columnStatusId`, or `index` changes -- appropriate.
- **Accessibility**: Missing `role="button"` or equivalent on the clickable card div. No keyboard activation (Enter/Space) handler.
- **Issues Found**:
  - The outer `div` with `onClick` (line 74) is not keyboard accessible -- no `tabIndex`, `role`, or `onKeyDown`.
  - `animationDelay` inline style (line 84) could cause jank with many cards.
- **Recommendations**:
  - Add `role="button"`, `tabIndex={0}`, and keyboard handler to the clickable card.
  - Consider limiting stagger animation to first N cards.

### KanbanColumn.tsx
- **Lines**: 93
- **Quality**: 4/5
- **Performance**: Clean implementation. Not memoized but receives stable props from parent.
- **Accessibility**: Good -- create button has `aria-label`.
- **Issues Found**:
  - `md:snap-align-none` class on line 47 is likely a non-standard Tailwind class (should be `md:snap-none` or similar).
- **Recommendations**:
  - Verify `md:snap-align-none` compiles correctly in Tailwind v4.

### KanbanHeader.tsx
- **Lines**: 101
- **Quality**: 4/5
- **Performance**: Lightweight component, no performance concerns.
- **Accessibility**: Good -- `aria-label` and `title` on all buttons. Search input has placeholder but lacks `aria-label`.
- **Issues Found**:
  - Search `<input>` (line 78) has no explicit label element or `aria-label`.
- **Recommendations**:
  - Add `aria-label={t('common.search')}` to the search input.

### CreateIssueDialog.tsx
- **Lines**: 530
- **Quality**: 3/5
- **Performance**: Multiple `useState` hooks for form state -- could benefit from `useReducer` or a form library. `useMemo` correctly used for `installedEngines`, `resolvedEngineType`, `currentModels`.
- **Accessibility**: Textarea has placeholder text, dialog has proper `DialogTitle`. `Switch` component used for worktree toggle is semantically correct.
- **Issues Found**:
  - File is large (530 lines) with 8 sub-components -- should be split.
  - Hardcoded max length display `2000` on line 200 without enforcing it via `maxLength` attribute.
  - `DropdownMenuTrigger` uses non-standard `render` prop pattern -- verify compatibility.
- **Recommendations**:
  - Extract `StatusSelect`, `EngineSelect`, `ModelSelect`, `PermissionSelect`, `WorktreeToggle` into a shared `form-controls/` directory.
  - Add `maxLength={2000}` to the textarea to enforce the displayed limit.
  - Split `CreateIssueForm` and `CreateIssueDialog` into separate files.

### IssuePanel.tsx
- **Lines**: 240
- **Quality**: 4/5
- **Performance**: Lazy-loads `DiffPanel` via `React.lazy` -- good. `useCallback` on `saveTitle` and `startEditingTitle`.
- **Accessibility**: Panel uses `tabIndex={-1}` for focus management. Escape key handling is well-implemented with editable element detection.
- **Issues Found**:
  - `navigator.clipboard.writeText()` (line 82) has `.catch(() => {})` -- silent failure with no user feedback on clipboard permission denial.
  - `effectiveIssue` variable (line 39) is assigned directly from `issue` with no transformation -- unnecessary indirection.
- **Recommendations**:
  - Show a toast or fallback when clipboard write fails.
  - Remove the `effectiveIssue` alias or document why it exists.

### MobileSidebar.tsx
- **Lines**: 174
- **Quality**: 4/5
- **Performance**: Clean implementation. `useCallback` properly used for `handleProjectCreated` and `mobileProjectPath`.
- **Accessibility**: Good -- `SheetTitle` with `sr-only` class for screen readers. All buttons have appropriate touch targets (`min-h-[44px]`).
- **Issues Found**:
  - Direct store access `useTerminalStore.getState().openFullscreen()` (line 135) and `useNotesStore.getState().openFullscreen()` (line 146) -- mixing store access patterns (selector vs direct).
- **Recommendations**:
  - Use consistent store access patterns -- prefer selectors with `useStore(s => s.action)`.

---

## Issue Detail Components

### ChatArea.tsx
- **Lines**: 359
- **Quality**: 4/5
- **Performance**: Lazy-loads `DiffPanel` and `FileBrowserPanel`. Multiple `useEffect` hooks for auto-titling with proper cleanup. Safety timeout for auto-titling (30s) is a good pattern.
- **Accessibility**: Back button has contextual `title`. Title editing input has `autoFocus`.
- **Issues Found**:
  - Duplicated title editing logic between `ChatArea.tsx` and `IssuePanel.tsx` (lines 100-113 vs IssuePanel lines 46-59).
  - Inline `onClick` for clipboard copy (lines 239-246) duplicates logic from `IssuePanel`.
  - `eslint-disable-next-line` comment on line 67 -- dependency array concern.
- **Recommendations**:
  - Extract shared title editing logic into a `useTitleEditor` hook.
  - Extract clipboard copy logic into a `useCopyToClipboard` hook.

### ChatBody.tsx
- **Lines**: 379
- **Quality**: 4/5
- **Performance**: `useSessionState` hook encapsulates complex stream state derivation. Scroll position tracking uses passive event listeners -- good. `LazySessionMessages` via `React.lazy` defers heavy rendering.
- **Accessibility**: Scroll-to-top/bottom buttons have `title` attributes. Delete confirmation dialog is properly structured.
- **Issues Found**:
  - `deriveWorkingStep` function (lines 37-55) iterates logs in reverse on every render when used in `useSessionState` -- not memoized.
  - Multiple `useRef` for tracking previous state (lines 199, 216) -- complex state machine that could benefit from documentation.
  - `logs.length` in scroll effect dependency (line 242) causes re-subscription on every log append.
- **Recommendations**:
  - Memoize `deriveWorkingStep` result with `useMemo`.
  - Remove `logs.length` from scroll event listener dependency array (it should only set up once).
  - Document the state machine for cancellation flow.

### ChatInput.tsx
- **Lines**: 991
- **Quality**: 3/5
- **Performance**: Complex component with many responsibilities. Draft persistence to localStorage on every keystroke. Inline command menu filtering uses fuzzy match. Drag resize handles add/remove document-level listeners properly.
- **Accessibility**: File input is hidden with proper trigger button. Textarea has placeholder. Drag overlay provides visual feedback.
- **Issues Found**:
  - **Oversized file** (991 lines) -- the largest single component file. Contains 7 sub-components (`FilePreviewModal`, `BusyActionSelect`, `EngineInfo`, `ModelSelect`, `CommandPicker`, `ModeSelect`, and main `ChatInput`).
  - `handleSend` is an async function defined inline (not wrapped in `useCallback`) -- recreated every render.
  - `isSendingRef` (line 155) used as manual mutex -- could race with React strict mode double-invocation in dev.
  - `prevFilteredRef` comparison on line 241 is done during render (not in effect) -- technically a side effect during render.
  - `normalizePrompt` regex (line 43) uses `\\n` which matches literal backslash-n, not newline characters.
- **Recommendations**:
  - Split into separate files: `ChatInput.tsx`, `FilePreviewModal.tsx`, `ModelSelect.tsx`, `CommandPicker.tsx`, `ModeSelect.tsx`.
  - Wrap `handleSend` in `useCallback` or extract to a custom hook.
  - Fix `normalizePrompt` regex -- `\\n` should likely be `\n`.
  - Move command index reset to a `useEffect` instead of render-time side effect.

### CodeRenderers.tsx
- **Lines**: 289
- **Quality**: 4/5
- **Performance**: Lazy-loads `@pierre/diffs/react` components. `ShikiCodeBlock` correctly cancels async highlighting on unmount. `ensurePatchHeaders` is a pure function.
- **Accessibility**: Code blocks have no ARIA roles or labels.
- **Security**: `dangerouslySetInnerHTML` on line 121 -- **properly sanitized** with `DOMPurify.sanitize(html)`.
- **Issues Found**:
  - `detectCodeLanguage` (lines 61-82) duplicates logic that exists in `FileViewer.tsx`'s `inferLang`.
  - `LazyFileDiff` key uses array index (`key={i}` on line 249) -- acceptable for static lists but could cause issues if list order changes.
- **Recommendations**:
  - Extract shared language detection into a utility function in `lib/`.
  - Add `role="region"` and `aria-label` to code block containers.

### DiffPanel.tsx
- **Lines**: 393
- **Quality**: 4/5
- **Performance**: File patches are lazily loaded per file via `useIssueFilePatch` with `isOpen` guard -- excellent. `useMemo` for patch stats. Resize handle uses pointer capture -- correct.
- **Accessibility**: Close button has `aria-label`. Copy path button has `aria-label` and `title`. Resize handle lacks keyboard support.
- **Issues Found**:
  - Deeply nested ternary chain in the render (lines 107-149) -- hard to read.
  - `ResizeHandle` component (lines 360-392) duplicates resize logic found in `TerminalDrawer`, `FileBrowserDrawer`, etc.
- **Recommendations**:
  - Replace nested ternaries with early returns or a switch/if-else pattern.
  - Extract a shared `ResizeHandle` component.

### IssueContextMenu.tsx
- **Lines**: 240
- **Quality**: 4/5
- **Performance**: `useCallback` on all handlers. `RenameDialog` is reusable.
- **Accessibility**: Dropdown menu items have icons + text. Delete confirmation dialog is properly accessible.
- **Issues Found**:
  - `handleExport` (lines 133-144) creates and clicks a temporary `<a>` element -- standard pattern but could use `window.open` as fallback.
  - `DropdownMenuTrigger render={children as React.JSX.Element}` (line 154) -- unsafe cast, will fail if children is not a single element.
- **Recommendations**:
  - Add type guard or assertion for `children` prop instead of `as` cast.

### IssueDetail.tsx
- **Lines**: 233
- **Quality**: 3/5
- **Performance**: `useClickOutside` hook used for custom dropdown -- works but custom dropdowns should use shadcn `DropdownMenu` instead.
- **Accessibility**: Tag editing input lacks `aria-label`. Custom status dropdown (lines 168-231) is not keyboard navigable (no arrow key support, no `role="listbox"`).
- **Issues Found**:
  - `StatusSelect` (lines 168-232) is a custom dropdown implementation that duplicates functionality available in shadcn `DropdownMenu` or `Select`.
  - Worktree popover (lines 134-158) is a custom implementation without proper focus management.
  - `tags: null` on line 87 should be `tags: []` for consistency with array types.
- **Recommendations**:
  - Replace `StatusSelect` with shadcn `DropdownMenu` for keyboard navigation and ARIA compliance.
  - Replace worktree popover with shadcn `Popover`.
  - Add `aria-label` to tag editing input.

### IssueListPanel.tsx
- **Lines**: 436
- **Quality**: 4/5
- **Performance**: `IssueRow` is wrapped in `memo` -- good. `useMemo` for `filtered`, `childMap`, and `grouped`. Status groups use `sticky top-0` for headers.
- **Accessibility**: `IssueRow` has `role="button"`, `tabIndex={0}`, and keyboard handler -- excellent. Child issue buttons lack keyboard handler.
- **Issues Found**:
  - Child issue `<button>` elements (lines 285-311) are proper buttons but lack context menu support available on parent issues.
  - `RenameDialog` is rendered inside every `IssueRow` `memo` -- the dialog is mounted/unmounted with each row, which is wasteful. Should lift to parent.
- **Recommendations**:
  - Lift `RenameDialog` to `IssueListPanel` level with shared state.
  - Add context menu to child issues for feature parity.

### LogEntry.tsx
- **Lines**: 493
- **Quality**: 4/5
- **Performance**: Switch-based rendering by `entryType` is clean. `AssistantMessage` sub-component manages its own copy/view state.
- **Accessibility**: Tool icons provide visual distinction but lack text labels for screen readers.
- **Issues Found**:
  - `TaskPlanEntry` uses `item.content` as `key` (line 144) -- content strings may not be unique, causing React key collisions.
  - `formatTime` creates a new `Date` object on every call without memoization.
  - `AssistantMessage` opens a `Dialog` with lazy-loaded `MarkdownRenderer` -- could flash layout.
- **Recommendations**:
  - Use index-based keys or generate stable IDs for `TaskPlanEntry` items.
  - Add `sr-only` text to tool icons for screen reader users.

### MarkdownContent.tsx
- **Lines**: 139
- **Quality**: 4/5
- **Performance**: `preprocessContent` is memoized via `useMemo`. Shiki highlighting is async with proper cancellation.
- **Security**: `dangerouslySetInnerHTML` on line 137 -- **properly sanitized** with `DOMPurify.sanitize(html)`.
- **Issues Found**:
  - `displayWidth` function (lines 6-25) handles CJK characters but misses some Unicode ranges (emoji, Hangul syllables).
  - Table formatting runs on every content change even if content has no tables.
- **Recommendations**:
  - Add early return in `preprocessContent` if content contains no `|` characters.

### SessionMessages.tsx
- **Lines**: 325
- **Quality**: 4/5
- **Performance**: Auto-scroll logic is well-implemented with near-bottom detection. Prevents scroll on older log prepend. Tracks `lastContentLen` for streaming updates.
- **Accessibility**: "Load more" button has disabled state with cursor feedback. Cancel button has disabled state.
- **Issues Found**:
  - `initialScrollDone` ref (line 199) uses double-rAF for initial scroll -- necessary but fragile; could break with layout changes.
  - Pending messages section duplicates `ChatMessageRow` rendering.
- **Recommendations**:
  - Consider using `useLayoutEffect` or `ResizeObserver` instead of double-rAF for more reliable initial scroll.

### ToolItems.tsx
- **Lines**: 530
- **Quality**: 4/5
- **Performance**: Individual tool item renderers are well-separated. `CodeBlock` and `ShikiUnifiedDiff` are lazy-rendered within collapsible panels.
- **Accessibility**: Copy buttons lack `aria-label`. Tool labels use icon + text pattern.
- **Issues Found**:
  - `ToolItemRenderer` passes `key` as a prop to the child component (lines 488-499) -- React `key` should be on the element returned by the parent, not passed down. The `key` prop here is ignored by the child.
  - `cleanAgentResult` (lines 372-385) filters lines by string matching -- fragile if output format changes.
  - IIFE in JSX (lines 346-365) for `CommandToolItem` result rendering -- could be extracted.
- **Recommendations**:
  - Remove `key` prop from `ToolItemRenderer` children -- it's already on the `<ToolItemRenderer>` element.
  - Extract the IIFE in `CommandToolItem` to a named function or variable.
  - Add `aria-label` to copy buttons.

### AcpTimeline.tsx
- **Lines**: 241
- **Quality**: 4/5
- **Performance**: Mirrors `LegacySessionMessages` scroll logic. `useAcpTimeline` hook transforms logs.
- **Accessibility**: Same patterns as `SessionMessages`.
- **Issues Found**:
  - Significant code duplication with `LegacySessionMessages` (auto-scroll logic, thinking indicator, pending messages, load-more button).
  - `AcpPlanCard` duplicates rendering from `TaskPlanMessage` in `SessionMessages.tsx`.
- **Recommendations**:
  - Extract shared scroll management into a `useAutoScroll` hook.
  - Extract thinking indicator and pending messages into shared components.

### ReviewListPanel.tsx
- **Lines**: 251
- **Quality**: 4/5
- **Performance**: `ReviewIssueRow` is properly `memo`-ized. `useMemo` for filtering and grouping.
- **Accessibility**: `ReviewIssueRow` has `role="button"`, `tabIndex={0}`, and keyboard handler.
- **Issues Found**:
  - Hardcoded `reviewColor = '#f59e0b'` (line 164) -- should reference the status color from config.
  - Significant structural duplication with `IssueListPanel`.
- **Recommendations**:
  - Extract shared list panel structure (header, search, resize handle) into a base component.

### SubIssueDialog.tsx
- **Lines**: 34
- **Quality**: 5/5
- **Performance**: Minimal wrapper, no concerns.
- **Accessibility**: Properly uses `DialogTitle`. `aria-describedby={undefined}` suppresses empty description warning.
- **Issues Found**: None.
- **Recommendations**: None.

### diff-constants.ts
- **Lines**: 1
- **Quality**: 5/5
- **Issues Found**: None.

---

## Terminal Components

### TerminalDrawer.tsx
- **Lines**: 139
- **Quality**: 4/5
- **Performance**: Resize handle uses pointer events with proper capture. Conditional rendering when `!isOpen`.
- **Accessibility**: Excellent -- resize handle has `role="separator"`, `aria-orientation`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `tabIndex`, and keyboard handler.
- **Issues Found**:
  - Backdrop overlay (line 31) uses `onClick={close}` but no `aria-hidden` attribute.
- **Recommendations**:
  - Add `aria-hidden="true"` to backdrop overlay (consistent with NotesDrawer which does have it).

### TerminalView.tsx
- **Lines**: 437
- **Quality**: 4/5
- **Performance**: Terminal instance is singleton, persisted across mounts via Zustand store. WebGL addon used for GPU acceleration with graceful fallback. `ResizeObserver` for container resize.
- **Accessibility**: Terminal is inherently accessible via xterm.js keyboard handling.
- **Issues Found**:
  - Module-level mutable variable `wsRetryCount` (line 195) -- shared state outside React lifecycle could cause issues in SSR/testing.
  - `mountedRef` pattern (lines 335, 357) to prevent double-mounting in StrictMode -- works but is fragile.
  - WebSocket reconnection logic is complex with multiple code paths -- could benefit from a state machine.
  - `isDarkMode()` reads DOM directly (line 62) -- not reactive to theme changes (handled separately by MutationObserver).
- **Recommendations**:
  - Encapsulate `wsRetryCount` within the store or a class instance.
  - Consider a formal state machine (e.g., XState) for WebSocket connection management.

---

## Files Components

### FileBrowserDrawer.tsx
- **Lines**: 132
- **Quality**: 4/5
- **Performance**: Standard drawer pattern with resize. No concerns.
- **Accessibility**: Resize handle has full ARIA attributes. Close/minimize/maximize buttons have `aria-label` and `title`.
- **Issues Found**:
  - Backdrop overlay `onKeyDown={undefined}` (line 41) -- unnecessary prop.
- **Recommendations**:
  - Remove `onKeyDown={undefined}` from backdrop.

### FileBrowserPanel.tsx
- **Lines**: 90
- **Quality**: 4/5
- **Performance**: Lightweight wrapper. Resize handle has full ARIA.
- **Accessibility**: Good.
- **Issues Found**: None significant.
- **Recommendations**: None.

### FileBrowserContent.tsx
- **Lines**: 254
- **Quality**: 4/5
- **Performance**: Uses `useProjectFiles` with `enabled` flag to control fetching. `useCallback` on handlers.
- **Accessibility**: Delete confirmation dialog is properly structured.
- **Issues Found**:
  - Deeply nested ternary in render (lines 186-227) -- 5 levels deep, hard to maintain.
  - `handleDeleteEntry` parameter `_type` (line 97) is unused -- parameter exists for API compatibility but underscore naming is correct.
- **Recommendations**:
  - Replace nested ternary with early returns or a state-machine-driven render.

### FileViewer.tsx
- **Lines**: 267
- **Quality**: 4/5
- **Performance**: Skips Shiki highlighting for rendered markdown and editing mode -- smart optimization. Lazy-loads `CodeEditor`.
- **Security**: `dangerouslySetInnerHTML` on line 261 -- **properly sanitized** with `DOMPurify.sanitize(html)`.
- **Accessibility**: Edit/cancel/save buttons have `title` attributes.
- **Issues Found**:
  - `inferLang` function (lines 12-45) duplicates `detectCodeLanguage` in `CodeRenderers.tsx`.
  - `formatSize` function (lines 52-56) duplicates the same function in `FileList.tsx`.
  - Render-time side effect: `prevPath` comparison (lines 86-89) sets state during render.
- **Recommendations**:
  - Extract `inferLang`/`detectCodeLanguage` into `lib/language.ts`.
  - Extract `formatSize` into `lib/format.ts` (project already has `formatFileSize` there).
  - Move path change detection to `useEffect`.

### FileList.tsx
- **Lines**: 172
- **Quality**: 4/5
- **Performance**: Table rendering is straightforward. No virtualization -- could be slow with very large directories.
- **Accessibility**: Table has proper `<thead>` and `<tbody>`. Delete button is keyboard accessible within table row.
- **Issues Found**:
  - `formatSize` (line 16) and `formatDate` (line 22) are duplicated utility functions.
  - Table rows use `onClick` for navigation but `<tr>` is not a semantic interactive element -- no `role="button"` or `tabIndex`.
- **Recommendations**:
  - Add `tabIndex={0}`, `role="row"` (or use a button/link inside the row) for keyboard navigation.
  - Consider virtualization for large directory listings.

### FileBreadcrumb.tsx
- **Lines**: 66
- **Quality**: 5/5
- **Performance**: Lightweight, no concerns.
- **Accessibility**: Uses `<nav>` with `aria-label` -- excellent.
- **Issues Found**: None.
- **Recommendations**: None.

### ShikiCodeBlock.tsx
- **Lines**: 39
- **Quality**: 4/5
- **Performance**: Async highlighting with cancellation.
- **Security**: `dangerouslySetInnerHTML` on line 35 -- **properly sanitized** with `DOMPurify.sanitize(html)`.
- **Issues Found**: None.
- **Recommendations**: None.

### MarkdownRenderer.tsx
- **Lines**: 58
- **Quality**: 5/5
- **Performance**: `useCallback` for custom renderers with empty deps. Lazy Shiki highlighting per code block.
- **Accessibility**: Uses semantic `<code>` elements.
- **Issues Found**: None.
- **Recommendations**: None.

### CodeEditor.tsx
- **Lines**: 122
- **Quality**: 4/5
- **Performance**: `useMemo` for extensions based on `filePath`. `useCallback` for handlers.
- **Accessibility**: Supports Ctrl+S to save and Escape to cancel.
- **Issues Found**:
  - `onKeyDown` handler on wrapper div may not capture CodeMirror's internal key events reliably.
- **Recommendations**:
  - Consider using CodeMirror's keymap extension for save/cancel shortcuts instead of React onKeyDown.

---

## Process Components

### ProcessList.tsx
- **Lines**: 198
- **Quality**: 4/5
- **Performance**: No memoization on `ProcessCard` -- acceptable for small process counts.
- **Accessibility**: Navigate button has semantic text. Status icons provide visual state.
- **Issues Found**:
  - `formatDuration` (lines 54-63) duplicates similar functions elsewhere.
  - Status icons lack text labels for screen readers.
- **Recommendations**:
  - Add `aria-label` to `StatusIcon`.
  - Consolidate duration formatting utilities.

### ProcessManagerDrawer.tsx
- **Lines**: 168
- **Quality**: 4/5
- **Performance**: Conditional data fetching via `!!projectId && isOpen`. Standard drawer pattern.
- **Accessibility**: Resize handle has full ARIA attributes. Local `Badge` component shadows shadcn's `Badge`.
- **Issues Found**:
  - Local `Badge` component (lines 161-167) shadows the imported shadcn `Badge` (line 17) -- confusing naming.
  - Backdrop overlay `onKeyDown={undefined}` (line 37) -- unnecessary.
- **Recommendations**:
  - Rename local `Badge` to `CountBadge` or similar to avoid shadowing.
  - Remove unnecessary `onKeyDown={undefined}`.

---

## Notes Components

### NotesDrawer.tsx
- **Lines**: 705
- **Quality**: 3/5
- **Performance**: `NoteEditor` and `MobileNoteEditor` have debounced auto-save (800ms) with flush-on-unmount -- good pattern. `useMemo` for filtered/pinned/unpinned notes.
- **Accessibility**: Pin/delete buttons have `aria-label`. Editor inputs have placeholders. Back button on mobile has `aria-label`.
- **Issues Found**:
  - **Massive code duplication**: `NoteEditor` (lines 445-568) and `MobileNoteEditor` (lines 574-704) share ~80% identical logic (state, debounce, handlers). Only layout differs.
  - File exceeds 700 lines -- should be split.
  - `useEffect` with empty dependency array (lines 483-490, 614-621) for cleanup has stale closure risk -- mitigated by ref but fragile.
  - `scheduleUpdate` callback depends on `onUpdate` directly rather than through a ref, causing re-creation on every parent render.
- **Recommendations**:
  - Extract shared note editing logic into a `useNoteEditor(note, onUpdate)` hook.
  - Extract `NoteListItem`, `NoteEditor`, `MobileNoteEditor` into separate files.
  - Use `onUpdate` via ref in `scheduleUpdate` to prevent re-creation.

---

## Settings Components

### WebhookSection.tsx
- **Lines**: 492
- **Quality**: 4/5
- **Performance**: Webhook deliveries loaded only when expanded. Event toggle uses functional state update.
- **Accessibility**: Switch components for active/inactive toggle. Event selection buttons use visual feedback.
- **Issues Found**:
  - `window.confirm` (line 353) for delete confirmation -- inconsistent with the rest of the app which uses shadcn `AlertDialog`.
  - `WebhookForm` does not validate URL format before submission.
  - Channel selection is not a radio group semantically -- buttons lack `role="radio"` or group context.
- **Recommendations**:
  - Replace `window.confirm` with `AlertDialog` for consistent UX.
  - Add URL format validation (at minimum check for `https://` prefix for webhooks).
  - Use `role="radiogroup"` and `role="radio"` for channel selection buttons.

---

## Other Components

### EngineIcons.tsx
- **Lines**: 101
- **Quality**: 5/5
- **Performance**: Pure SVG components, no concerns. Fallback renders first letter.
- **Accessibility**: SVG icons inherit `aria-label` from parent usage.
- **Issues Found**: None.
- **Recommendations**: None.

### AppLogo.tsx
- **Lines**: 14
- **Quality**: 5/5
- **Performance**: Lightweight.
- **Accessibility**: `alt` text provided.
- **Issues Found**: None.
- **Recommendations**: None.

### ErrorBoundary.tsx
- **Lines**: 47
- **Quality**: 4/5
- **Performance**: Class component (required for error boundaries).
- **Accessibility**: Error page has reload button with proper styling.
- **Issues Found**:
  - Uses `i18n.t()` directly instead of `useTranslation()` -- necessary since class components cannot use hooks, but translations may not update on language change.
- **Recommendations**:
  - Consider wrapping the error fallback UI in a functional component that uses `useTranslation`.

### CreateProjectDialog.tsx
- **Lines**: 219
- **Quality**: 4/5
- **Performance**: Clean form component with proper reset.
- **Accessibility**: Required field marked with `*`. Error messages displayed.
- **Issues Found**:
  - Alias input (line 126) restricts to lowercase alphanumeric only via `replace` -- the restriction is not communicated to the user.
- **Recommendations**:
  - Add helper text explaining alias format restrictions.

### ViewModeSelect.tsx
- **Lines**: 100
- **Quality**: 5/5
- **Performance**: Lightweight selector with two variants.
- **Accessibility**: `aria-label` on all buttons.
- **Issues Found**: None.
- **Recommendations**: None.

### ProjectSettingsDialog.tsx
- **Lines**: 626
- **Quality**: 4/5
- **Performance**: Uses `SettingsLayout` with tabbed navigation. `useMemo` for nav items.
- **Accessibility**: Settings layout provides structured navigation. Delete confirmation requires typing project name.
- **Issues Found**:
  - Large file (626 lines) with multiple sections -- could be split by tab.
  - `envVarsToText`/`textToEnvVars` utility functions (lines 219-237) should be in `lib/`.
  - `hasChanges` comparison (lines 275-281) does string comparison on every render -- could be memoized.
- **Recommendations**:
  - Split each settings tab into its own file.
  - Move env var parsing utilities to `lib/format.ts` or `lib/env.ts`.
  - Memoize `hasChanges` with `useMemo`.

### AppSettingsDialog.tsx
- **Lines**: 1618
- **Quality**: 3/5
- **Performance**: The largest component file in the codebase. Multiple sections with independent data fetching.
- **Accessibility**: Uses `SettingsLayout` for navigation. Toggle switches have labels.
- **Issues Found**:
  - **Critically oversized** at 1618 lines -- by far the largest component file. Should be broken into per-section files.
  - Contains engine configuration, update management, cleanup, system logs, MCP settings, deleted issues, and webhook settings all in one file.
- **Recommendations**:
  - Split into `EngineSettingsSection.tsx`, `UpdateSection.tsx`, `SystemSection.tsx`, `McpSection.tsx`, `DeletedIssuesSection.tsx`, etc.
  - Each section should be in `components/settings/`.

### DirectoryPicker.tsx
- **Lines**: 216
- **Quality**: 4/5
- **Performance**: Fetches directory listings on demand. Proper loading/error states.
- **Accessibility**: Button-based navigation for directories. Create folder input has `autoFocus`.
- **Issues Found**:
  - `fetchDirs` is not wrapped in `useCallback` but is used in `useEffect` -- the effect uses `initialPath` from closure which is fine since it's in deps.
  - Error message on line 48 is hardcoded in English (`'Failed to load directories'`) -- should use i18n.
- **Recommendations**:
  - Replace hardcoded error strings with i18n translations.

---

## Critical Issues

1. **AppSettingsDialog.tsx is 1618 lines** -- exceeds recommended maximum by 4x. Must be split into per-section files for maintainability.

2. **ChatInput.tsx is 991 lines** -- exceeds recommended maximum by 2.5x. Contains 7 sub-components that should be extracted.

3. **Possible regex bug in ChatInput.tsx**: `normalizePrompt` uses `\\n` which matches literal backslash-n text, not newline characters. Should be `\n`.

## High Priority

4. **Missing keyboard accessibility on KanbanCard** -- clickable cards lack `role="button"`, `tabIndex`, and keyboard handlers. Users navigating by keyboard cannot interact with kanban cards.

5. **Custom dropdown in IssueDetail.tsx (`StatusSelect`)** -- not keyboard navigable, lacks ARIA roles. Should be replaced with shadcn `DropdownMenu`.

6. **Duplicated code in NotesDrawer.tsx** -- `NoteEditor` and `MobileNoteEditor` share ~80% logic. Should extract a `useNoteEditor` hook.

7. **`window.confirm` in WebhookSection.tsx** -- inconsistent with the rest of the app's `AlertDialog` pattern and not styleable.

## Medium Priority

8. **Duplicated utility functions**:
   - `formatSize` exists in `FileList.tsx`, `FileViewer.tsx` (while `formatFileSize` exists in `lib/format.ts`)
   - `detectCodeLanguage` in `CodeRenderers.tsx` duplicates `inferLang` in `FileViewer.tsx`
   - Title editing logic duplicated between `ChatArea.tsx` and `IssuePanel.tsx`
   - Auto-scroll logic duplicated between `LegacySessionMessages` and `AcpTimeline`

9. **Duplicated resize handle pattern** across `TerminalDrawer`, `FileBrowserDrawer`, `FileBrowserPanel`, `ProcessManagerDrawer`, `NotesDrawer`, and `DiffPanel` -- should extract a shared `ResizeHandle` component.

10. **`RenameDialog` mounted inside every `IssueRow` memo** -- wasteful; should lift to parent level.

11. **Search inputs missing `aria-label`** in `KanbanHeader.tsx` (line 78).

12. **Backdrop overlay inconsistency** -- some use `aria-hidden="true"` (NotesDrawer), some do not (TerminalDrawer).

13. **ProjectSettingsDialog.tsx `hasChanges`** computed on every render without memoization.

## Low Priority

14. **Custom tooltip in AppSidebar** -- should use shadcn `Tooltip` for consistency.

15. **`any` types in KanbanBoard.tsx** drag handler -- should be properly typed.

16. **`effectiveIssue` alias in IssuePanel.tsx** -- unnecessary indirection, remove or document.

17. **`onKeyDown={undefined}` props** on backdrop overlays in `FileBrowserDrawer` and `ProcessManagerDrawer` -- remove unnecessary props.

18. **`TaskPlanEntry` uses content as key** (LogEntry.tsx line 144) -- could cause key collisions.

19. **Hardcoded English strings**: `'Failed to load directories'` in DirectoryPicker.tsx, `'Task Plan'` in LogEntry.tsx line 134 -- should use i18n.

20. **`key` prop passed to child component in ToolItemRenderer** (ToolItems.tsx lines 488-499) -- `key` on the rendered element is correct, but it's also passed redundantly as a prop to the child component where it's ignored.

21. **Module-level mutable `wsRetryCount`** in TerminalView.tsx -- should be encapsulated in store or class.
