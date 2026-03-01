# PLAN-003 将 Drizzle 迁移目录和配置移入 apps/api

- **status**: completed
- **createdAt**: 2026-03-01 01:00
- **approvedAt**: 2026-03-01 01:00
- **relatedTask**: ENG-007

## 现状

`drizzle/` 和 `drizzle.config.ts` 在 monorepo 根目录，`drizzle-kit` 也在根 devDependencies。迁移路径在 `apps/api/src/db/index.ts` 和 `scripts/compile.ts` 中硬编码为 `resolve(ROOT_DIR, 'drizzle')`。

## 方案

1. `git mv drizzle/ apps/api/drizzle/` + `git mv drizzle.config.ts apps/api/drizzle.config.ts`
2. 更新 `apps/api/drizzle.config.ts` 中的 schema/dbCredentials 相对路径
3. `apps/api/package.json` 添加 `db:generate`/`db:migrate` 脚本 + `drizzle-kit` devDep
4. 根 `package.json` 改为 `bun --filter @bitk/api db:*` proxy，移除 `drizzle-kit`
5. `apps/api/src/db/index.ts:32` — `resolve(ROOT_DIR, 'apps/api/drizzle')`
6. `scripts/compile.ts:32` — `resolve(ROOT, 'apps/api/drizzle')`
7. 更新 `CLAUDE.md` 目录结构

## 风险

- 路径错误会导致启动失败（迁移找不到），但立即可发现
- 编译模式需同步更新 compile.ts

## 工作量

7 个文件修改，0 个新文件，纯路径重构。

## 批注

用户确认 proceed。
