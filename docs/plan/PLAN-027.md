# PLAN-027 完整仓库模块化审计

- **task**: AUDIT-028
- **status**: completed
- **owner**: codex
- **created**: 2026-03-19

## Context

- 本仓库是 Bun Workspaces monorepo，至少包含 API、前端、共享类型、构建脚本、升级链路与 CI 多个独立审计面。
- 当前没有面向整仓的审计报告目录，`docs/codex-audit` 为空；已有 `AUDIT-001` 到 `AUDIT-027` 主要是既有后端问题条目，不覆盖前端、共享包、脚本与 CI。
- 用户要求“启动完整仓库的审计，按模块输出”，因此产物需要先定义模块边界、输出结构、每个模块的审计维度和报告模板，再进入正式审计执行。
- 基础设施侧已经看到一个明确的优先检查点：构建脚本注入 `__BKD_VERSION__` / `__BKD_COMMIT__`，而运行时代码读取的是 `__BITK_VERSION__` / `__BITK_COMMIT__`，存在版本元数据失效风险。
- 前端侧已经看到一个明确的边界歧义：不少路由与 store 把 `project.alias` 写入 `/projects/:projectId`，需要在正式审计时确认 alias/id 语义是否一致、是否会造成缓存键或 API 调用混淆。

## Proposal

1. 先建立 `docs/codex-audit` 的统一输出结构，至少包含一个总览索引页和若干模块页；索引页负责汇总模块清单、严重级别、状态与交叉风险。
2. 按运行边界而不是按目录树机械切分审计，建议拆成以下模块：
   - `apps/api` 基础运行面：`app.ts`、`index.ts`、中间件、全局错误处理、静态资源与服务启动
   - `apps/api` 业务与执行引擎面：`routes/`、`engines/issue/`、`engines/executors/`、`events/`、`jobs/`、`webhooks/`
   - `apps/api` 数据与升级面：`db/`、`drizzle/`、`upgrade/`、上传与工作树相关路径
   - `apps/frontend` 应用壳与数据流面：`main.tsx`、`pages/`、`hooks/`、`stores/`、`lib/kanban-api.ts`、SSE/React Query/Zustand 交互
   - `apps/frontend` 功能 UI 面：`components/issue-detail/`、`kanban/`、`files/`、`notes/`、`terminal/`、`processes/`、`settings/`
   - 共享与仓库基础设施面：`packages/shared`、`packages/tsconfig`、根级 `package.json`、`scripts/`、`tools/`、`.github/workflows/`、根配置
3. 每个模块页采用统一模板：模块边界、入口与调用链、资产清单、发现项列表、风险说明、建议修复顺序、待验证点。
4. 审计执行顺序按“外部暴露面优先”推进：先 API 路由与执行引擎，再数据/升级链路，再前端数据流与 UI，最后补共享契约与 CI/发布链路。
5. 审计中若发现可独立跟踪的明确缺陷，再把问题拆回 `docs/task/AUDIT-0xx` 或新任务条目，避免把问题只埋在报告里。

## Risks

- 仓库审计范围很大，如果不先锁定模块模板与输出粒度，最终结果容易变成松散笔记而不是可执行报告。
- `apps/api` 中执行引擎、issue 生命周期、reconciler、upgrade 都带有并发和状态一致性风险，调查深度会显著高于普通 CRUD 模块。
- 前端依赖 SSE、React Query 与多套 Zustand store 的组合状态流，若只看单个组件，容易遗漏跨页面或断线重连时序问题。
- 历史 `AUDIT-001` 到 `AUDIT-027` 可能与本次调查重叠，需要在总览页中明确“已知问题”和“本次新增发现”的边界，避免重复记账。

## Scope

- In scope:
  - `apps/api`
  - `apps/frontend`
  - `packages/shared`
  - `packages/tsconfig`
  - 根级构建/打包脚本、CI workflow、升级辅助文件与工程配置
  - `docs/codex-audit` 下的总览页与模块审计页
- Out of scope:
  - 直接修复审计发现的问题
  - 与仓库无关的外部基础设施配置
  - 生成中文以外的双语审计文档

## Alternatives

1. 只做单一总报告，不按模块拆分。
缺点：后续追踪和增量更新困难，不能满足“按模块输出”的要求。

2. 完全按目录逐层生成报告。
优点：机械简单。
缺点：无法反映真实运行边界，例如 `apps/api/routes`、`engines`、`db` 与 `upgrade` 的风险面并不等价。

3. 只延续已有 `AUDIT-001` 到 `AUDIT-027` 的问题清单方式。
缺点：那是问题台账，不是完整仓库审计；也无法覆盖前端、共享包、CI 与发布链路。

## Verification

- 已核对 `AGENTS.md` / `CLAUDE.md` 中 PMA 约束
- 已认领 `AUDIT-028`
- 已建立 `PLAN-027` 草案
- 已盘点仓库主模块、入口文件与 CI/打包链路
- 已生成 `docs/codex-audit` 模块化审计报告
- 已将新发现拆分登记为 `AUDIT-029` 到 `AUDIT-039`
