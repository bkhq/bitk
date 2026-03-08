# PLAN-003 聊天界面 UI 优化（对标 Claude Code）

- **status**: completed
- **createdAt**: 2026-03-08 12:00
- **approvedAt**: 2026-03-08 13:30
- **relatedTask**: CHAT-001

## 现状

### 当前数据流与过滤问题

```
Engine stdout (stream-json)
  ↓
ClaudeLogNormalizer.parse(line)          ← 过滤点 1: 返回 null 丢弃条目
  ├─ Write filter rules                  ← 过滤点 2: Read/Glob/Grep 完全丢弃
  ├─ isReplay → null (历史回放丢弃)
  ├─ content_block_delta → null (流式增量丢弃)
  └─ task_started → null
  ↓
consumeStream()
  ├─ isCancelledNoiseEntry()             ← 过滤点 3: 取消后 5s 内噪音丢弃
  └─ meta-turn → metadata.type='system'  ← 过滤点 4: 标记为隐藏
  ↓
appEvents.emit('log', { entry })         ← 逐条发射
  ├─ Order 10: persist.ts → 写入 SQLite (visible=1)
  ├─ Order 15: token-usage.ts → 累加 token
  ├─ Order 20: ring-buffer.ts → 内存缓冲
  ├─ Order 30: auto-title.ts → 提取标题
  ├─ Order 40: failure-detect.ts → 故障检测
  └─ Order 100: SSE 边界
       └─ isVisibleForMode()             ← 过滤点 5: tool-use/thinking/token 全部拦截
  ↓
Frontend EventBus → useIssueStream → SessionMessages (300行命令式渲染)
```

**问题总结**：

| 问题 | 影响 |
|------|------|
| Read/Glob/Grep 在 normalizer 阶段完全丢弃 | 无法知道 agent 读了哪些文件 |
| 每条 entry 独立进入事件总线 | 无法在发射前做分组/摘要 |
| tool-use 在 normal mode 全部隐藏 | 用户只能在 devMode 看到工具调用 |
| thinking 块写入 DB 但从不下发 | 丢失有价值的推理过程 |
| 无审计日志 | 不知道丢了什么 |
| SessionMessages 承担数据转换+渲染双重职责 | 300行命令式循环，难以维护 |

### Claude Code 的设计

- 同一 turn 的工具调用合并为一个可折叠组
- 折叠标题为 AI 生成的操作描述
- 展开后显示 Read/Edit/Bash 操作列表，含增删行数
- 信息密度远高于 BKD

## 方案：内存数据库 + 消息重建

### 核心思路

**从「逐条过滤下发」变为「完整记录 → 重建 → 智能下发」**：

```
Engine stdout
  ↓
Normalizer (保留一切，不再丢弃)
  ↓
In-memory SQLite per execution (完整消息记录)
  ↓
MessageRebuilder (分组、过滤、摘要)
  ↓
Event Dispatcher (按组下发，而非逐条)
  ↓
Frontend (渲染 ChatMessage[])
```

### 架构细节

#### Layer 1: Normalizer 改造

**目标**：normalizer 不再丢弃条目，所有 stdout 输出都产出 `NormalizedLogEntry`。

```
当前行为:                        改造后:
Read tool → null (丢弃)          Read tool → NormalizedLogEntry (保留)
Glob tool → null (丢弃)          Glob tool → NormalizedLogEntry (保留)
content_block_delta → null       content_block_delta → null (仍然丢弃，这是流式碎片)
task_started → null              task_started → NormalizedLogEntry (保留)
isReplay → null                  isReplay → null (仍然丢弃，这是历史重放)
```

**保留丢弃的**：`content_block_delta`（无意义的流式碎片）、`isReplay`（历史重放）
**改为保留的**：Read/Glob/Grep 工具调用、task_started、非命令用户消息

**涉及文件**：
- `apps/api/src/engines/executors/claude/normalizer.ts` — 移除 write filter 拦截，保留所有工具调用
- `apps/api/src/engines/write-filter.ts` — 过滤规则不在 normalizer 阶段应用，改为在 rebuilder 阶段使用

#### Layer 2: 内存 SQLite（ExecutionStore）

**目标**：每个 execution 维护一个内存 SQLite 数据库，完整记录所有条目。

新增文件：`apps/api/src/engines/issue/store/execution-store.ts`

