# AUDIT-063 dangerouslySetInnerHTML ESLint rule disabled globally

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Security
- **source**: claude-audit/security.md
- **created**: 2026-03-19

## Location

- `eslint.config.js`

## Description

`react-dom/no-dangerously-set-innerhtml` is set to `off` globally. Current usages are DOMPurify-sanitized, but future usages will not be flagged by the linter, increasing XSS risk over time.

## Fix Direction

Set the rule to `warn` globally. Add inline `// eslint-disable` for the existing sanitized usages.
