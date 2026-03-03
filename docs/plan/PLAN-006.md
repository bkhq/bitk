# PLAN-006 重构事件引擎：统一事件总线

- status: completed
- task: ENG-008
- owner: claude
- createdAt: 2026-03-03 03:00 UTC
- updatedAt: 2026-03-03 04:00 UTC

## Context

### 现状：3 套独立的 pub/sub 系统

| 系统 | 文件 | 实现方式 | 事件 |
|------|------|----------|------|
| Issue Data Events | `events/issue-events.ts` (26行) | 全局 `Set<Callback>` | `issue-updated` |
| Changes Summary | `events/changes-summary.ts` (134行) | 全局 `Set<Callback>` | `changes-summary` |
| Engine Events | `engines/issue/events.ts` (91行) | EngineContext `Map<id, Callback>` | `log`, `state`, `settled` |

### 问题清单

**1. `emitIssueUpdated` 分散在 7+ 文件中** — 难以审计，容易遗漏

**2. 三套重复的 pub/sub 模式** — 完全相同的订阅/发射/错误吞没模式重复 3 次

**3. 前后端 SSE 事件类型不共享** — 无编译时校验

**4. Engine 事件绑定在 EngineContext** — 职责不单一

**5. Log entry 数据流碎片化导致信息丢失**
```
persistEntry() → if FAIL → buffer only, NO SSE  ❌
handleStderrEntry: persistEntry() → if FAIL → 完全丢失！ ❌
```

**6. 过滤逻辑处理两次**
- `emitLog()` 内部做 DevMode 过滤
- `handleStreamEntry()` 做 streaming/meta-turn 预处理
- 两处不同位置做不同层面的过滤，分散且难以扩展

## Proposal

### 核心思路：单一流 + middleware + 有序订阅者

**去掉两层事件。** 所有过滤、处理、转发都在同一条流上完成。每个事件只走一次管道，过滤只执行一次。

```
appEvents.emit('log', { issueId, executionId, entry, streaming })
  │
  ├─ [middleware] devMode 过滤 — 返回 false 终止
  │
  ├─ [order:10] DB 持久化 — 非 streaming 写 DB，赋 messageId
  ├─ [order:20] Ring buffer — 推入内存缓冲
  ├─ [order:30] 自动标题 — meta turn 时提取
  ├─ [order:40] 逻辑失败检测
  └─ [order:100] SSE 转发 — writeSSE({ issueId, entry }) 只取需要的字段
```

SSE route 只是最高 order 的普通订阅者。Bus 内部数据比 SSE 线上数据更丰富（有 executionId、streaming 等），SSE 订阅者只挑选前端需要的字段发送。

### 架构图

```
@bitk/shared
  ├── SSEEventMap — SSE 线上格式 (前端用)
  └── AppEventMap — 总线内部格式 (后端用，SSEEventMap 的超集)

apps/api/src/events/
  ├── event-bus.ts — AppEventBus (middleware + ordered subscribers)
  ├── index.ts — appEvents 单例 + pipeline 注册
  └── changes-summary.ts — git 逻辑保留, emit 改用 bus

apps/api/src/engines/issue/
  ├── pipeline.ts — 注册 log 管道全部订阅者 (NEW)
  ├── events.ts — 简化为薄 emit helpers
  ├── streams/handlers.ts — 简化为 normalize + emit
  └── context.ts — 移除回调字段

apps/api/src/routes/events.ts — SSE 纯转发 (order:100 订阅者)
```

### Step 1: 共享类型 (`packages/shared/src/index.ts`)

```typescript
export interface ChangesSummary {
  issueId: string
  fileCount: number
  additions: number
  deletions: number
}

// SSE 线上格式 — 前端按这个 parse
export interface SSEEventMap {
  'log': { issueId: string; entry: NormalizedLogEntry }
  'state': { issueId: string; executionId: string; state: string }
  'done': { issueId: string; finalStatus: string }
  'issue-updated': { issueId: string; changes: Record<string, unknown> }
  'changes-summary': ChangesSummary
  'heartbeat': { ts: string }
}

// 总线内部格式 — 后端 pipeline 用，是 SSEEventMap 的超集
export interface AppEventMap {
  'log': {
    issueId: string
    executionId: string
    entry: NormalizedLogEntry
    streaming: boolean
  }
  'state': { issueId: string; executionId: string; state: string }
  'done': { issueId: string; executionId: string; finalStatus: string }
  'issue-updated': { issueId: string; changes: Record<string, unknown> }
  'changes-summary': ChangesSummary
  'heartbeat': { ts: string }
}
```

