# AUDIT-001 升级系统路径穿越漏洞

- **status**: pending
- **priority**: P0
- **severity**: CRITICAL
- **category**: Security

## 位置

- `apps/api/src/upgrade/utils.ts:80`
- 影响: `upgrade/download.ts:44`, `upgrade/apply.ts:166`, `upgrade/files.ts:50`

## 描述

`isPathWithinDir()` 函数仅使用 `startsWith` 检查路径是否在目标目录内：

```typescript
export function isPathWithinDir(filePath: string, dir: string): boolean {
  return filePath.startsWith(`${dir}/`)
}
```

恶意路径如 `/data/updates-evil/file.bin` 可以绕过 `/data/updates` 的路径校验。应使用 `path.resolve()` 规范化路径后再比较。

## 修复方向

使用 `node:path` 的 `resolve()` 规范化两个路径，确保 resolved 路径确实在目标目录下。
