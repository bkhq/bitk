# PLAN-004 历史消息分页按会话消息计数

- **status**: completed
- **task**: CHAT-003
- **owner**: claude

## 背景

当前 `getLogsFromDb` 用 SQL `LIMIT` 对所有可见条目统一计数。limit=30 可能返回 25 个 tool-use + 5 个 user/assistant，用户体验差。

用户需求：分页按会话消息（user-message + assistant-message）计数，但返回范围内所有可见条目。

## 方案

**两步查询法**：

### Step 1: 查找会话消息边界

```sql
SELECT id FROM issueLogs
WHERE issueId=? AND visible=1
  AND (entryType='user-message' AND metadata.type != 'system')
      OR entryType='assistant-message')
  [AND id < before_cursor]  -- reverse mode
  [AND id > cursor]         -- forward mode
ORDER BY id DESC/ASC
LIMIT limit+1               -- +1 for hasMore detection
```

取 limit+1 个会话消息 ID。若结果数 > limit → hasMore=true。

### Step 2: 获取范围内所有可见条目

用第 limit 个会话消息 ID 作为边界：

- **Reverse mode**: `id >= boundary_id [AND id < before_cursor]`
- **Forward mode**: `id > cursor [AND id <= boundary_id]`
- **No hasMore**: 无下界限制

无 LIMIT（边界已约束范围），返回全部可见条目。

### 返回值变更

`getLogsFromDb` 返回类型从 `NormalizedLogEntry[]` 改为：

```typescript
interface PaginatedLogResult {
  entries: NormalizedLogEntry[]
  hasMore: boolean
}
```

传播到 `getLogs` → `IssueEngine.getLogs` → route handler。

Route handler 不再做 "fetch limit+1, trim" 逻辑，直接使用返回的 hasMore。nextCursor 从 entries 首/尾条目计算。

### nextCursor 逻辑

- **Reverse**: `nextCursor = entries[0].messageId`（最老条目），客户端传 `before: nextCursor`
- **Forward**: `nextCursor = entries[entries.length-1].messageId`，客户端传 `cursor: nextCursor`

## 修改文件

| 文件 | 变更 |
|------|------|
| `apps/api/src/engines/issue/persistence/queries.ts` | getLogsFromDb 两步查询 + 新返回类型 |
| `apps/api/src/engines/issue/queries.ts` | getLogs 返回 PaginatedLogResult |
| `apps/api/src/engines/issue/engine.ts` | IssueEngine.getLogs 签名 |
| `apps/api/src/routes/issues/logs.ts` | 使用 result.hasMore，移除 trim 逻辑 |

## 风险

- 两次 SQL 查询略增延迟（可忽略，SQLite 本地查询 <1ms）
- 极端情况：两个会话消息间有数千 tool-use → 返回大量条目。加安全上限 2000 条。