```typescript
import { Database } from 'bun:sqlite'

/**
 * Per-execution in-memory SQLite store.
 * Captures ALL normalized entries from engine stdout.
 * Entries are NOT filtered — that happens in the rebuilder.
 */
export class ExecutionStore {
  private db: Database

  constructor(executionId: string) {
    this.db = new Database(':memory:')
    this.db.exec(`
      CREATE TABLE entries (
        idx INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT UNIQUE,
        turn_index INTEGER NOT NULL,
        entry_type TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        metadata TEXT,           -- JSON
        tool_call_id TEXT,       -- 用于 call↔result 配对
        tool_name TEXT,
        tool_kind TEXT,          -- file-read, file-edit, command-run, search, etc.
        is_result INTEGER DEFAULT 0,
        timestamp TEXT
      );
      CREATE INDEX idx_turn ON entries(turn_index);
      CREATE INDEX idx_tool_call ON entries(tool_call_id);
      CREATE INDEX idx_type ON entries(entry_type);
    `)
  }

  /** 追加一条 normalized entry */
  append(entry: NormalizedLogEntry): void { ... }

  /** 获取指定 turn 的所有条目 */
  getByTurn(turnIndex: number): NormalizedLogEntry[] { ... }

  /** 获取指定 turn 的工具调用（已配对 call+result） */
  getToolPairs(turnIndex: number): ToolPair[] { ... }

  /** 获取工具调用统计 */
  getToolStats(turnIndex: number): Record<string, number> { ... }

  /** 获取当前 turn 的完整条目数 */
  getEntryCount(turnIndex: number): number { ... }

  /** 销毁（execution 结束时调用） */
  destroy(): void { this.db.close() }
}
```

**生命周期**：
- 创建：`executor.spawn()` 时创建
- 写入：替代当前的 ring-buffer (Order 20)，每条 entry append
- 读取：MessageRebuilder 在 turn 完成时查询
- 销毁：execution settlement 后或 GC 时调用 `destroy()`

#### Layer 3: MessageRebuilder

**目标**：从 ExecutionStore 中读取完整条目，重建为高级 `ChatMessage[]`。

新增文件：`apps/api/src/engines/issue/store/message-rebuilder.ts`

```typescript
/**
 * Rebuilds structured ChatMessages from raw ExecutionStore entries.
 * This is where filtering, grouping, and summarization happen.
 */
export function rebuildMessages(
  store: ExecutionStore,
  turnIndex: number,
  options: { devMode: boolean; filterRules: WriteFilterRule[] }
): ChatMessage[] {
  const entries = store.getByTurn(turnIndex)
  const messages: ChatMessage[] = []
  let toolBuffer: ToolGroupItem[] = []

  for (const entry of entries) {
    if (entry.entryType === 'tool-use' && !entry.metadata?.isResult) {
      // 收集工具调用到 buffer（含配对的 result）
      const result = store.getResult(entry.metadata?.toolCallId)
      toolBuffer.push({ action: entry, result })
      continue
    }

    // 遇到非工具条目 → flush 工具 buffer
    if (toolBuffer.length > 0) {
      messages.push(buildToolGroup(toolBuffer, options))
      toolBuffer = []
    }

    // 处理其他条目类型
    switch (entry.entryType) {
      case 'user-message': ...
      case 'assistant-message': ...
      case 'thinking': ...
      case 'system-message': ...
      case 'error-message': ...
    }
  }

  // flush 残余 buffer
  if (toolBuffer.length > 0) {
    messages.push(buildToolGroup(toolBuffer, options))
  }

  return messages
}

function buildToolGroup(items: ToolGroupItem[], options): ToolGroupChatMessage {
  // 应用 write filter rules（在这里过滤，而非 normalizer 阶段）
  const visible = items.filter(item => !isFilteredByRules(item, options.filterRules))
  const hidden = items.filter(item => isFilteredByRules(item, options.filterRules))

  return {
    type: 'tool-group',
    items: options.devMode ? items : visible,
    hiddenCount: hidden.length,     // "还有 3 个 Read 操作"
    stats: countByKind(items),      // { 'file-read': 3, 'file-edit': 2, ... }
    count: items.length,
  }
}
```

**关键设计**：
- Write filter rules **不再丢弃条目**，而是标记为 `hidden`
- 工具调用分组自然发生（连续 tool-use 合入 buffer）
- devMode 控制是否显示 hidden 条目
- 可以在这里添加更多分组规则（如合并连续 file-read）

#### Layer 4: Event Dispatcher 改造

**目标**：从逐条发射改为智能下发。

当前：每条 entry → `appEvents.emit('log')` → SSE

改造后：

