# PLAN-021 禁止会话内 follow-up 切换模型

- **task**: ENG-012
- **status**: completed
- **owner**: codex
- **created**: 2026-03-13

## Context

- follow-up 当前允许显式 `model` 覆盖 issue session 中的模型。
- ACP engine 在 follow-up 时会复用已有 `externalSessionId`，再尝试对当前 session 应用新的 model。
- 在多 agent ACP 场景下，这种“会话延续 + 模型切换”语义不稳定，尤其不适合跨 agent 切换。
- 前端 `ChatInput` 仍允许在已有 session 的 issue 上修改模型，容易持续触发这类风险路径。

## Proposal

1. 在 follow-up 路由增加模型切换守卫
2. 对“已有会话且显式模型不同”的请求返回冲突错误，不再进入 follow-up 执行链路
3. 在 ChatInput 中检测已有会话并锁定模型选择
4. 补充 i18n 提示与定向测试

## Risks

- 如果前端仍缓存旧的 `selectedModel`，需要确保切换 issue 时状态及时同步回服务端当前模型。
- 仅靠后端返回错误会导致用户持续试错，因此前端最好同步锁定并提示。
- 这次不扩展 restart 的换模型能力，用户仍需要先完成现有 restart 语义再做后续扩展。

## Scope

- In scope:
  - follow-up 模型切换守卫
  - ChatInput 模型选择锁定
  - i18n 提示
  - 定向 tests / lint
- Out of scope:
  - restart 接受新模型
  - execute 阶段模型选择
  - session schema 变更

## Verification

- follow-up 显式改模型时返回冲突错误
- ChatInput 在已有 session 时禁用模型选择器
- API / frontend 定向 tests 与 lint 通过

## Delivered

- Added a follow-up route guard that rejects model changes once a session already exists
- Locked the issue-detail model picker whenever `externalSessionId` is present
- Stopped the frontend from sending `model` on locked follow-ups and added user-facing hints
- Added a focused API test covering the new `409` conflict path
