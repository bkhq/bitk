# PLAN-031 Fix bkd skill API examples

- status: completed
- task: DOC-001
- owner: doc-fix-session-20260324
- created_at: 2026-03-24 16:27 UTC
- updated_at: 2026-03-24 16:28 UTC

## Objective

Update the local `bkd` skill documentation so its REST API examples and response descriptions match the current BKD backend.

## Context

- Verified mismatches exist in the skill examples for project archive operations, project update payload shape, engine settings payload shape, process listing output, and cron log lookup behavior.
- The backend implementation is already working as expected; the issue is documentation drift in the local skill file.
- The repository currently has unrelated uncommitted changes outside this task and they must remain untouched.

## Workstreams

1. Update incorrect request examples and payloads in `skills/bkd/SKILL.md`
2. Update response descriptions to match actual API output
3. Re-read the affected route files and confirm the edited text matches the implementation

## Risks

- Over-correcting the skill with behavior that is not actually implemented
- Introducing new examples that are less precise than the current route contracts

## Out of Scope

- Backend API code changes
- New skill features or additional endpoint coverage
- Refactoring unrelated documentation
