# AUDIT-028 完整仓库模块化审计

- **status**: completed
- **priority**: P1
- **owner**: codex
- **plan**: PLAN-027
- **created**: 2026-03-19

## 描述

用户要求启动完整仓库审计，并将审计结果按模块输出到 `docs/codex-audit` 目录。该任务覆盖后端 API、前端应用、共享包、构建与发布脚本、升级链路、CI 配置与仓库级工程约束，属于跨模块非平凡审计任务。

## 调查结果

- 仓库当前是 Bun Workspaces monorepo，主模块包括 `apps/api`、`apps/frontend`、`packages/shared`、`packages/tsconfig`、`scripts`、`tools`、`upgrade` 与 `.github/workflows`。
- 现有 `docs/codex-audit` 目录为空，尚未建立这次全库审计的输出结构。
- `docs/task/index.md` 中已有一组历史 `AUDIT-001` 到 `AUDIT-027` 后端审计条目，但它们是单点问题清单，不等同于这次按模块产出的全仓审计报告。
- 该任务会新增多份审计文档，并可能回填索引页，符合 PMA 的非平凡任务判定，需要单独计划文件跟踪。

## 验证

- [x] 已读取 `AGENTS.md` / `CLAUDE.md` 中的 PMA 约束
- [x] 已检查 `docs/task/index.md` 与 `docs/plan/index.md`
- [x] 已确认仓库主模块与当前 `docs/codex-audit` 状态
- [x] 已生成 `docs/codex-audit/index.md` 总览
- [x] 已生成 API / Frontend / Repo Infrastructure 模块报告
- [x] 已将新增高置信度发现登记为 `AUDIT-029` 到 `AUDIT-039`

## 实现结果

- 新建 `docs/codex-audit/` 目录，并按模块输出：
  - `index.md`
  - `api-runtime.md`
  - `api-execution.md`
  - `api-data-upgrade.md`
  - `frontend-app.md`
  - `frontend-surfaces.md`
  - `repo-infra.md`
- 将历史 `AUDIT-001` 到 `AUDIT-027` 重新映射到对应模块，避免 backlog 继续散落在后端单点任务里。
- 新确认并登记以下问题：
  - `AUDIT-029` Files API caller-controlled root exposes host filesystem
  - `AUDIT-030` Files API root containment check is prefix-based and bypassable
  - `AUDIT-031` Full compile injects mismatched version symbols
  - `AUDIT-032` FileBrowserPage is implemented but unreachable from the router
  - `AUDIT-033` Launcher release channel is mutable via forced `launcher-v1` tag rewrite
  - `AUDIT-034` Privileged API surfaces rely entirely on upstream auth boundaries
  - `AUDIT-035` Upgrade restart path accepts downloaded artifacts without mandatory integrity verification
  - `AUDIT-036` Global SSE stream broadcasts cross-project activity to any subscriber
  - `AUDIT-037` Issue lock timeout releases mutual exclusion before timed-out work stops
  - `AUDIT-038` MCP API key is returned to the frontend and rendered in plaintext
  - `AUDIT-039` `useIssueStream` can drop later log updates after live-log trimming
