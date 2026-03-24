# SKILL-001 Standardize bkd skill package

- status: completed
- priority: P2
- owner: skill-standardization-session-20260324
- created_at: 2026-03-24 16:30 UTC
- updated_at: 2026-03-24 16:34 UTC
- scope: bring `skills/bkd` in line with the standard Codex skill structure and content guidelines

## Goal

Convert the local `bkd` skill into a standard skill package that follows the current skill authoring guidance while preserving its BKD-specific operational workflow.

## Context

- The repository currently exposes a local skill at `skills/bkd/SKILL.md`.
- The current package also includes `skills/README.md`, which is not part of the recommended skill contents.
- The skill lacks `agents/openai.yaml`, which is recommended for UI metadata.
- The current SKILL body is a long REST reference oriented around raw `curl` usage instead of a concise operational workflow with progressive disclosure.

## Deliverables

- A normalized `skills/bkd` package structure
- A rewritten `SKILL.md` that follows standard skill guidance
- Any supporting resources needed for progressive disclosure
- `agents/openai.yaml` aligned with the rewritten skill
- Validation output from the skill validation script

## Outcome

- Rewrote `skills/bkd/SKILL.md` into a shorter, trigger-focused skill entry point.
- Moved the detailed BKD endpoint and payload reference into `skills/bkd/references/rest-api.md`.
- Added `skills/bkd/agents/openai.yaml` for UI-facing skill metadata.
- Removed the non-standard repository-level `skills/README.md`.
- Validated the final skill directory with `quick_validate.py` successfully.
