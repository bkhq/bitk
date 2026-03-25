# DOCS-001 Add BKD skill installation note to README

- **status**: completed
- **priority**: P2
- **owner**: local-session
- **createdAt**: 2026-03-25 10:17

## Description

Add a concise README section that explains where the repository's BKD skill lives, how to install it for local agent use, and what configuration is required before invoking it.

## ActiveForm

Documenting the BKD skill installation flow in the repository README.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Investigation started on 2026-03-25.
- Root README currently documents engine installation and general usage, but does not explain how to use the repository's bundled `skills/bkd/` package.
- `skills/bkd/SKILL.md` expects `BKD_URL` to point at the BKD API root, for example `http://localhost:3000/api`.
- The repository also includes `skills/bkd/agents/openai.yaml`, which indicates the skill is packaged for agent UIs that surface skill metadata.
- Implemented on 2026-03-25 by adding matching BKD skill installation sections to `README.md` and `README.zh-CN.md`.
- Reopened on 2026-03-25 to switch the installation instructions to the `npx skills add ...` flow.
- Updated on 2026-03-25 to use `npx skills add https://github.com/bkhq/bkd --skill bkd -a codex -g -y` and a matching verification command.
- Reopened on 2026-03-25 to align the README command style with `zzci/skills`.
- Updated on 2026-03-25 to match the `zzci/skills` README pattern with global install, project install, and `--list` examples.
- Updated on 2026-03-25 to remove the misleading `--list` example and clarify that the repository currently exposes only the `bkd` skill.
- Updated on 2026-03-25 to move `BKD_URL` into a dedicated prerequisite subsection in both README files.
