# AUDIT-066 No prefers-reduced-motion support for CSS animations

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Frontend
- **source**: claude-audit/frontend-core.md
- **created**: 2026-03-19

## Location

- `apps/frontend/src/index.css`

## Description

Five CSS animations (card-enter, page-enter, message-enter, thinking-dot, pulse-glow) run unconditionally with no `prefers-reduced-motion` media query. WCAG 2.1 Level AA violation for users with vestibular disorders.

## Fix Direction

Add `@media (prefers-reduced-motion: reduce)` that disables or reduces animations.
