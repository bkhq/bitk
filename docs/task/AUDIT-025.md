# AUDIT-025 上传路径泄露到 AI 引擎上下文

- **status**: pending
- **priority**: P3
- **severity**: LOW
- **category**: Information Disclosure

## 位置

- `apps/api/src/routes/issues/message.ts:64`

## 描述

`buildFileContext()` 将附件的 `absolutePath`（如 `/root/app/data/uploads/01aryz6s410c`）包含在发送给 AI 引擎的 prompt 中，泄露服务器文件系统结构。

## 修复方向

使用相对路径或仅传递文件名和内容，不暴露绝对路径。
