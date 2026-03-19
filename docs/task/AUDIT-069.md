# AUDIT-069 CI/release workflow actions not pinned to SHA

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Security
- **source**: codex-audit/repo-infra.md
- **created**: 2026-03-19

## Location

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `.github/workflows/launcher.yml`

## Description

GitHub Actions workflows use mutable action tags (`@v2`, `@v5`, `@v6`) and do not pin Bun to a specific version. This is a reproducibility and supply-chain hardening gap — a compromised tag could inject malicious code into CI.

## Fix Direction

Pin all actions to full commit SHA. Pin Bun version explicitly.
