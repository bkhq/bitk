# Frontend Core Audit

## Summary

Audited 11 files (2,024 lines total) across the frontend core: entry point, 6 pages, types re-export, i18n setup, test setup, and global CSS. The codebase is well-structured with consistent patterns: lazy-loaded routes, proper error boundaries, i18n throughout, responsive mobile/desktop handling, and a clean component architecture. Key concerns center on code duplication between `IssueDetailPage` and `ReviewPage`, a few accessibility gaps, and minor XSS surface areas in the file browser.

---

## Module Reports

### main.tsx
- **Lines**: 239
- **Quality**: 4/5
- **Issues Found**:
  - Non-null assertion on `document.getElementById('app')!` (line 151) -- will throw an unhelpful error if the DOM element is missing.
  - SSE `eventBus.connect()` is called at module top-level (line 28), outside React lifecycle. This is intentional for singleton behavior but makes testing difficult and creates a side effect on import.
  - The debounced activity timer (lines 39-51) uses a bare block scope with `let` -- functional but unconventional; a named IIFE or extracted function would be clearer.
  - `FileBrowserPage` is imported in `FileBrowserPage.tsx` but has no route defined in `main.tsx`. The file browser page is unreachable via the router.
  - Loading spinner fallback (lines 162-164) has no text/ARIA label for screen readers.
- **Recommendations**:
  - Add a guard with a meaningful error message if `#app` is not found.
  - Add `aria-label="Loading"` or visually hidden text to the Suspense fallback spinner.
  - Add a route for `FileBrowserPage` (e.g., `/projects/:projectId/files/*`) or remove the dead page file.
  - Extract the debounce logic into a named helper for readability.

### pages/HomePage.tsx
- **Lines**: 611
- **Quality**: 3/5
- **Issues Found**:
  - At 611 lines with 5 components, this file is large. The `SortableProjectCard` (lines 48-181), `ArchivedProjectsSection` (lines 186-296), `MobileHomeMenu` (lines 300-399), and `DesktopHeaderControls` (lines 404-459) should be extracted to separate files.
  - Significant duplication between `SortableProjectCard` and the archived project card rendering (lines 243-290) -- nearly identical card markup with minor style differences.
  - `useEffect` for `monitorForElements` (line 480) has an empty dependency array but references `projectsRef` and `sortProjectRef` via refs -- this is correct but the `// eslint-disable` is implied. The `t` variable shadowing in the `onDrop` callback (line 485: `targets.find((t: any) => ...`) shadows the `useTranslation` `t` from the outer scope.
  - The `any` type cast on line 485 (`(t: any)`) bypasses type safety.
  - `navigator.clipboard.writeText` (line 94) has no error handling -- will silently fail in non-secure contexts (HTTP).
- **Recommendations**:
  - Extract inner components into `components/home/` directory.
  - Create a shared `ProjectCard` component for both active and archived project rendering.
  - Replace `(t: any)` with a proper type from `@atlaskit/pragmatic-drag-and-drop`.
  - Add `.catch()` handler for clipboard operations.
  - Rename the `t` variable in the `find` callback to avoid shadowing.

### pages/KanbanPage.tsx
- **Lines**: 174
- **Quality**: 4/5
- **Issues Found**:
  - The overlay `div` (line 97) has `onClick={close}` but no keyboard handler (`onKeyDown` for Escape). Users relying on keyboard navigation cannot dismiss the overlay.
  - `inert` attribute usage (line 72) is good for accessibility, but `{...(!isMobile && isPanelOpen ? { inert: true } : {})}` uses spread with `inert` as a boolean attribute. React 19 supports this natively, but in older React versions this could be problematic. Given React 19 is used, this is acceptable.
  - `ResizeHandle` reads `setWidth` via `usePanelStore.getState()` (line 126) outside the React render cycle. This is a Zustand best practice for avoiding re-renders, which is correct here.
  - `ResizeHandle` has excellent accessibility: `role="separator"`, `aria-orientation`, `aria-valuenow/min/max`, `tabIndex`, and keyboard support. Well done.
  - Default `projectId` of `'default'` (line 23) could mask routing errors -- a missing projectId parameter silently becomes "default".
- **Recommendations**:
  - Add `onKeyDown` handler to the overlay for Escape key dismissal.
  - Consider whether `'default'` is a valid fallback for `projectId` or if it should redirect.

### pages/IssueDetailPage.tsx
- **Lines**: 174
- **Quality**: 3/5
- **Issues Found**:
  - Heavy code duplication with `ReviewPage.tsx` -- the resize logic (`handleListResizeStart`, `handleDiffWidthChange`, `handleFileBrowserWidthChange`, `useEffect` for clamping), constants (`SIDEBAR_WIDTH`, `MIN_CHAT_WIDTH`, `DEFAULT_DIFF_WIDTH`, etc.), and layout structure are nearly identical.
  - Direct DOM manipulation in `handleListResizeStart` (lines 63-71): `document.body.style.cursor`, `document.body.style.userSelect`, and manual event listener registration. This bypasses React's synthetic event system.
  - `typeof window !== 'undefined'` checks (lines 50, 78, 82-83, 93-94, 106) suggest SSR awareness, but the app is a client-only SPA (Vite). These guards are unnecessary.
  - The `availableWidth` calculation on line 78 recalculates on every render but does not react to window resize events.
  - Deeply nested ternary expressions in the JSX (lines 149-170) hurt readability.