### Step 2: AppEventBus (`apps/api/src/events/event-bus.ts`)

~60 行，支持 middleware + 有序订阅者，单条流：

```typescript
type Callback<T> = (data: T) => void
type Middleware<T> = (data: T) => boolean  // false = 终止

interface SubscriberEntry {
  order: number
  callback: Callback<unknown>
}

class AppEventBus {
  private subscribers = new Map<string, SubscriberEntry[]>()
  private middlewares = new Map<string, Middleware<unknown>[]>()
  private sorted = new Map<string, boolean>()  // dirty flag

  on<K extends keyof AppEventMap>(
    event: K,
    cb: Callback<AppEventMap[K]>,
    opts?: { order?: number },
  ): () => void

  use<K extends keyof AppEventMap>(
    event: K,
    fn: Middleware<AppEventMap[K]>,
  ): () => void

  emit<K extends keyof AppEventMap>(event: K, data: AppEventMap[K]): void {
    // 1. middleware chain — 任何返回 false 终止整个事件
    // 2. subscribers 按 order 升序执行
    // 3. 每个 subscriber 独立 try/catch
  }
}
```

### Step 3: Log Pipeline (`engines/issue/pipeline.ts`)

将 `handleStreamEntry` 的 ~100 行拆分为独立订阅者：

```typescript
export function registerLogPipeline(ctx: EngineContext): void {

  // ── Middleware: DevMode 过滤 (唯一一次) ────────────────
  appEvents.use('log', (data) =>
    isVisibleForMode(data.entry, getIssueDevMode(data.issueId))
  )

  // ── Order 10: DB 持久化 ────────────────────────────────
  appEvents.on('log', (data) => {
    if (data.streaming) return
    const persisted = persistEntry(ctx, data.issueId, data.executionId, data.entry)
    if (persisted) {
      Object.assign(data.entry, persisted)  // 丰富 messageId
      handleToolDetail(ctx, data)
    }
    // DB 失败不阻断后续 — ring buffer 和 SSE 照常运行
  }, { order: 10 })

  // ── Order 20: Ring Buffer ──────────────────────────────
  appEvents.on('log', (data) => {
    if (data.streaming) return
    const managed = ctx.pm.get(data.executionId)?.meta
    if (managed) managed.logs.push(data.entry)
  }, { order: 20 })

  // ── Order 30: 自动标题 ─────────────────────────────────
  appEvents.on('log', (data) => {
    const managed = ctx.pm.get(data.executionId)?.meta
    if (managed?.metaTurn && data.entry.entryType === 'assistant-message') {
      applyAutoTitle(data.issueId, data.entry.content)
    }
  }, { order: 30 })

  // ── Order 40: 逻辑失败检测 ─────────────────────────────
  appEvents.on('log', (data) => {
    if (data.streaming) return
    const managed = ctx.pm.get(data.executionId)?.meta
    if (!managed || managed.cancelledByUser) return
    const entry = data.entry
    const resultSubtype = entry.metadata?.resultSubtype
    const isError =
      (typeof resultSubtype === 'string' && resultSubtype !== 'success') ||
      entry.metadata?.isError === true
    if (isError) {
      dispatch(managed, {
        type: 'SET_LOGICAL_FAILURE',
        reason: (entry.metadata?.error as string) ?? String(resultSubtype ?? 'unknown'),
      })
    }
  }, { order: 40 })
}
```

SSE route 注册 order:100 订阅者（见 Step 6）。

### Step 4: handleStreamEntry 简化

从 ~100 行变为 ~25 行：

```typescript
export function handleStreamEntry(
  ctx: EngineContext, issueId: string, executionId: string,
  entry: NormalizedLogEntry,
): void {
  const managed = ctx.pm.get(executionId)?.meta
  if (!managed) return

  // 唯一的预处理：meta-turn 标记
  const effectiveEntry =
    managed.metaTurn && entry.entryType === 'assistant-message'
      ? { ...entry, metadata: { ...entry.metadata, type: 'system' } }
      : entry

  const streaming = effectiveEntry.metadata?.streaming === true

  // 进入管道 — 过滤、持久化、缓存、SSE 全部由订阅者处理
  appEvents.emit('log', {
    issueId,
    executionId,
    entry: streaming
      ? { ...effectiveEntry, content: effectiveEntry.content.trim() }
      : effectiveEntry,
    streaming,
  })
}
```

`handleStderrEntry` 和 `handleStreamError` 同样简化为一行 emit。

### Step 5: 迁移 state / done / issue-updated

