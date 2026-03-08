# CRASH-001 BKD 服务崩溃检测与关键日志记录

- **status**: completed
- **priority**: P0
- **owner**: claude
- **created**: 2026-03-08

## 背景

从生产日志分析发现，BKD 服务在运行过程中发生了无日志记录的重启，导致：
- 前端卡在 working 状态
- AI 显示进行中但无任何回应
- stdout 流中断但无法诊断原因

## 目标

添加崩溃检测和关键日志记录，使类似问题可被快速诊断。