- **Recommendations**:
  - Extract shared resize logic and layout constants into a custom hook (e.g., `usePanelLayout`).
  - Replace direct DOM manipulation with a React-based resize approach (e.g., pointer events on a resize handle component, similar to `KanbanPage`'s `ResizeHandle`).
  - Remove `typeof window !== 'undefined'` guards in the SPA context.
  - Use early returns or helper components to flatten nested ternaries.

### pages/TerminalPage.tsx
- **Lines**: 29
- **Quality**: 5/5
- **Issues Found**:
  - `navigate(-1)` (line 16) can navigate outside the app if there is no browser history (e.g., user opened the page directly). This is a minor UX concern.
- **Recommendations**:
  - Consider falling back to `navigate('/')` if `window.history.length <= 1`.

### pages/ReviewPage.tsx
- **Lines**: 150
- **Quality**: 3/5
- **Issues Found**:
  - Nearly identical to `IssueDetailPage.tsx` -- same constants, same resize handlers, same layout pattern. This is the most significant duplication issue in the audited files.
  - Same issues as `IssueDetailPage`: direct DOM manipulation for resize, unnecessary `typeof window` guards, deeply nested ternaries.
  - No loading state shown -- if `reviewIssues` is loading, the page renders with undefined data. Unlike `IssueDetailPage` and `KanbanPage`, there is no `isLoading` guard.
  - No error boundary or redirect for missing data.
- **Recommendations**:
  - Extract a shared `SplitPaneLayout` component or custom hook used by both `IssueDetailPage` and `ReviewPage`.
  - Add loading and error states.

### pages/FileBrowserPage.tsx
- **Lines**: 189
- **Quality**: 4/5
- **Issues Found**:
  - **XSS surface**: `kanbanApi.rawFileUrl()` is used to construct a download URL (line 45) and injected into an anchor element created via `document.createElement('a')` (lines 46-49). If `effectiveRoot` or `currentPath` can contain user-controlled data, this could be a vector for URL injection. The `a.href = url` assignment is safe from XSS but could be used for navigation to arbitrary URLs if the API does not validate paths.
  - No route exists in `main.tsx` for this page -- the component is defined but unreachable.
  - `handleToggleIgnored` wraps `toggleHideIgnored` in `useCallback` with `[toggleHideIgnored]` dependency, but the comment says no invalidation is needed. The `useCallback` wrapper is unnecessary since `toggleHideIgnored` is a stable Zustand action.
  - Error display casts to `Error` type (line 173): `(listingError as Error)?.message` -- acceptable but could use a type guard.
- **Recommendations**:
  - Add a route in `main.tsx` for this page or remove the dead code.
  - Validate download URLs server-side to prevent path traversal.
  - Simplify `handleToggleIgnored` by passing `toggleHideIgnored` directly.

### types/kanban.ts
- **Lines**: 42
- **Quality**: 5/5
- **Issues Found**:
  - None. Clean re-export barrel file with a helpful compatibility comment.
- **Recommendations**:
  - None. This file correctly bridges `@bkd/shared` types.

### i18n/index.ts
- **Lines**: 24
- **Quality**: 4/5
- **Issues Found**:
  - `escapeValue: false` (line 17) disables i18next's built-in XSS protection for interpolated values. This is standard for React (which escapes by default via JSX), but any usage of `dangerouslySetInnerHTML` with translated strings would be vulnerable.
  - `localStorage.getItem('i18n-lang')` (line 6) is called at module load time. If `localStorage` is unavailable (e.g., in private browsing on some browsers), this will throw.
- **Recommendations**:
  - Wrap `localStorage.getItem` in a try-catch for robustness.
  - Document that `escapeValue: false` relies on React's JSX escaping and must never be used with `dangerouslySetInnerHTML`.

### test-setup.ts
- **Lines**: 1
- **Quality**: 3/5
- **Issues Found**:
  - Minimal setup -- only imports `@testing-library/jest-dom` matchers. No mocks for `window.matchMedia`, `IntersectionObserver`, `ResizeObserver`, or `EventSource` -- all of which are used by the application and will cause test failures if not mocked.
  - No i18n mock setup, which could cause test failures for components using `useTranslation`.
- **Recommendations**:
  - Add mocks for browser APIs: `matchMedia`, `IntersectionObserver`, `ResizeObserver`, `EventSource`.
  - Add i18n initialization or mock for test isolation.
  - Add a `beforeAll`/`afterAll` for global cleanup.

### index.css
- **Lines**: 391
- **Quality**: 4/5
- **Issues Found**:
  - WebKit-specific scrollbar styles (lines 204-238) have no Firefox equivalents for hover states -- Firefox `scrollbar-color` does not support `:hover` pseudo-selectors in the same way, but the fallback at lines 240-256 covers this adequately.
  - `oklch()` color values are used throughout. Browser support is good (Chrome 111+, Firefox 113+, Safari 15.4+), but there are no fallback values for older browsers.
  - `-webkit-overflow-scrolling: touch` (line 200) is deprecated and unnecessary on modern iOS Safari.
  - The `touch-action: manipulation` on all elements (line 187) disables double-tap-to-zoom globally, which may affect accessibility for users who rely on zoom gestures.
  - No `prefers-reduced-motion` media query for the animations (`card-enter`, `page-enter`, `message-enter`, `thinking-dot`, `pulse-glow`). Users with motion sensitivity preferences will still see all animations.
- **Recommendations**:
  - Add `@media (prefers-reduced-motion: reduce)` to disable or simplify animations.
  - Remove deprecated `-webkit-overflow-scrolling: touch`.
  - Consider adding `prefers-color-scheme` auto-detection for initial theme (currently relies on JS `.dark` class toggle).
  - Add `oklch()` fallbacks for older browsers if broad compatibility is needed, or document the minimum browser versions.

---

## i18n Coverage

- **Total keys**: 491 in each locale
- **Missing in zh.json**: None
- **Missing in en.json**: None
- **Consistency**: Perfect 1:1 key parity between `en.json` and `zh.json`. All interpolation variables (`{{count}}`, `{{name}}`, `{{time}}`, etc.) are consistent across both locales.
- **Note**: `escapeValue: false` is set in the i18n config. This is safe because React JSX escapes output by default, but any raw HTML rendering of translated strings would be vulnerable to XSS.

---

## Critical Issues

1. **Missing route for FileBrowserPage** -- `FileBrowserPage.tsx` exists (189 lines) but has no corresponding route in `main.tsx`. The page is unreachable. Either add a route (`/projects/:projectId/files/*`) or remove the dead code.

2. **No `prefers-reduced-motion` support** -- Five CSS animations run unconditionally. This is a WCAG 2.1 Level AA violation (Success Criterion 2.3.3). Users with vestibular disorders may experience discomfort.

## High Priority

3. **Significant code duplication between IssueDetailPage and ReviewPage** -- The two pages share ~80% of their logic (resize handlers, layout constants, effect hooks, JSX structure). This violates DRY and means any layout fix must be applied in two places. Extract a shared `useSplitPaneLayout` hook and/or `SplitPaneLayout` component.

4. **ReviewPage has no loading/error state** -- Unlike all other pages, `ReviewPage` does not handle loading or error states for its data fetch. If the API is slow or fails, users see a blank page.

5. **Direct DOM manipulation in resize handlers** -- Both `IssueDetailPage` and `ReviewPage` manually set `document.body.style` and add/remove DOM event listeners. This bypasses React's event system and could cause memory leaks if the component unmounts during a drag.

## Medium Priority

6. **Clipboard API error handling** -- `navigator.clipboard.writeText()` in `HomePage` and `FileBrowserPage` has no error handler. In non-HTTPS contexts or when permissions are denied, this will fail silently or throw an unhandled promise rejection.

7. **`localStorage` access without try-catch in i18n/index.ts** -- Will throw in environments where localStorage is unavailable (e.g., some private browsing modes, storage quota exceeded).

8. **HomePage.tsx is oversized (611 lines, 5 components)** -- Exceeds the recommended 400-line limit. Inner components should be extracted to improve maintainability and testability.

9. **Missing accessibility on loading spinner** -- The Suspense fallback in `main.tsx` has no accessible label. Screen readers will not announce the loading state.

10. **Overlay in KanbanPage has no keyboard dismiss** -- The backdrop overlay accepts mouse clicks to close but does not handle Escape key, violating keyboard-only navigation expectations.

## Low Priority

11. **Unnecessary `typeof window !== 'undefined'` guards** -- Multiple occurrences across `IssueDetailPage` and `ReviewPage`. The app is a client-only SPA; these guards add code noise without value.

12. **`any` type usage in HomePage** -- `targets.find((t: any) => ...)` bypasses TypeScript safety. Should use the proper type from `@atlaskit/pragmatic-drag-and-drop`.

13. **Variable shadowing in HomePage** -- The `t` variable in the drag handler callback shadows the `t` from `useTranslation()`.

14. **Deprecated `-webkit-overflow-scrolling: touch`** -- No-op on modern Safari, should be removed for cleanliness.

15. **Test setup is minimal** -- Only imports jest-dom matchers. Missing mocks for `matchMedia`, `IntersectionObserver`, `ResizeObserver`, `EventSource`, and i18n. Will cause issues as test coverage expands.

16. **`navigate(-1)` in TerminalPage** -- Can navigate outside the application if the user landed on the page directly (no history stack). A fallback to `/` would be safer.