```
场景 1: Turn 进行中（实时流）
  - assistant-message / user-message → 立即下发（不变）
  - tool-use 条目 → 写入 ExecutionStore，发 'tool-progress' 事件（轻量）
  - thinking → 写入 ExecutionStore，可选下发

场景 2: Turn 中的工具组完成（tool-use → assistant-message 边界）
  - 检测到助手开始回复 → flush 工具组
  - 从 ExecutionStore 重建 ToolGroupChatMessage
  - 发 'tool-group' SSE 事件（一次性下发整组）

场景 3: Turn 完成
  - 从 ExecutionStore 重建完整 turn 的 ChatMessage[]
  - 发 'turn-complete' SSE 事件（含摘要和统计）
```

**SSE 事件类型变更**：

```typescript
// 当前
type SSEEvent = 'log' | 'state' | 'done' | 'issue-updated' | 'changes-summary' | 'heartbeat'

// 新增
type SSEEvent =
  | 'log'              // 保留：assistant-message, user-message 等立即下发
  | 'tool-progress'    // 新增：工具执行中的轻量进度（工具名+路径）
  | 'tool-group'       // 新增：一组工具调用完成，含统计和配对结果
  | 'turn-complete'    // 新增：整个 turn 完成，含摘要
  | 'state' | 'done' | 'issue-updated' | 'changes-summary' | 'heartbeat'  // 不变
```

#### Layer 5: Frontend ChatMessage 模型

保持之前方案的 `ChatMessage` discriminated union，但数据来源从前端计算变为后端下发：

```typescript
// 前端不再需要做分组/配对逻辑
// ChatMessage 由后端 MessageRebuilder 构建，通过 SSE 下发

type ChatMessage =
  | UserChatMessage           // 来自 'log' 事件
  | AssistantChatMessage      // 来自 'log' 事件
  | ToolGroupChatMessage      // 来自 'tool-group' 事件（新）
  | TaskPlanChatMessage       // 来自 'log' 事件（TodoWrite 提取）
  | ThinkingChatMessage       // 来自 'log' 事件（可选下发）
  | SystemChatMessage         // 来自 'log' 事件
  | ErrorChatMessage          // 来自 'log' 事件
```

前端 `SessionMessages.tsx` 简化为纯渲染：

```tsx
function SessionMessages({ messages }: { messages: ChatMessage[] }) {
  return messages.map(msg => {
    switch (msg.type) {
      case 'user':        return <UserMessage msg={msg} />
      case 'assistant':   return <AssistantMessage msg={msg} />
      case 'tool-group':  return <ToolGroupMessage msg={msg} />
      case 'task-plan':   return <TaskPlanMessage msg={msg} />
      case 'thinking':    return <ThinkingMessage msg={msg} />
      case 'system':      return <SystemMessage msg={msg} />
      case 'error':       return <ErrorMessage msg={msg} />
    }
  })
}
```

### Pipeline 改造对比

```
当前 Pipeline:
  Normalizer → (filter) → emit('log') per entry → persist → SSE per entry → Frontend groups

改造后 Pipeline:
  Normalizer → ExecutionStore.append() → (turn boundary) → MessageRebuilder
    → persist ChatMessage[] → emit SSE events (grouped) → Frontend renders
```

### 现有 pipeline stages 的变化

| Stage | 当前 | 改造后 |
|-------|------|--------|
| Order 10: persist | 逐条写入 issues_logs | 逐条写入 ExecutionStore（内存），turn 完成后批量写入 issues_logs |
| Order 15: token-usage | 逐条累加 | 不变（仍从 entry 元数据提取） |
| Order 20: ring-buffer | Map-based 内存缓冲 | **替换为 ExecutionStore**（SQLite 内存数据库） |
| Order 30: auto-title | 不变 | 不变 |
| Order 40: failure-detect | 不变 | 不变 |
| Order 100: SSE | 逐条 + visibility filter | **智能下发**（tool-group 事件、turn-complete 事件） |

## ToolGroupMessage 渲染（前端）

```
折叠态（count > 1 时默认折叠）：
┌──────────────────────────────────────────────┐
│ ▸ 🔧 6 个操作  Read ×3 · Edit ×2 · Bash ×1   │
└──────────────────────────────────────────────┘

展开态：
┌──────────────────────────────────────────────┐
│ ▾ 🔧 6 个操作  Read ×3 · Edit ×2 · Bash ×1   │
├──────────────────────────────────────────────┤
│  📄 Read: src/routes/issues/_shared.ts        │
│  📝 Edit: src/routes/issues/_shared.ts        │
│     ┌─ diff ──────────────────────────┐      │
│     │ - old code                       │      │
│     │ + new code                       │      │
│     └─────────────────────────────────┘      │
│  💻 Bash: bun test                            │
│     ┌─ output ────────────────────────┐      │
│     │ ✓ 30 tests passed               │      │
│     └─────────────────────────────────┘      │
└──────────────────────────────────────────────┘

单个工具调用（count === 1，不折叠，直接展示当前 ToolPanel 样式）
```

