# Changelog

## 2026-03-08 10:30 [progress]

**CRASH-002**: 修复永久卡死根本原因 + Issue 级别诊断日志

修复 4 个根因：
- `gc.ts`: GC sweep active process 循环加 per-entry try-catch，单个 entry 异常不再中断整个循环
- `turn-completion.ts`: catch 块内 DB 更新失败时记录日志而非静默丢弃；follow-up 分发时记录 debug 日志
- `lock.ts`: 执行超时时记录 error 日志；lock 持有超过 30s 记录 warn 日志
- `constants.ts`: stall 检测总时间从 10min 缩短到 6min（3+5+2 → 2+2+2）

Issue 级别诊断日志（`[BKD]` 前缀，持久化到 issueLogs，前端可见）：
- 新增 `diagnostic.ts`: `emitDiagnosticLog()` 工具函数，发出 `system-message` (subtype=diagnostic) 类型的日志条目
- `visibility.ts`: 诊断日志条目默认可见（non-dev 模式）
- `execute.ts`: 进程 spawn 成功/失败时记录
- `spawn.ts`: follow-up spawn 成功/失败/session recreate 时记录
- `completion-monitor.ts`: 进程退出（含 exit code/signal）、auto-retry 时记录
- `settle.ts`: issue settled 时记录
- `gc.ts`: stall 检测各阶段（detected → probe → force kill / process dead）记录

Per-issue debug 文件日志：
- 新增 `debug-log.ts`: `IssueDebugLog` 类 + `teeStreamToDebug()` 流分流函数
- `types.ts`: `ManagedProcess` 新增 `debugLog` 字段
- `register.ts`: 进程注册时创建 debug log，tee stdout/stderr 原始数据到 `data/logs/issues/<issueId>/debug.log`
- `executor.ts`: Claude Code 启动时添加 `--debug` 标志，输出到 `data/logs/issues/<issueId>/claude-debug.log`
- 每个 issue 生成两个 debug 文件：
  - `debug.log` — BKD 侧的原始 I/O（每行带时间戳 + stdout/stderr/event 标签）
  - `claude-debug.log` — Claude Code CLI 内部 debug 输出（API 调用、工具执行等）

## 2026-03-08 09:30 [progress]

**CRASH-001**: 添加崩溃检测与关键日志记录

- `index.ts`: 添加 `uncaughtException` + `unhandledRejection` 全局处理器；shutdown 记录活跃进程数和 uptime；重复信号处理日志
- `engine.ts`: GC sweep 调用包裹 try-catch，防止异常导致 stall detection 静默失效
- `consumer.ts`: stdout 流正常/异常结束记录日志；stderr catch 块不再静默丢弃错误
- `process-manager.ts`: 子进程退出记录 pid/exitCode/prevState；forceKill/SIGKILL 发送记录日志；stateChange/exit handler 异常记录日志
- `register.ts`: 流消费 promise resolve/reject 记录日志
