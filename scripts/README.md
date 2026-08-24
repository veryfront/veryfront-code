# Veryfront Scripts

Utility scripts for build, release, quality, and development.

## Directory Structure

```
scripts/
  build/          # Build & packaging
  codemods/       # Maintainer source migrations
  lint/           # Code quality & architecture checks
  hooks/          # Git hooks
  split-mode/     # Local split-mode debug config
```

Cross-runtime (Node/Bun) test infrastructure lives in `tests/node/` and
`tests/bun/`.

## codemods/

| Script                        | Task           | Purpose                                      |
| ----------------------------- | -------------- | -------------------------------------------- |
| `migrate-chat-composition.ts` | `codemod:chat` | Migrates removed chat compatibility APIs     |

See the [chat composition codemod how-to](./codemods/README.md) before running
the task against an application checkout.

## build/

| Script                           | Task        | Purpose                                             |
| -------------------------------- | ----------- | --------------------------------------------------- |
| `generate-templates-manifest.ts` | `build`     | Generates template manifest for CLI scaffolding     |
| `prepare-framework-sources.ts`   | `build`     | Prepares framework `.src` files for SSR transforms  |
| `build-all.js`                   | n/a         | Cross-compiles CLI binary for all platforms         |
| `build-npm-dnt.ts`               | `build:npm` | Builds the root npm package via dnt and emits generated extension packages |
| `build-npm-extension-packages.ts` | `build:npm` | Builds publishable npm packages declared by first-party extension manifests |

`deno task build:npm` writes the root package to `npm/` and first-party
extension packages to `npm/extensions/<extension-name>/`. The root `veryfront`
package must stay free of feature-specific implementation dependencies. Each
generated `@veryfront/ext-*` package owns the dependencies declared by its
extension manifest. An extension manifest can also declare runtime-specific
leaf packages with narrower dependency sets and without a `veryfront` peer.
Use `veryfront.npm.stagedSources` when a leaf package must bundle a canonical
repository source file without adding the root framework as a dependency.

The React development UI owns its generator under
`extensions/ext-dev-ui-react/scripts/`. Its checked-in browser bundle embeds
the generated stylesheet so JavaScript and CSS are always shipped as one
immutable artifact.

## lint/

| Script                           | Task                             | Purpose                                                                                    |
| -------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| `audit-core-deps.ts`             | `lint:core-deps`                 | Prevents root `npm:` literals and direct third-party imports from leaking into core source |
| `audit-dependency-boundaries.ts` | `lint:dependency-boundaries`     | Fails when generated dependency boundaries put npm packages in core or CLI                 |
| `audit-deps.ts`                  | `lint:deps`                      | Checks dependency import pins across root and extension manifests                          |
| `ban-console.ts`                 | `lint:ban-console`               | Lints for inappropriate console usage                                                      |
| `ban-deep-imports.ts`            | `lint:ban-deep-imports`          | Prevents deep imports from internal modules                                                |
| `ban-internal-root-imports.ts`   | `lint:ban-internal-root-imports` | Prevents root-level imports in internal modules                                            |
| `check-module-boundaries.ts`     | `lint:module-boundaries`         | Ratchets broad imports in sensitive layers and dependency edges that participate in cycles |
| `check-unawaited-promises.ts`    | `lint:check-awaits`              | Detects unawaited async cleanup calls                                                      |
| `ratchet.ts`                     | (library)                        | Shared engine behind the baseline ratchets: walk, predicates, baseline compare, CLI        |
| `find-duplicate-functions.ts`    | `dupes`                          | Finds exact and near-duplicate functions, plus semantic AST-based matches via `--semantic` |
| `lint-platform-agnostic.ts`      | `lint:platform`                  | Checks platform-agnostic code boundaries                                                   |
| `validate-architecture.ts`       | `validate:architecture`          | Validates module dependency boundaries                                                     |
| `check-doc-links.ts`             | `docs:check-links`               | Validates documentation links                                                              |
| `check-coverage.ts`              | `coverage:report`                | Validates test coverage thresholds                                                         |

## Dependency visibility

Use `deno task sbom:all --output-dir dist/dependency-sboms` to generate
segregated CycloneDX SBOMs for core, CLI, React, each extension, and the
aggregate workspace. The same output includes `dependencies-by-manifest.json`,
which is the machine-readable dependency index grouped by boundary, and
`dependency-summary.md`, which is the fastest human-readable view.

`core.json` maps to the root framework boundary (`deno.json` and `src/`).
`react.json` maps to `react/deno.json`, which owns the upstream React, React
DOM, and type package pins. Root `deno.json` maps React specifiers to local
first-party shims in `react/` so core imports stay third-party free. Extension
SBOMs include npm imports from `deno.lock` and supported esm.sh aliases declared
by the extension manifest.

The security audit workflow uploads those files as the `dependency-sboms`
artifact. It includes the JSON SBOMs, `dependencies-by-manifest.json`, and
`dependency-summary.md`. It also runs `lint:deps`, `lint:core-deps`, and
`lint:dependency-boundaries` so dependency pins, source imports, and generated
dependency groups are checked together. CI also runs `lint:extension-contracts`
and `lint:extension-capabilities` to ensure extension manifests use
`veryfront.contracts` instead of contract-shaped capabilities, keep manifest
contract and capability metadata aligned with extension factories, and enforce
explicit capability metadata for sensitive extension boundaries.

## Root-level scripts

| Script                       | Task        | Purpose                                        |
| ---------------------------- | ----------- | ---------------------------------------------- |
| `release.ts`                 | `release`   | Automated release workflow                     |
| `setup.ts`                   | `setup`     | Project setup and initialization               |
| `server.ts`                  | `typecheck` | Entry point for typecheck                      |
| `install.sh` / `install.ps1` | n/a         | Binary installer (curl/PowerShell)             |
| `postinstall.js`             | n/a         | npm postinstall hook (copied into npm package) |
| `update-homebrew-formula.sh` | n/a         | Updates Homebrew formula after release         |

Release jobs run `build/report-artifact-sizes.ts` after npm package and binary
builds. The command writes a Markdown size table to the job summary and does not
enforce a size limit.
