# Import rewrite core design

**Goal:** Collapse import rewrite semantics into one private Module while preserving exact output for transform, SSR, discovery, and route-loading callers.

**Classification:** Broad behavior-preserving architecture cleanup.

**Primary success condition:** All current public and internal entrypoints keep their names, signatures, return types, error behavior, and generated string output. Shared classification, lexer-bounded edits, package export resolution, and path containment move behind a private core under `src/transforms/import-rewriter/`.

## Current evidence

The current implementation spreads import rewrite behavior across several Modules:

- `src/transforms/import-rewriter/unified-rewriter.ts` owns the strategy runner for `rewriteImports` and `UnifiedImportRewriter`.
- `src/transforms/import-rewriter/parse-cache.ts` owns `ModuleLexer` initialization, HTTP URL masking, import parsing, `applyRewrites`, and `replaceSpecifiers`.
- `src/transforms/esm/import-rewriter.ts` owns browser ESM behavior: HMR timestamp query appending, bare import rewrites, Tailwind pinning, project-keyed unversioned warnings, React import maps, and vendor import rewriting.
- `src/transforms/esm/import-attributes.ts` owns lexer-bounded assertion and JSON attribute edits.
- `src/modules/server/ssr-import-rewriter.ts` owns legacy regex SSR rewrites, exact query parameter ordering, per-target cache busters, React runtime behavior, alias rewrites, and relative `.js` rewrites.
- `src/discovery/import-rewriter.ts` owns discovery-time Deno and Node rewrites, Deno `npm:` prefixing, compiled Veryfront globals, Node package export resolution, positive resolution caching, local Veryfront package precedence, runtime fallback, and package escape rejection.
- `src/routing/api/module-loader/external-import-rewriter.ts` owns API route module-loading rewrites for Node, Deno, and compiled binaries, including `NODE_BUILTINS`, the compiled-binary `require` shim, user dependency resolution, ESM-only dependency handling, Deno npm version resolution, and Veryfront runtime shims.

The focused tests already live in:

- `src/transforms/import-rewriter/**/*.test.ts`
- `src/transforms/esm/import-rewriter.test.ts`
- `src/transforms/esm/import-attributes.test.ts`
- `src/modules/server/ssr-import-rewriter.test.ts`
- `src/discovery/import-rewriter.test.ts`
- `src/discovery/import-rewriter.metrics.test.ts`
- `src/discovery/transpiler.test.ts`
- `src/routing/api/module-loader/external-import-rewriter.test.ts`
- `src/routing/api/module-loader/loader.test.ts`
- `src/routing/api/module-loader/loader-helpers.test.ts`

## Architecture problem

Import rewrite behavior has low Locality. A change to specifier classification, package subpath resolution, path containment, or lexer-bounded replacement can drift between transform, SSR, discovery, and route-loading paths.

The desired Module is deeper: callers keep narrow existing Interfaces, while the implementation gains one place for shared mechanics.

## Proposed Module

Create a private Module family under `src/transforms/import-rewriter/`:

- `import-edit.ts`: lexer initialization, HTTP URL masking, parsed import ranges, range-based replacement, and shared attribute range helpers.
- `package-resolution.ts`: package/subpath splitting, package export entry selection, export map resolution, and package containment checks.
- `core.ts`: small transform strategy runner and mode-neutral shared helpers.
- `ssr-adapter.ts`: compatibility Adapter for the exact legacy SSR rewrite order and URL output.
- `route-adapter.ts`: compatibility Adapter for discovery and route module-loading helpers where behavior is truly shared.

Do not export these files through public import maps unless an existing internal path requires an alias. This is a private implementation Module.

## Interfaces to preserve

Keep these existing Interfaces compatible:

- `rewriteImports(code, ctx)` and `UnifiedImportRewriter` in `src/transforms/import-rewriter/unified-rewriter.ts`.
- `addHMRTimestamps`, `rewriteBareImports`, and `rewriteVendorImports` in `src/transforms/esm/import-rewriter.ts`.
- `upgradeImportAssertions` and `stripJsonImportAttributes` in `src/transforms/esm/import-attributes.ts`.
- `applySSRImportRewrites`, `applySSRImportRewritesAsync`, `resolveSSRImportTargetModulePath`, `stripSSRModuleJsExtension`, and `SSRImportRewriteTarget` in `src/modules/server/ssr-import-rewriter.ts`.
- `DISCOVERY_GLOBAL_VERYFRONT_MODULES`, `rewriteForDeno`, and `rewriteDiscoveryImports` in `src/discovery/import-rewriter.ts`.
- `NODE_BUILTINS`, `readProjectDependencies`, `generateCompiledBinaryRequireShim`, `getNodeExternalPackagesToResolve`, `resolveNodePackageToFileUrl`, `resolveEsmUserDependencies`, `loadVeryfrontExportsMap`, `rewriteNodeExternalImports`, `rewriteCompiledBinaryVeryfrontImports`, `rewriteCompiledBinaryUserDependencyImports`, `rewriteDenoNpmDependencyImports`, `rewriteDenoNodeBuiltinImports`, and `rewriteExternalImports` in `src/routing/api/module-loader/external-import-rewriter.ts`.

## Adapter responsibilities

### Transform Adapter

The transform Adapter must preserve:

