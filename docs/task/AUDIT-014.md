# AUDIT-014 上传文件 originalName 未清洗

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Security

## 位置

- `apps/api/src/uploads.ts:23-26`
- `apps/api/src/routes/issues/attachments.ts:56`

## 描述

上传文件的原始文件名 (`file.name`) 存储时未经清洗，后续在 Content-Disposition header 中 URL-encode 输出。若 originalName 含换行符，可能导致 HTTP header 注入。

## 修复方向

存储前过滤 originalName 中的控制字符（`\r`, `\n`, `\0`）和路径分隔符。
