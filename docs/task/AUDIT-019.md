# AUDIT-019 Execute/FollowUp 模型名正则不一致

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Consistency

## 位置

- `apps/api/src/routes/issues/_shared.ts:61,70`

## 描述

`executeIssueSchema` 使用 `/^[\w.-]{1,100}$/` 验证模型名，而 `followUpSchema` 使用 `/^[\w.\-[\]]{1,100}$/`（多了方括号 `[]`）。验证标准不统一，可能导致某些模型名在 execute 时被拒绝但在 follow-up 时被接受。

## 修复方向

统一两处正则表达式。