## 输入框优化（不变，与之前方案一致）

合并状态栏到工具栏，减少一层视觉层级。

## 涉及文件

### 后端新增

| 文件 | 说明 |
|------|------|
| `apps/api/src/engines/issue/store/execution-store.ts` | 内存 SQLite 存储 |
| `apps/api/src/engines/issue/store/message-rebuilder.ts` | 消息重建（分组、过滤、配对） |
| `apps/api/src/engines/issue/store/types.ts` | ChatMessage 类型定义 |

### 后端修改

| 文件 | 说明 |
|------|------|
| `apps/api/src/engines/executors/claude/normalizer.ts` | 移除 write filter 拦截，保留所有工具调用 |
| `apps/api/src/engines/issue/streams/consumer.ts` | 写入 ExecutionStore 而非直接 emit |
| `apps/api/src/engines/issue/pipeline/persist.ts` | 从 ExecutionStore 批量写入 |
| `apps/api/src/engines/issue/pipeline/ring-buffer.ts` | 替换为 ExecutionStore |
| `apps/api/src/routes/events.ts` | 新增 tool-group / turn-complete SSE 事件 |
| `apps/api/src/engines/issue/utils/visibility.ts` | 迁移到 rebuilder 内部 |
| `packages/shared/src/index.ts` | 新增 ChatMessage 类型 |

### 前端修改

| 文件 | 说明 |
|------|------|
| `apps/frontend/src/hooks/use-issue-stream.ts` | 处理新 SSE 事件类型 |
| `apps/frontend/src/components/issue-detail/SessionMessages.tsx` | 简化为 switch 渲染 |
| `apps/frontend/src/components/issue-detail/LogEntry.tsx` | 拆分 + 新增 ToolGroupMessage |
| `apps/frontend/src/components/issue-detail/ChatInput.tsx` | 合并状态栏 |
| `apps/frontend/src/i18n/{en,zh}.json` | 新增 i18n keys |

## 实施步骤

### Phase 1: 后端基础设施（不影响现有功能）

1. 新增 `ChatMessage` 类型定义（`packages/shared`）
2. 新增 `ExecutionStore`（内存 SQLite）
3. 新增 `MessageRebuilder`（分组/过滤纯函数）
4. 为 rebuilder 编写单元测试

### Phase 2: 后端 Pipeline 切换

5. 修改 normalizer：移除 write filter 拦截
6. 修改 consumer：写入 ExecutionStore
7. 修改 pipeline：替换 ring-buffer，改造 persist 和 SSE 边界
8. 新增 SSE 事件类型（tool-group, turn-complete）
9. 后端集成测试

### Phase 3: 前端适配

10. 修改 `use-issue-stream`：处理新 SSE 事件
11. 重写 `SessionMessages`：switch 渲染
12. 新增 `ToolGroupMessage` 组件
13. 合并 ChatInput 状态栏
14. 添加 i18n keys

### Phase 4: 回归验证

15. 全量功能验证（devMode / normalMode / streaming / 取消 / follow-up）
16. 性能测试（内存 SQLite 开销）

## 风险

1. **内存 SQLite 开销**：每个 execution 一个内存数据库。典型 session 几百条 entries，<1MB。但长 session（1000+ turns）需要验证。GC 策略：settlement 后 5 分钟销毁。

2. **实时性降低**：工具调用组在 flush 前不下发完整内容（但有 tool-progress 轻量进度）。用户体验：看到 "执行中: Read src/..." 而非完整 ToolPanel，直到组完成后切换为完整视图。

3. **回归范围大**：normalizer 变更影响所有 engine type（Claude、Codex、Gemini）。需要逐一适配。

4. **向后兼容**：已有的 issues_logs 数据格式不变。新旧 session 混合加载需兼容。

## 工作量

| Phase | 预估行数 | 文件数 |
|-------|---------|--------|
| Phase 1: 基础设施 | ~400 | 3 new + 1 modify |
| Phase 2: Pipeline | ~300 | 6 modify |
| Phase 3: 前端 | ~400 | 5 modify |
| Phase 4: 测试 | ~300 | 3 new |
| **总计** | **~1400** | **~18** |

## 备选方案

**方案 B — 纯前端映射（不改后端）**：在前端 `useChatMessages` hook 中做分组，不引入内存 SQLite。工作量约 850 行。缺点：无法恢复被 normalizer 丢弃的数据（Read/Glob/Grep），分组质量较低。