- `DEFAULT_STRATEGIES` priority sorting exactly as today.
- Caller-provided custom strategy order in `new UnifiedImportRewriter({ strategies })`.
- `parseAllImports`, `applyRewrites`, and `replaceSpecifiers` compatibility through shims.
- HMR timestamp behavior from `addHMRTimestamps`: local specifiers only, `?` uses `&`, existing `?t=` or `&t=` is skipped, and HTTP, `#`, and `veryfront` specifiers are skipped.
- `rewriteBareImports` output, including React import maps, project-keyed warning deduplication, version normalization, and Tailwind pinning through the current `TAILWIND_VERSION` constant.
- `rewriteVendorImports` dynamic, static, side-effect, namespace, named, default, and re-export behavior.
- `AssetStrategy` errors, including user-facing destination and documentation path text.

### SSR Adapter

The SSR Adapter must preserve:

- Rewrite order: bare imports, alias imports, relative `.js` imports.
- Static regex scope limited to `from "..."` and `from '...'` patterns.
- Query order: `?ssr=true`, then `&project=...`, then `&branch=...`, then `&v=...`.
- `cacheBuster` precedence over `resolveCacheBuster`.
- Default cache buster inputs: target kind, module path, rewritten path, project slug, branch, cross-project ref, and React version joined by NUL.
- Alias output such as `@/page` to `/_vf_modules/page.js?ssr=true&...`.
- Cross-project alias output such as `/_vf_modules/_cross/<ref>/@/<path>.js?ssr=true`.
- Relative output such as `./mod.js?ssr=true&...`, while leaving relative imports without `.js` unchanged.
- Runtime-specific React behavior for Deno, Node, and Bun.

The SSR Adapter can keep regex semantics. Converting it to the transform strategy runner is not required for this refactor and risks whitespace, quote, and string-literal drift.

### Route and discovery Adapter

The route/discovery Adapter must preserve:

- Deno discovery behavior:
  - `../` static imports become absolute `file://` URLs.
  - Non-compiled Veryfront imports use `resolveSpecifier` or `import.meta.resolve`.
  - Compiled Veryfront imports use `globalThis.__VERYFRONT_MODULES__`.
  - Static, re-export, dynamic, and side-effect bare npm imports gain `npm:` unless type-only or already URL, file, node, npm, jsr, Veryfront, or relative.
- Node discovery behavior:
  - `../` static imports become `file://` URLs.
  - Package subpaths honor `package.json#exports`, arrays, conditional entries, glob keys, `module`, `main`, and `index.js`.
  - Package export paths that escape the package directory are rejected.
  - Successful package resolutions are cached per project and specifier, but missing packages are not cached.
  - Project-local `node_modules/veryfront` or local Veryfront package exports win over runtime fallback.
  - Invalid local Veryfront export sources block runtime fallback where current behavior does so.
- Route module-loading behavior:
  - Node route rewrites keep `zod` plus user dependency resolution and Veryfront export-map resolution.
  - Deno route rewrites keep `rewriteNpmImports`, node builtin prefixing, installed package version lookup, and compiled-binary divergence.
  - Compiled binary behavior keeps `_vf_runtime.mjs`, `_vf_<subpath>.mjs`, CJS `require` shim compatibility, `__vf_interopDefault`, ESM-only file URL preservation, dynamic import behavior, and path escape rejection.

## Deep Module boundary

The core should expose a small private surface:

```ts
export interface TransformCoreInput {
  code: string;
  context: RewriteContext;
  strategies: ImportRewriteStrategy[];
}

export function rewriteWithImportRewriteCore(input: TransformCoreInput): Promise<string>;
```

The edit and package Modules should expose focused helpers only where an Adapter consumes them. Do not add a public seam for every existing helper.

## Rollback plan

Build the refactor in shippable slices:

1. Add exact-output tests.
2. Extract `import-edit.ts` behind existing `parse-cache.ts` and import attribute shims.
3. Extract `package-resolution.ts` behind discovery and route callers.
4. Move transform execution to `core.ts`.
5. Move SSR internals to `ssr-adapter.ts` behind current exports.
6. Move route/discovery shared helpers to `route-adapter.ts` behind current exports.
7. Delete duplicate private logic only after focused parity tests pass.

Each slice leaves public entrypoints in place, so rollback can revert one Adapter without changing downstream callers.

## Risks

- Regex-to-lexer rewrites can change whitespace, quote style, semicolon retention, or import-looking strings. Keep SSR regex behavior until tests prove exact byte parity.
- Shared classification can accidentally rewrite `import type` or `export type`. Keep type-only coverage.
- HTTP URL masking can shift replacement offsets. Keep tests around HTTP imports and import attributes.
- Package export resolution is security-sensitive. Preserve containment checks and test escape attempts.
- Warning deduplication is global state. Preserve project-keyed deduplication and bounded clearing.
- Generated bundles can include import-looking source strings. Keep tests proving strings are not edited.

## Acceptance criteria

- All listed entrypoints compile and remain callable from their current modules.
- New core tests prove exact output or exact compatibility invariants for transform, SSR, discovery, and route-loading behavior.
- Focused tests pass:

```bash
deno test --no-check --allow-all \
  src/transforms/import-rewriter \
  src/transforms/esm/import-rewriter.test.ts \
  src/transforms/esm/import-attributes.test.ts \
  src/modules/server/ssr-import-rewriter.test.ts \
  src/discovery/import-rewriter.test.ts \
  src/routing/api/module-loader/external-import-rewriter.test.ts
```

- Broader related tests pass:

```bash
deno test --no-check --allow-all \
  src/modules/server/module-server.test.ts \
  src/modules/server/module-batch-handler.test.ts \
  src/discovery/transpiler.test.ts \
  src/routing/api/module-loader/loader.test.ts \
  src/routing/api/module-loader/loader-helpers.test.ts
```

- `git diff --check` passes.
- `deno.json` and `deno.lock` do not gain new dependencies.
