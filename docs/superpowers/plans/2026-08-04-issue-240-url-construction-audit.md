# esm.sh URL construction audit (issue #240, Phase 0 / W1)

Evidence for acceptance criterion 1 of `docs/superpowers/specs/2026-08-04-issue-240-phase-0-close-design.md`: *no unversioned dependency URL is ever emitted*.

**Method.** `grep -rln 'esm\.sh/' src/ --include='*.ts' --include='*.tsx'`, excluding `*.test.ts` and `*.generated.ts`, produced 25 files. Each was classified by two questions: can this site receive an unversioned dependency specifier, and does it consult the pin ladder (`isPinningEnabledForRewrite` + `resolveDependencyPinForImport`)?

**Result.** No gap on the live serving path. Three latent sites have no internal caller. Two sites are user-authored override paths that are out of ladder scope by design.

## Honors the ladder

| Site | Evidence |
|---|---|
| `src/transforms/import-rewriter/strategies/bare-strategy.ts:167-192` | Version-selection ladder: inline version → exact `package.json` pin → unversioned fallback with warning. Landed in `#3114`. |
| `src/transforms/import-rewriter/strategies/url-strategy.ts:26-36` | Same ladder applied to esm.sh URLs already written into user source. Landed in this milestone. |
| `src/transforms/import-rewriter/ssr-adapter.ts:266-285` | Calls the pin resolver, inserts the version between package name and subpath, falls back unversioned only when no exact pin exists. |
| `src/server/handlers/dev/files/esbuild-plugins.ts:334-347` | Resolves a pin from `dependencyPinningCacheKey` / `dependencyPinningDependencies` / `dependencyPinningSource` and builds `pkg@version+subpath`, falling back to the raw path. |

The unversioned fallback in the last two is intended, not a gap: a ranged or undeclared dependency is handed to the platform resolver and the render proceeds unversioned until an exact declaration is written back. Blocking a render on resolution was rejected in the Phase 0 design.

## Latent — reachable only from outside the framework

These construct an unversioned URL and do not consult the ladder, but nothing inside `src/` calls them. They cannot be exercised by a realistic serving-path test today, so they are recorded rather than changed; adding pinning to a path with no caller would be untestable speculation.

| Site | Status |
|---|---|
| `src/transforms/esm/import-rewriter.ts:104-108` (`rewriteBareImports`, `rewriteVendorImports`) | Re-exported from `src/transforms/index.ts:20-21` and `src/transforms/esm-transform.ts:10-11`. Only callers are its own test file. **Warns** "Unversioned import may cause reproducibility issues" and then emits the unversioned URL anyway — the ladder was added to the strategy pipeline that superseded it, not here. Recommend deleting in a follow-up rather than pinning: it is a second, weaker copy of a rewriter the strategy pipeline already owns. |
| `src/modules/module-resolver.ts:112-116` | `ModuleResolver` is exported from `src/modules/index.ts:42` but `new ModuleResolver` appears only in `src/modules/module-resolver.test.ts:23`. Emits `https://esm.sh/${specifier}` for any non-relative specifier. Same recommendation. |
| `src/transforms/esm/http-bundler.ts:110-115` | The unversioned fallback sits in a `catch` around `new URL(path, args.importer)`. For a bare specifier with a valid HTTP importer that call succeeds, so the branch is effectively unreachable; it fires only when the importer is not a usable base. |

## Out of ladder scope by design

| Site | Rationale |
|---|---|
| `src/modules/import-map/loader.ts:142-150` | Normalizes `npm:` values inside a user-authored import map. Per the issue's own division of labor, `import-map.json` is the per-specifier URL override escape hatch with standard semantics — an unversioned entry there is a deliberate user instruction, not a floating dependency the platform chose. |
| `src/transforms/esm/specifier-resolver.ts:122-125` | Handles an explicit `npm:` specifier written by the author. `BareStrategy` already normalizes the `npm:` form on the pinned path; this resolver serves the SSR vf-modules and http-cache paths where the specifier is author-supplied. |

## Versioned by construction

No action needed; these never carry a user dependency.

- `src/html/utils.ts` — `esm.sh/veryfront@${v}/...` for chat, markdown, mdx, workflow. Framework-owned, version from the resolved framework ladder.
- `src/routing/api/module-loader/esbuild-plugin.ts` — `esm.sh/react@18/${runtime}`.
- `src/html/html-shell-generator.ts`, `src/server/handlers/preview/markdown-html-generator.ts` — `mermaid@11` / `mermaid@11.4.1?pin=v135`.
- `src/transforms/esm/react-imports.ts`, `src/transforms/mdx/.../framework-validator.ts`, `src/transforms/esm/http-cache-helpers.ts`, `src/transforms/esm/http-cache-types.ts`, `src/modules/import-map/resolver.ts`, `src/modules/import-map/transformer.ts`, `src/modules/react-loader/ssr-module-loader/ssr-cache-manager.ts`, `src/server/services/rsc/endpoints/script-handlers.ts`, `src/transforms/pipeline/stages/ssr-vf-modules/transform.ts` — prefix matching, validation, or React-only construction.
- `src/errors/catalog/config-errors.ts`, `src/errors/catalog/module-errors.ts`, `src/errors/user-friendly/error-catalog.ts` — example strings in error messages, not emission.

## Follow-up recommended, not taken here

Delete `rewriteBareImports` / `rewriteVendorImports` and `ModuleResolver`, or route them through the strategy pipeline. All three are public API surface with no internal caller, and each carries its own divergent copy of specifier-to-URL logic. Leaving them is safe today because nothing in the serving path reaches them, but they are exactly where a future caller would silently reintroduce floating dependencies. Out of scope for this milestone because deleting public exports is a breaking change that needs its own decision.