这些事件不需要处理管道，直接改为 `appEvents.emit()`：

| 原调用 | 新调用 |
|--------|--------|
| `emitIssueUpdated(issueId, changes)` (7处) | `appEvents.emit('issue-updated', { issueId, changes })` |
| `emitStateChange(ctx, issueId, execId, state)` | `appEvents.emit('state', { issueId, executionId, state })` |
| `emitIssueSettled(ctx, issueId, execId, state)` | `appEvents.emit('done', { issueId, executionId, finalStatus: state })` |

`settleIssue()` 保持命令式（DB→review→cleanup→emit），只是 emit 改走 bus。

### Step 6: SSE 路由简化

```typescript
events.get('/', async (c) => {
  return streamSSE(c, async (stream) => {
    const writeEvent = (event: string, data: unknown) => { ... }

    // 所有事件都是 bus 的 order:100 订阅者
    const unsubs = [
      appEvents.on('log', (d) =>
        writeEvent('log', { issueId: d.issueId, entry: d.entry }),
        { order: 100 },
      ),
      appEvents.on('state', (d) => writeEvent('state', d), { order: 100 }),
      appEvents.on('done', (d) =>
        writeEvent('done', { issueId: d.issueId, finalStatus: d.finalStatus }),
        { order: 100 },
      ),
      // done 同时也发一个 state 事件给前端
      appEvents.on('done', (d) =>
        writeEvent('state', { issueId: d.issueId, executionId: d.executionId, state: d.finalStatus }),
        { order: 100 },
      ),
      appEvents.on('issue-updated', (d) => writeEvent('issue-updated', d), { order: 100 }),
      appEvents.on('changes-summary', (d) => writeEvent('changes-summary', d), { order: 100 }),
    ]
    // heartbeat + cleanup
  })
})
```

### Step 7: EngineContext / IssueEngine 清理

- EngineContext 移除: `logCallbacks`, `stateChangeCallbacks`, `issueSettledCallbacks`, `nextCallbackId`
- IssueEngine 的 `onLog/onStateChange/onIssueSettled` 改为代理 `appEvents.on()`

### Step 8: 前端使用共享类型

- `event-bus.ts` — `JSON.parse(e.data) as SSEEventMap['log']` 代替手动断言
- `ChangesSummaryData` → `ChangesSummary` from `@bitk/shared`
- 连接管理（重连、心跳）不动

### Step 9: 验证

- `bun run test:api` + `bun run test:frontend` + `bun run lint`

## Risks

| 风险 | 严重度 | 缓解措施 |
|------|--------|----------|
| Log 处理顺序变化 | 中 | order 严格对应当前代码顺序 |
| DB 失败后 SSE 推送无 messageId | 低 | 前端 dedup 已处理无 messageId entry |
| IssueEngine API 兼容性 | 低 | 保持方法签名 |

## Scope

**~20 文件:**

| 操作 | 文件 |
|------|------|
| NEW | `apps/api/src/events/event-bus.ts` |
| NEW | `apps/api/src/events/index.ts` |
| NEW | `apps/api/src/engines/issue/pipeline.ts` |
| DELETE | `apps/api/src/events/issue-events.ts` |
| MODIFY | `packages/shared/src/index.ts` |
| MODIFY | `apps/api/src/events/changes-summary.ts` |
| MODIFY | `apps/api/src/engines/issue/events.ts` |
| MODIFY | `apps/api/src/engines/issue/context.ts` |
| MODIFY | `apps/api/src/engines/issue/engine.ts` |
| MODIFY | `apps/api/src/engines/issue/streams/handlers.ts` |
| MODIFY | `apps/api/src/engines/issue/lifecycle/settle.ts` |
| MODIFY | `apps/api/src/engines/issue/lifecycle/completion-monitor.ts` |
| MODIFY | `apps/api/src/engines/issue/lifecycle/turn-completion.ts` |
| MODIFY | `apps/api/src/engines/engine-store.ts` |
| MODIFY | `apps/api/src/routes/events.ts` |
| MODIFY | `apps/api/src/routes/issues/update.ts` |
| MODIFY | `apps/api/src/routes/issues/_shared.ts` |
| MODIFY | `apps/api/src/engines/reconciler.ts` |
| MODIFY | `apps/api/src/engines/issue/title.ts` |
| MODIFY | `apps/frontend/src/lib/event-bus.ts` |
| MODIFY | `apps/frontend/src/hooks/use-changes-summary.ts` |

**不包含:** 前端连接管理、use-issue-stream dedup/pagination、事件名保持兼容
