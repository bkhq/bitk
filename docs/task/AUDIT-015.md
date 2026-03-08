# AUDIT-015 工作区路径验证不完整

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Security

## 位置

- `apps/api/src/routes/settings/general.ts:44-59`

## 描述

工作区路径设置仅检查路径是否存在且为目录，但：
- 未检查 symlink（可通过软链接逃逸沙箱）
- 未检查权限（可设置为不可读目录）
- 未验证路径是否为绝对路径

## 修复方向

使用 `fs.realpath()` 解析 symlink，验证路径为绝对路径，检查读取权限。
