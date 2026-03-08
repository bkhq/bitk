# STALL-001 stdout 断裂后 fallback 到 transcript JSONL

- **status**: completed
- **priority**: P1
- **owner**: claude
- **plan**: PLAN-006

## 描述

Claude CLI 的 stdout pipe 偶发性异常关闭（进程仍存活但 stdout ReadableStream 返回 done=true），
导致 BKD 的 consumeStream 提前结束，引发 9 分钟的 stall detection 才能 settle。

## 需求

1. 保留 stdout pipe 作为主通道（零延迟）
2. stdout 断裂时（consumeStream 结束但进程仍存活），fallback 到 tail transcript JSONL 补齐缺失条目
3. transcript 处理完后主动 settle（不等 stall detection 的 9 分钟超时）
