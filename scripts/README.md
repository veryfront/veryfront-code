# Veryfront Scripts

Utility scripts for build, release, quality, and development.

## Directory Structure

```
scripts/
  build/          # Build & packaging
  lint/           # Code quality & architecture checks
  hooks/          # Git hooks
  split-mode/     # Local split-mode debug config
  batch-simplify/ # Batch AI simplification tooling
  rlm-ts/         # RLM tooling
```

Cross-runtime (Node/Bun) test infrastructure lives in `tests/node/` and `tests/bun/`.

## build/

| Script | Task | Purpose |
|--------|------|---------|
| `generate-templates-manifest.ts` | `build` | Generates template manifest for CLI scaffolding |
| `generate-dev-ui-manifest.ts` | `build` | Generates dev UI asset manifest |
| `prepare-framework-sources.ts` | `build` | Prepares framework `.src` files for SSR transforms |
| `build-all.js` | — | Cross-compiles CLI binary for all platforms |
| `build-npm-dnt.ts` | `build:npm` | Builds npm package via dnt (Deno-to-Node transform) |

## lint/

| Script | Task | Purpose |
|--------|------|---------|
| `ban-console.ts` | `lint:ban-console` | Lints for inappropriate console usage |
| `ban-deep-imports.ts` | `lint:ban-deep-imports` | Prevents deep imports from internal modules |
| `ban-internal-root-imports.ts` | `lint:ban-internal-root-imports` | Prevents root-level imports in internal modules |
| `check-unawaited-promises.ts` | `lint:check-awaits` | Detects unawaited async cleanup calls |
| `find-duplicate-functions.ts` | `dupes` | Finds exact and near-duplicate functions, plus semantic AST-based matches via `--semantic` |
| `lint-platform-agnostic.ts` | `lint:platform` | Checks platform-agnostic code boundaries |
| `validate-architecture.ts` | `validate:architecture` | Validates module dependency boundaries |
| `check-doc-links.ts` | `docs:check-links` | Validates documentation links |
| `check-coverage.ts` | `coverage:report` | Validates test coverage thresholds |

## Root-level scripts

| Script | Task | Purpose |
|--------|------|---------|
| `release.ts` | `release` | Automated release workflow |
| `setup.ts` | `setup` | Project setup and initialization |
| `server.ts` | `typecheck` | Entry point for typecheck |
| `install.sh` / `install.ps1` | — | Binary installer (curl/PowerShell) |
| `postinstall.js` | — | npm postinstall hook (copied into npm package) |
| `update-homebrew-formula.sh` | — | Updates Homebrew formula after release |
| `debug-production.sh` | — | Quick production debugging helper |
| `test-production-fix.ts` | — | Tests production fixes locally |
