# Veryfront Scripts

Utility scripts for development, testing, and maintenance.

## Testing Scripts

| Script | Purpose |
|--------|---------|
| **`test-batches.ts`** | Worker-based test runner with memory isolation and concurrency control |
| **`run-tests-isolated.ts`** | Runs tests in complete isolation (one at a time) |
| **`check-test-isolation.ts`** | Validates test isolation and detects shared state issues |
| **`analyze-test-timings.ts`** | Analyzes test execution times to identify slow tests |

## Code Quality Scripts

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
