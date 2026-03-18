# PLAN-025 全量修复前后端 TypeScript 类型错误

- **task**: BUG-016
- **status**: completed
- **owner**: codex
- **created**: 2026-03-18

## Context

- 当前前端 `tsc` 主要被 Atlaskit pragmatic drag-and-drop 模块声明缺失阻塞，导致相关回调参数无法正确推断并产生连带的隐式 `any`。
- 当前后端 `tsc` 同时包含外部 SDK 解析失败、Drizzle 类型约束错误、严格空值问题、联合类型收窄缺失，以及测试桩与断言不匹配。
- 从错误分布看，修复顺序应该先处理“全局阻塞源”，再清理具体业务错误，否则很难判断剩余报错是否真实。

## Proposal

1. 先补齐前端 Atlaskit pragmatic drag-and-drop 的类型来源，优先通过依赖补全或本地声明文件恢复模块解析，再显式标注关键拖拽回调参数类型，清掉前端类型错误。
2. API 侧先处理 ACP SDK 解析问题，确认应当使用已安装依赖、补充本地声明，还是改成仓库内可解析的导入路径。
3. 随后按类别修复后端类型错误：
   - Drizzle 布尔/数值列比较与 insert 参数类型
   - 返回值与严格空值检查
   - Claude normalizer 的事件联合类型
   - 调试日志与测试桩类型
4. 最后修复测试文件中因生产类型变化导致的断言与辅助对象类型错误，并重新跑前后端 `tsc --noEmit` 验证收口。

## Risks

- 如果 `@agentclientprotocol/sdk` 与 Atlaskit 子包只是 lockfile/安装缺失，那么仅改源码无法彻底解决，需要补依赖安装或重建 node_modules。
- 有些 API 测试错误可能反映真实接口签名变更，修测试时需要避免把生产代码错误“糊过去”。
- Drizzle 相关报错可能暴露 schema 与代码对 SQLite 布尔列表示方式不一致的问题，修法需要保持运行时行为不变。

## Scope

- In scope:
  - 前端 Kanban/HomePage 的拖拽相关 TypeScript 错误
  - API 运行时代码中的当前 `tsc` 错误
  - 与这些错误直接相关的测试文件和本地类型声明
- Out of scope:
  - 与 `tsc` 无关的 lint、样式或功能重构
  - 新功能开发

## Alternatives

1. 只通过放宽 `tsconfig` 或添加大量 `any`/类型断言绕过错误。
缺点：能过编译，但会继续掩盖真实类型问题，不符合这次“修复所有 tsc 错误”的目标。

2. 分前端和后端拆成两次任务。
优点：范围更小。
缺点：当前目标是仓库级清零 `tsc` 错误，拆开会延长收敛周期且重复验证。

## Verification

- `bun install`
- `bunx tsc -p apps/api/tsconfig.json --noEmit`
- `bunx tsc -p apps/frontend/tsconfig.json --noEmit`
- `bunx eslint apps/api/src/cache.ts apps/api/src/db/helpers.ts apps/api/src/db/pending-messages.ts apps/api/src/engines/executors/claude/normalizer-types.ts apps/api/src/engines/issue/debug-log.ts apps/api/src/engines/issue/queries.ts apps/api/src/engines/issue/store/message-rebuilder.ts apps/api/src/routes/projects.ts apps/api/src/routes/terminal.ts apps/api/test/acp-client.test.ts apps/api/test/claude-normalizer.test.ts apps/api/test/codex-normalize-log.test.ts apps/api/test/pending-messages-unit.test.ts apps/api/test/reconciler.test.ts apps/api/test/turn-completion-regression.test.ts`
