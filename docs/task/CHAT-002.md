# CHAT-002 聊天 UI 代码审查遗留项

- **status**: pending
- **priority**: P2
- **owner**: —
- **createdAt**: 2026-03-08 18:00

## 来源

CHAT-001 `/simplify` + `/code-review` 审查发现的 MEDIUM/LOW 项，均非阻塞但应后续优化。

## MEDIUM

- [ ] **SessionMessages.tsx 620 行应拆分** — 提取 `CodeRenderers.tsx`（ShikiCodeBlock/CodeBlock/ShikiUnifiedDiff/ToolPanel）和 `ToolItems.tsx`（FileToolItem/CommandToolItem/GenericToolItem/ToolGroupMessage），SessionMessages 仅保留 ChatMessageRow + 导出
- [ ] **前后端 rebuilder 逻辑分歧** — 前端 `use-chat-messages.ts` 有 commandOutput 配对和 slash-command 索引，后端 `message-rebuilder.ts` 缺失；前端 `buildToolGroup` 不应用 write-filter。需明确哪端为权威实现，或统一到 `@bkd/shared`
- [ ] **queries.ts 无条件批量 tool join** — 非 devMode 下 tool-use 行被 SQL 过滤，批量 join 结果为空属浪费。可加 `rows.some(r => r.entryType === 'tool-use')` 守卫
- [ ] **ExecutionStore 构造函数 63 行** — 提取 `initSchema()` + `prepareStatements()` 私有方法
- [ ] **rebuildMessages (frontend) 191 行** — 内部 `buildToolGroup`/`flushToolBuffer` 应提取为模块级辅助函数

## LOW

- [ ] **ChatMessageRow 冗余 key** — switch 分支内非列表元素上的 `key={message.id}` 无效果，可删除
- [ ] **后端 rebuildMessages 未被任何路由调用** — Phase 1 阶段性代码，需在后续 Phase 接入或标注为预备代码
# ci trigger
