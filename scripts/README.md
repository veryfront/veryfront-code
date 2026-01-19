# Veryfront Scripts

Utility scripts for development, testing, and maintenance.

## Testing Scripts

| Script | Purpose |
|--------|---------|
| **`run-bun-tests.mjs`** | Runs Bun tests with concurrency defaults |
| **`run-node-tests.mjs`** | Runs Node tests with concurrency defaults |
| **`run-concurrent-tests.mjs`** | Runs Bun + Node tests in parallel with split defaults |
| **`run-affected-tests.mjs`** | Runs tests that match changed files (tight feedback loop) |
| **`test-batches.ts`** | Worker-based test runner with memory isolation and concurrency control |
| **`run-tests-isolated.ts`** | Runs tests in complete isolation (one at a time) |
| **`check-test-isolation.ts`** | Validates test isolation and detects shared state issues |
| **`analyze-test-timings.ts`** | Analyzes test execution times to identify slow tests |

## Code Quality Scripts

## Test Performance Tips

- `VF_TEST_CONCURRENCY` / `BUN_TEST_CONCURRENCY` / `NODE_TEST_CONCURRENCY` control intra-runner parallelism.
- `VF_TEST_CONCURRENCY_TOTAL` caps total CPU usage when running Bun + Node in parallel.
- `VF_TEST_SHARDS` (or `BUN_TEST_SHARDS` / `NODE_TEST_SHARDS`) splits test files across multiple processes.
- `run-concurrent-tests.mjs` auto-sets shard counts when not provided.
- `run-bun-tests.mjs` and `run-node-tests.mjs` auto-shard when no shard env is set.
- `--fast` on the concurrent runner skips heavy integration/AI/rendering suites via excludes.
- `VF_TEST_TIME_SCALE` scales test delays (e.g., `0.25` runs timer-based waits ~4x faster). `run-bun-tests.mjs` and `run-node-tests.mjs` default this to `0.25` unless overridden; `--fast` also sets it.
- `VF_TEST_INCLUDE` lets you run only specific globs (comma-separated). `test:smoke` uses this for sub-1 minute loops.
- `VF_TEST_FAIL_FAST=1` stops sibling runners when one fails (useful for CI).
- `test:loop` uses git status/diff to run affected tests, falling back to `--fast` if none are found.

| Script | Purpose |
|--------|---------|
| **`ban-console.ts`** | Lints for inappropriate console usage in production code |
| **`ban-deep-imports.ts`** | Prevents deep imports from internal modules |
| **`ban-internal-root-imports.ts`** | Prevents imports from src/ root in internal modules |
| **`check-unawaited-promises.ts`** | Detects unawaited promises that could cause issues |

## Test Maintenance Scripts

| Script | Purpose |
|--------|---------|
| **`audit-sanitizers.ts`** | Audits tests for missing resource/ops sanitizers |
| **`fix-sanitizers.ts`** | Automatically fixes sanitizer issues in tests |
| **`rename-test-files.ts`** | Renames test files to follow naming conventions |
| **`consolidate-renderer-tests.ts`** | Consolidates renderer tests into organized structure |

## Documentation & Coverage Scripts

| Script | Purpose |
|--------|---------|
| **`check-doc-links.ts`** | Validates documentation links are not broken |
| **`check-coverage.ts`** | Validates test coverage meets minimum thresholds |
| **`coverage-thresholds.config.ts`** | Coverage threshold configuration |

## Setup Scripts

| Script | Purpose |
|--------|---------|
| **`setup.ts`** | Project setup and initialization |

## Shell Scripts

| Script | Purpose |
|--------|---------|
| **`prepare-release.sh`** | Prepares a new release (version bumping, changelog, etc.) |
| **`build-all.js`** | Builds all project components |
