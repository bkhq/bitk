# PLAN-033 Restore issue cron action details in bkd skill

- status: completed
- task: DOC-002
- owner: cron-skill-doc-session-20260324
- created_at: 2026-03-24 16:36 UTC
- updated_at: 2026-03-24 16:38 UTC

## Objective

Restore the missing issue-specific cron action documentation in the `bkd` skill reference while keeping the main skill concise.

## Context

- The standardized `bkd` skill intentionally moved detailed API material into `skills/bkd/references/rest-api.md`.
- The cron section currently documents generic cron job creation but omits the action-specific config details for issue actions.
- Backend source confirms four issue actions exist: `issue-execute`, `issue-follow-up`, `issue-close`, and `issue-check-status`.

## Current State

- Agents can see that `config` exists for cron creation, but they cannot infer the issue action payloads from the skill reference alone.
- This creates unnecessary dependency on reading backend source files when using the skill.

## Proposal

1. Extend the cron creation section in `skills/bkd/references/rest-api.md`.
2. Add a dedicated subsection for issue actions.
3. Document per-action required fields and useful optional fields:
   - `issue-execute`
   - `issue-follow-up`
   - `issue-close`
   - `issue-check-status`
4. Add concrete `curl` examples for at least the execution and follow-up variants.
5. Keep all changes in the reference file only; do not expand the main `SKILL.md`.

## Risks

- Overstating config fields that are not actually consumed by the handlers.
- Making the reference too verbose if the examples duplicate information excessively.

## Scope

- `skills/bkd/references/rest-api.md`
- PMA tracking files for this task and plan

## Alternatives

1. Minimal patch: add only a short bullet list of action names and required fields.
2. Recommended patch: add field lists plus examples for the issue actions.
