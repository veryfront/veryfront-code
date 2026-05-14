# React dependency boundary Ralph plan

## Decision

Use `react` as the dependency boundary name. Do not rename `src/` to `core` in
this pass. The repository keeps `src/` as the implementation tree, while
dependency tooling reports the root framework boundary as `core`.

## Goal

Make React dependencies visible separately from core dependencies, keep
extension dependencies segregated, and document how to inspect the resulting
dependency graph.

## Implementation steps

1. Add a `react` boundary to SBOM and dependency-index generation.
2. Parse supported esm.sh import aliases into npm package components.
3. Keep root framework SBOM output as `core.json`.
4. Emit React imports into `react.json`.
5. Emit extension esm.sh imports into the owning extension SBOM.
6. Update focused tests for core, CLI, React, and extension grouping.
7. Update repository docs and extension README dependency-ownership guidance.
8. Run script tests, dependency guards, SBOM generation, formatting checks, and
   diff checks.

## Verification

Run these commands before completion:

```bash
deno test --config=scripts/test.deno.json --no-check --allow-read scripts/build/generate-sbom.test.ts
deno task test:scripts
deno task lint:core-deps
deno task lint:deps
deno task sbom:all --output-dir dist/dependency-sboms-check
deno fmt --check scripts/build/generate-sbom.ts scripts/build/generate-sbom.test.ts scripts/README.md extensions/README.md docs/architecture/08-support-matrix.md docs/superpowers/plans/2026-05-14-react-dependency-boundary.md
git diff --check
```
