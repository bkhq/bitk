# FEAT-003 MAX_CONCURRENT_EXECUTIONS 可通过设置配置

- **status**: completed
- **priority**: P2
- **owner**: claude
- **plan**: PLAN-006

## Description

将 `MAX_CONCURRENT_EXECUTIONS` 从环境变量静态常量改为通过设置页面配置、从数据库读取，支持运行时动态修改。

## Acceptance Criteria

- [ ] Settings UI 中可配置最大并发数
- [ ] 值存储在 appSettings 表中
- [ ] 运行时修改立即生效（不需重启）
- [ ] 环境变量作为 fallback，默认值 5
