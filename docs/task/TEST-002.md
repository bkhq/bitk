# TEST-002 补充 IssueEngine 集成测试

- status: pending
- priority: P1
- owner:
- createdAt: 2026-03-05T12:00:00Z
- updatedAt: 2026-03-05T12:00:00Z

## 描述

审计发现引擎系统最复杂的子系统 — IssueEngine 编排层完全没有自动化测试。ProcessManager 有 38 个单元测试，但编排层（锁、待处理输入队列、auto-retry、settlement、turn-completion）零覆盖。

## 需覆盖场景

### 锁机制
- [ ] `withIssueLock` 基本互斥
- [ ] 锁队列深度溢出（MAX_QUEUE_DEPTH = 10）
- [ ] 锁超时释放

### 并发操作
- [ ] 并发 `terminate()` 幂等性
- [ ] `monitorCompletion` + 手动 `markCompleted` 竞态
- [ ] auto-retry 与用户 followUp 冲突

### 消息队列
- [ ] pendingInputs 排队 + flush
- [ ] flush 失败后消息恢复
- [ ] 多消息合并发送

### Settlement
- [ ] 正常 settlement 流程
- [ ] 进程崩溃时的 settlement
- [ ] 双重 settlement 防护

### ProcessManager 补充
- [ ] `autoCleanupDelayMs: 0` 边界
- [ ] `gcSweep` idle-timeout 和 stall-detection

## 验收标准

- [ ] IssueEngine 编排层测试覆盖率 >= 60%
- [ ] 覆盖所有 HIGH 级别竞态场景
- [ ] 测试可在 CI 中稳定运行（无 flaky test）
