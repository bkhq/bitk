# PIPE-002 Release workflow 升级到 Node 24 兼容 actions

- **status**: completed
- **priority**: P1
- **owner**: local
- **created**: 2026-03-12

## Problem

GitHub Actions emitted a deprecation warning in the `Create Release` job because `actions/download-artifact@v4` and `softprops/action-gh-release@v2` are running on Node.js 20. GitHub will switch JavaScript actions to Node.js 24 by default on 2026-06-02.

The same workflow also uses `actions/upload-artifact@v4`, which is likewise still on Node.js 20 and should be upgraded at the same time.

## Solution

1. Upgrade artifact actions in `.github/workflows/release.yml` to Node 24-compatible majors.
2. Leave `softprops/action-gh-release@v2` unchanged for now and remove the temporary Node 24 force flag after the user decided not to enable it yet.

## Files Changed

- `.github/workflows/release.yml`
