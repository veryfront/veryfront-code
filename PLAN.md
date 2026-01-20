# E2E Testing Plan for Veryfront Project

## Overview

TDD approach to fix the veryfront project E2E tests and add it to the default test suite.

## Status: COMPLETED

All tasks completed. Veryfront now passes all E2E tests and is included in DEFAULT_PROJECTS.

## Tasks

### 1. Setup (Completed)
- [x] Add `test-results/` to `.gitignore`
- [x] Add `playwright-report/` to `.gitignore`

### 2. Verify E2E Infrastructure (Completed)
- [x] Confirm e2e script starts server (`globalSetup` calls `startServer()`)
- [x] Run default e2e tests to establish baseline (13 tests pass)

### 3. Test Veryfront in Isolation (Completed)
```bash
E2E_PROJECT=veryfront npx playwright test --config=tests/e2e/playwright.config.ts
```
- [x] Run tests against `http://veryfront.lvh.me:8080/`
- [x] Captured specific error: `ReactCurrentBatchConfig` undefined

### 4. Fix Renderer Issues (Completed)

**Root Cause**: React version mismatch. esm.sh packages were using `?external=react` but NOT `?external=react-dom`, causing react-dom@18.3.1 to be bundled inside packages while the page used React 19.1.1. React 19 renamed internal APIs (`__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED` → `__CLIENT_INTERNALS_...`), causing the error.

**Files Fixed**:

1. `src/transforms/esm/http-cache.ts` - Fixed `normalizeEsmShUrl()` to externalize both react AND react-dom
2. `src/transforms/esm/http-bundler.ts` - Fixed `bundleHttpImports()` to use `external=react,react-dom`
3. `src/transforms/esm/react-imports.ts` - Fixed `addDepsToEsmShUrls()` to use `external=react,react-dom`
4. `src/html/utils.ts` - Fixed veryfront package URLs to use `external=react,react-dom`
5. `tests/e2e/smoke.spec.ts` - Fixed color_mode tests to use `.first()` for nested HTML elements

### 5. Verify Full Suite (Completed)
- [x] Run all projects: `blank`, `codersociety`, `veryfront`
- [x] All 19 tests pass
- [x] No regressions

### 6. Add Veryfront to Defaults (Completed)
Updated `tests/e2e/smoke.spec.ts`:
```typescript
const DEFAULT_PROJECTS = ["blank", "codersociety", "veryfront"];
```

## Test Commands

| Command | Description |
|---------|-------------|
| `npx playwright test --config=tests/e2e/playwright.config.ts` | Run all projects |
| `E2E_PROJECT=veryfront npx playwright test --config=tests/e2e/playwright.config.ts` | Test veryfront only |
| `DEBUG=1 npx playwright test --config=tests/e2e/playwright.config.ts` | Run with debug logs |

## Files Modified

| File | Purpose |
|------|---------|
| `.gitignore` | Exclude test artifacts |
| `tests/e2e/smoke.spec.ts` | Add veryfront to DEFAULT_PROJECTS, fix HTML selectors |
| `src/transforms/esm/http-cache.ts` | Externalize react-dom for SSR cache |
| `src/transforms/esm/http-bundler.ts` | Externalize react-dom for bundling |
| `src/transforms/esm/react-imports.ts` | Externalize react-dom for esm.sh URLs |
| `src/html/utils.ts` | Externalize react-dom in browser import map |

## Success Criteria (All Met)

1. [x] All e2e tests pass for `blank`, `codersociety`, and `veryfront` (19/19)
2. [x] `veryfront` is included in DEFAULT_PROJECTS
3. [x] No console errors during page load
4. [x] Hydration works correctly
5. [x] Query params (`color_mode`, `studio_embed`, `preview_mode`) work
