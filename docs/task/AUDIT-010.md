# AUDIT-010 Lock 超时 lockDepth 计算错误

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Bug

## 位置

- `apps/api/src/engines/issue/process/lock.ts:51-53`

## 描述

锁超时时使用 `ctx.lockDepth.get(issueId) ?? 1` 作为默认值递减，与 finally 块中的 `?? 0` 不一致。若 lockDepth 未设置时超时，会被当作 1 递减到 0 后删除，导致 depth 跟踪错乱。

## 修复方向

统一使用 `?? 0` 作为默认值。
