# CHAT-001 聊天界面 UI 优化（对标 Claude Code）

- **status**: completed
- **priority**: P1
- **owner**: claude
- **createdAt**: 2026-03-08 12:00

## 描述

对标 Claude Code Web 聊天界面，优化 BKD 的 issue 聊天 UI，提升信息密度和交互体验。

## 进度

### Phase 1: 后端基础设施 ✅

- [x] ChatMessage 类型定义（packages/shared）— 7 种消息变体 + ToolProgressEvent/ToolGroupEvent
- [x] ExecutionStore（内存 SQLite）— 替代 RingBuffer，完整记录所有 normalized entries
- [x] MessageRebuilder（分组/配对/过滤纯函数）— entries → ChatMessage[]
- [x] 单元测试 — 20 个测试全部通过

### Phase 2: 后端 Pipeline 切换 ✅

- [x] 移除 normalizer write filter 拦截 — Read/Glob/Grep 不再丢弃
- [x] 替换 RingBuffer 为 ExecutionStore — ManagedProcess.logs 使用内存 SQLite
- [x] ExecutionStore 生命周期管理 — ProcessManager.onRemove 回调自动销毁
- [x] createLogNormalizer 同步化 — 不再依赖 loadFilterRules

### Phase 3: 前端适配 ✅

- [x] isVisibleForMode 开放 tool-use — normal mode 下发所有工具调用
- [x] DB 查询适配 — SQL 过滤和 tool detail 获取支持 tool-use
- [x] useChatMessages hook — NormalizedLogEntry[] → ChatMessage[] 前端重建
- [x] 重写 SessionMessages — ChatMessage 类型驱动渲染（switch on type）
- [x] ToolGroupMessage 可折叠组件 — 按 kind 统计摘要 + 展开内部 item

### Phase 4: 回归验证 ✅

- [x] 全量 lint + tests（377 后端 + 28 前端，0 fail）
- [x] 代码审查发现 5 个问题，全部修复：
  - ProcessManager.dispose() 跳过 onRemove → 增加循环调用
  - useChatMessages idCounter 模块级竞态 → 改为函数内局部变量
  - backend rebuilder metadata.type vs metadata.subtype 不一致 → 修正为 subtype
  - command_output 配对 indexOf O(n) + 跨命令错配 → 改为预索引 + consumedOutputIdx
  - backend rebuilder consumedResults 死代码 → 清理
- [x] Vite 构建通过
