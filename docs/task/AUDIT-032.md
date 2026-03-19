# AUDIT-032 FileBrowserPage is implemented but unreachable from the router

- **status**: pending
- **priority**: P3
- **severity**: LOW
- **category**: Frontend
- **created**: 2026-03-19

## Location

- `apps/frontend/src/pages/FileBrowserPage.tsx:14-189`
- `apps/frontend/src/main.tsx:167-225`

## Description

`FileBrowserPage` implements a standalone `/projects/:projectId/files/*` experience, but `main.tsx` never registers any matching route. The application only mounts the file browser drawer.

This leaves a dead page in the codebase and creates drift between page-level navigation logic inside `FileBrowserPage` and the actual reachable frontend surface.

## Fix Direction

Either register the page route explicitly or remove the unused page-level implementation and keep the drawer as the only supported file browser surface.
