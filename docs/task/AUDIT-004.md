# AUDIT-004 Turn 完成异步结算竞态

- **status**: pending
- **priority**: P0
- **severity**: CRITICAL
- **category**: Race Condition

## 位置

- `apps/api/src/engines/issue/lifecycle/turn-completion.ts:55-194`

## 描述

`handleTurnCompleted()` 通过 `void (async () => { ... })()` 发起异步结算并立即返回。在结算完成前，follow-up 可重新激活 issue。虽有 guard 检查（L133-147），但 `autoMoveToReview()` 可能已执行而 `emitIssueSettled()` 不会触发，导致前端永远收不到 done 事件，停留在 "thinking" 状态。

## 修复方向

结算逻辑应持有 issue lock，或在 guard 检查中同时回滚 `autoMoveToReview` 的效果。
