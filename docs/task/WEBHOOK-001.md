# WEBHOOK-001 完善 Webhook 通知元信息

- **status**: completed
- **priority**: P1
- **owner**:
- **plan**: `PLAN-002`
- **created**: 2026-03-08

## 描述

当前 webhook 通知 payload 缺少关键元信息（项目名、标题、编号、URL、最后日志等），状态变更通知过于频繁，且 channel 类型可被修改导致配置错乱。

## 需求

1. 丰富所有事件 payload：增加 `projectName`, `title`, `issueNumber`, `issueUrl`（通过 `BKD_EXTERNAL_URL` 环境变量配置）
2. `session.failed` 附带最后一条 agent 日志（`lastLog`）
3. `issue.status_changed` 仅在目标状态为 `todo`, `review`, `done` 时分发；review 时附带"会话已完成"提示
4. Webhook channel 类型创建后不可修改

## 验收标准

- [ ] 所有事件 payload 包含 projectName, title, issueNumber
- [ ] 配置 BKD_EXTERNAL_URL 后 payload 包含 issueUrl
- [ ] session.failed 包含 lastLog（截断 500 字符）
- [ ] status_changed 仅 todo/review/done 触发，working 不触发
- [ ] review 状态 Telegram 消息显示"会话已完成"
- [ ] PATCH webhook 不允许修改 channel 类型
- [ ] 前端编辑模式隐藏 channel 选择器
