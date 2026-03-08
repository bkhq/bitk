# AUDIT-024 Worktree 清理批次上限静默截断

- **status**: pending
- **priority**: P3
- **severity**: LOW
- **category**: Reliability

## 位置

- `apps/api/src/jobs/worktree-cleanup.ts:40,68`

## 描述

清理使用 `MAX_BATCH = 500` 限制 SQLite 变量数。超过 500 个项目目录时静默截断 (`slice(0, MAX_BATCH)`)，无日志提示。30 分钟间隔下，大量 worktree 清理可能延迟数小时。

## 修复方向

添加截断日志警告，或分批循环处理直到清理完毕。
