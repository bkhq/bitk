# AUDIT-027 全局无速率限制

- **status**: pending
- **priority**: P3
- **severity**: LOW
- **category**: Security

## 位置

- 所有路由

## 描述

无任何 API 端点实现速率限制。可被滥用的场景包括：SSE 端点快速重连、文件上传（10MB/文件、10 文件，无全局配额）、issue ID 枚举。

## 修复方向

对关键端点（SSE、上传、认证相关）添加速率限制中间件。