**方案 C — 渐进式**：Phase 1-2 先只做后端 ExecutionStore + rebuilder，SSE 暂时仍逐条下发但附加 groupId 标记。前端根据 groupId 做客户端分组。减少一次性改动量但需两阶段部署。

**推荐方案 A**（完整内存数据库 + 重建），一次到位。

## 批注

用户反馈：
- 需要内存 SQLite 对 stdout 做完整消息记录
- 目前过滤太多消息，应先存储再重建
- 不再逐条进入事件引擎，改为重建后下发
- 用户消息保留现有样式，不做右对齐

确认的策略决定：
- **下发策略**：双层（tool-progress 实时 + tool-group 组完成时替换）
- **重建粒度**：混合策略 C
  - 历史 turn：从 issues_logs 读取 → rebuildMessages() → ChatMessage[]
  - 当前 turn：ExecutionStore 内存 SQLite 实时重建
  - Turn settlement 后：批量写入 issues_logs，清除内存数据
- **已批准，开始实施**：2026-03-08 13:30

Phase 1 实施记录（2026-03-08）：
- ✅ `packages/shared/src/index.ts` — 新增 7 种 ChatMessage 变体类型 + ToolProgressEvent/ToolGroupEvent + SSEEventMap 更新
- ✅ `apps/api/src/engines/issue/store/execution-store.ts` — 内存 SQLite 存储，RingBuffer 兼容接口（push/toArray/length），含 append/getByTurn/getToolPairs/getResult/getToolStats/hasEntry/destroy
- ✅ `apps/api/src/engines/issue/store/message-rebuilder.ts` — 纯函数 rebuildMessages(entries, options) → ChatMessage[]，含工具分组、call↔result 配对、TodoWrite→TaskPlan 提取、write filter 隐藏（非丢弃）
- ✅ `apps/api/test/execution-store.test.ts` — 10 个单元测试
- ✅ `apps/api/test/message-rebuilder.test.ts` — 10 个单元测试
- 全部 375 个现有测试不受影响

Phase 2 实施记录（2026-03-08）：
- ✅ `apps/api/src/engines/executors/claude/normalizer.ts` — 移除 write filter 拦截，删除 rules/filteredToolCallIds/isFiltered()，所有工具调用（Read/Glob/Grep）流经 pipeline
- ✅ `apps/api/src/engines/types.ts` — createNormalizer 签名移除 WriteFilterRule 参数
- ✅ `apps/api/src/engines/executors/claude/executor.ts` — createNormalizer() 不再传 filterRules
- ✅ `apps/api/src/engines/issue/utils/normalizer.ts` — createLogNormalizer 从 async 改为 sync，移除 loadFilterRules 依赖
- ✅ `apps/api/src/engines/issue/types.ts` — ManagedProcess.logs 从 RingBuffer 改为 ExecutionStore
- ✅ `apps/api/src/engines/issue/process/register.ts` — 创建 ExecutionStore 替代 RingBuffer
- ✅ `apps/api/src/engines/process-manager.ts` — 新增 onRemove 回调，在 remove() 时触发
- ✅ `apps/api/src/engines/issue/engine.ts` — 注册 onRemove 回调，自动销毁 ExecutionStore
- ✅ `apps/api/test/claude-normalizer.test.ts` — 更新测试：移除过滤预期，改为验证全部保留
- 全部 377 个测试通过（含 Phase 1 新增测试）

Phase 3 实施记录（2026-03-08）：
- ✅ `apps/api/src/engines/issue/utils/visibility.ts` — isVisibleForMode 开放 tool-use（return true），normal mode 下发所有工具调用给前端
- ✅ `apps/api/src/engines/issue/persistence/queries.ts` — SQL 过滤条件新增 tool-use entryType；tool detail 获取不再限 devMode
- ✅ `apps/frontend/src/hooks/use-chat-messages.ts` — 新增 useChatMessages hook，NormalizedLogEntry[] → ChatMessage[] 前端重建（分组/配对/TaskPlan 提取），等价于后端 MessageRebuilder 的前端实现
- ✅ `apps/frontend/src/components/issue-detail/SessionMessages.tsx` — 重写为 ChatMessage 类型驱动渲染：命令式 for 循环 → switch(msg.type) + ChatMessageRow 组件；新增 ToolGroupMessage（折叠/展开 + kind 统计摘要）、FileToolItem/CommandToolItem/GenericToolItem
- 全部 377 个后端测试 + 28 个前端测试通过；TypeScript 编译通过；Vite 构建通过
