# PLAN-032 Standardize bkd skill package

- status: completed
- task: SKILL-001
- owner: skill-standardization-session-20260324
- created_at: 2026-03-24 16:30 UTC
- updated_at: 2026-03-24 16:34 UTC

## Objective

Refactor the local `bkd` skill package so it matches the standard Codex skill layout and authoring conventions, with concise trigger guidance in `SKILL.md`, optional metadata in `agents/openai.yaml`, and deeper details moved into supporting files as needed.

## Context

- `skills/bkd` currently exists as a single `SKILL.md` file plus a repository-level `skills/README.md`.
- The skill-creator guidance recommends a per-skill folder with a required `SKILL.md`, optional `agents/openai.yaml`, and optional `references/`, `scripts/`, or `assets/` folders.
- The guidance explicitly advises against including `README.md` inside a skill package.
- The current `bkd` skill body is long and mixes trigger metadata, installation/setup notes, and detailed API examples in one file.
- The repository already has a real MCP server at `/api/mcp`; this task is about standardizing the skill package, not replacing it with MCP.

## Current State

- `skills/bkd/SKILL.md` works as a local instruction file, but it is formatted more like a long REST cheat sheet than a standard reusable skill.
- `skills/README.md` documents installation and discovery for humans, but it is not part of the standard skill package pattern from the skill guidance.
- No `skills/bkd/agents/openai.yaml` exists, so the skill lacks UI metadata recommended by the current guidance.

## Proposal

1. Keep `skills/bkd` as the canonical skill folder.
2. Rewrite `skills/bkd/SKILL.md` to be shorter, trigger-focused, and workflow-oriented.
3. Move the exhaustive BKD API examples into a supporting reference file under `skills/bkd/references/`.
4. Add `skills/bkd/agents/openai.yaml` with deterministic UI metadata matching the skill.
5. Remove the non-standard repository-level `skills/README.md` if its content becomes redundant with the skill package.
6. Validate the final package with `quick_validate.py`.

## Risks

- Over-compressing the skill may remove BKD-specific guidance that is still useful during invocation.
- Deleting `skills/README.md` could remove human-facing installation context if nothing replaces it elsewhere.
- `openai.yaml` metadata can drift from `SKILL.md` if not generated carefully.

## Scope

- `skills/bkd/**`
- `skills/README.md` only if we explicitly decide to remove or replace it
- PMA tracking files for this task and plan

## Alternatives

1. Minimal approach: keep the current skill mostly as-is, add only `agents/openai.yaml`, and leave the rest untouched.
2. Full standardization: slim `SKILL.md`, add `references/`, add `agents/openai.yaml`, and remove redundant non-standard files.
