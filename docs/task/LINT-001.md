# LINT-001 Migrate from Biome to ESLint + Prettier

- **priority**: P1
- **status**: completed
- **owner**: claude
- **plan**: PLAN-006

## Description

Biome frequently crashes with core dumps (Rust panic → SIGSEGV/SIGABRT). Migrate linting and formatting to ESLint + Prettier for stability.

## Scope

- Remove `@biomejs/biome` and `biome.json`
- Add ESLint v9 (flat config) + Prettier with equivalent rules
- Convert all `biome-ignore` inline comments to `eslint-disable`
- Update scripts in root `package.json`
- Update documentation references
