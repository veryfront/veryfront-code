# Import Rewrite Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private import rewrite semantic core and route transform, SSR, discovery, and route-loading callers through compatibility Adapters without changing exact output.

**Architecture:** Add shared edit and package-resolution Modules under `src/transforms/import-rewriter/`, then convert existing public entrypoints into thin compatibility Adapters. The Module is deep: callers keep current Interfaces while classification, replacement, package export resolution, and containment behavior gain Locality.

**Tech Stack:** TypeScript, Deno, `#veryfront/testing/bdd.ts`, `#veryfront/testing/assert.ts`, existing `ModuleLexer`, existing filesystem and path adapters.

## Global Constraints

- Preserve public API compatibility and existing import map exports.
- Preserve exact generated strings for current rewrite functions.
- No new dependencies.
- Add focused failing regression tests before cleanup edits.
- Prefer deletion and reuse over new layers.
- Keep transform, SSR, discovery, and route-loading Adapters independently releasable.
- Keep public copy free of local absolute paths and secrets.

---

## File structure

- Create: `src/transforms/import-rewriter/import-edit.ts`
  - Own lexer initialization, HTTP URL masking, parsed import ranges, range-based replacement, and shared import attribute range helpers.
- Create: `src/transforms/import-rewriter/package-resolution.ts`
  - Own package/subpath splitting, export entry selection, export map resolution, and package containment checks.
- Create: `src/transforms/import-rewriter/core.ts`
  - Own the private transform strategy runner and shared orchestration helpers.
- Create: `src/transforms/import-rewriter/core.test.ts`
  - Lock exact-output and compatibility invariants for transform, SSR, discovery, and route-loading behavior.
- Create: `src/transforms/import-rewriter/ssr-adapter.ts`
  - Own the legacy SSR rewrite implementation behind compatibility exports.
- Create: `src/transforms/import-rewriter/route-adapter.ts`
  - Own shared route/discovery helper implementations that can move without changing public entrypoints.
- Modify: `src/transforms/import-rewriter/parse-cache.ts`
  - Delegate to `import-edit.ts` while preserving current exports.
- Modify: `src/transforms/import-rewriter/unified-rewriter.ts`
  - Delegate strategy execution to `core.ts`.
- Modify: `src/transforms/esm/import-rewriter.ts`
  - Reuse core edit helpers through existing shims, while preserving browser ESM behavior.
- Modify: `src/transforms/esm/import-attributes.ts`
  - Reuse import edit range helpers while preserving assertion and JSON stripping behavior.
- Modify: `src/modules/server/ssr-import-rewriter.ts`
  - Keep public names as shims to `ssr-adapter.ts`.
- Modify: `src/discovery/import-rewriter.ts`
  - Reuse package-resolution helpers and shared route helpers while preserving discovery entrypoints.
- Modify: `src/routing/api/module-loader/external-import-rewriter.ts`
  - Keep public names as shims or wrappers over route-adapter helpers.

---

### Task 1: Add baseline parity and golden coverage

**Files:**
- Create: `src/transforms/import-rewriter/core.test.ts`
- Modify: `src/transforms/esm/import-rewriter.test.ts`
- Modify: `src/modules/server/ssr-import-rewriter.test.ts`
- Modify: `src/discovery/import-rewriter.test.ts`
- Modify: `src/routing/api/module-loader/external-import-rewriter.test.ts`

**Interfaces:**
- Consumes: current public rewrite functions.
- Produces: exact-output or exact-invariant tests that must pass before refactor code moves.

- [ ] **Step 1: Create the cross-surface golden test file**

Create `src/transforms/import-rewriter/core.test.ts`:

```ts
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { applySSRImportRewrites, applySSRImportRewritesAsync } from "#veryfront/modules/server/ssr-import-rewriter.ts";
import { rewriteDiscoveryImports, rewriteForDeno } from "#veryfront/discovery/import-rewriter.ts";
import { addHMRTimestamps, rewriteBareImports } from "#veryfront/transforms/esm/import-rewriter.ts";
import { TAILWIND_VERSION } from "#veryfront/transforms/import-rewriter/url-builder.ts";
import { stripJsonImportAttributes, upgradeImportAssertions } from "#veryfront/transforms/esm/import-attributes.ts";
import {
  rewriteCompiledBinaryUserDependencyImports,
  rewriteCompiledBinaryVeryfrontImports,
  rewriteDenoNodeBuiltinImports,
  rewriteDenoNpmDependencyImports,
} from "#veryfront/routing/api/module-loader/external-import-rewriter.ts";

describe("import rewrite compatibility golden tests", () => {
  it("preserves transform query and attribute output", async () => {
    assertEquals(
      await addHMRTimestamps(`import m from "./mod.js?v=1";`, "222"),
      `import m from "./mod.js?v=1&t=222";`,
    );
    assertEquals(
      await upgradeImportAssertions(`import data from "./a.json" assert { type: "json" };`),
      `import data from "./a.json" with { type: "json" };`,
    );
    assertEquals(
      await stripJsonImportAttributes(`import data from "./a.mjs" with { type: "json" };`, () => true),
      `import data from "./a.mjs";`,
    );
  });

  it("preserves browser bare rewrite output shape", async () => {
    assertEquals(
      await rewriteBareImports(`import tw from "tailwindcss";`, undefined, "19.1.1", "p1"),
      `import tw from "https://esm.sh/tailwindcss@${TAILWIND_VERSION}?external=react&target=es2022";`,
    );
  });

  it("preserves SSR exact query byte ordering", async () => {
    assertEquals(
      applySSRImportRewrites(`import X from "@/page";`, {
        projectSlug: "demo",
        branch: "main",
        cacheBuster: "abc",
      }),
      `import X from "/_vf_modules/page.js?ssr=true&project=demo&branch=main&v=abc";`,
    );
    assertEquals(
      await applySSRImportRewritesAsync(`import X from "@/page";`, {
        resolveCacheBuster: () => "resolved",
      }),
      `import X from "/_vf_modules/page.js?ssr=true&v=resolved";`,
    );
  });

  it("preserves Deno discovery rewrites", () => {
    const out = rewriteForDeno(
      [
        `import { tool } from "veryfront/tool";`,
        `import "reflect-metadata";`,
        `export { z } from "zod";`,
        `import type { ZodSchema } from "zod";`,
      ].join("\n"),
      "/project/tools",
      { compiled: true },
    );
    assertStringIncludes(out, `globalThis.__VERYFRONT_MODULES__["veryfront/tool"]`);
    assertStringIncludes(out, `import "npm:reflect-metadata"`);
    assertStringIncludes(out, `export { z } from "npm:zod"`);
    assertStringIncludes(out, `import type { ZodSchema } from "zod"`);
  });

  it("preserves Node discovery package metadata behavior", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-import-core-" });
    try {
      await Deno.mkdir(`${projectDir}/node_modules/pkg`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/node_modules/pkg/package.json`,
        JSON.stringify({ exports: { ".": "./index.js", "./*": "./*.js" } }),
      );
      await Deno.writeTextFile(`${projectDir}/node_modules/pkg/index.js`, "");
      await Deno.writeTextFile(`${projectDir}/node_modules/pkg/sub.js`, "");

      const out = await rewriteDiscoveryImports(
        [`import main from "pkg";`, `import sub from "pkg/sub";`].join("\n"),
        projectDir,
        createFileSystem(),
        `${projectDir}/app`,
      );
      assertStringIncludes(out, "pkg/index.js");
      assertStringIncludes(out, "pkg/sub.js");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("preserves route loader compiled and Deno rewrites", async () => {
    assertEquals(
      rewriteCompiledBinaryVeryfrontImports(`import { x } from "veryfront/agent";`),
      `import { x } from "./_vf_agent.mjs";`,
    );
    assertStringIncludes(
      rewriteCompiledBinaryUserDependencyImports(
        `const m = import("lodash/merge");`,
        new Map([["lodash", "^4"]]),
      ),
      `Promise.resolve(require("lodash/merge"))`,
    );
    assertEquals(
      rewriteDenoNodeBuiltinImports(`import { readFile } from "fs";`),
      `import { readFile } from "node:fs";`,
    );

    const fs = createFileSystem();
    const projectDir = await Deno.makeTempDir({ prefix: "vf-route-rewrite-" });
    try {
      await Deno.mkdir(`${projectDir}/node_modules/lodash`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/node_modules/lodash/package.json`,
        JSON.stringify({ version: "4.17.21" }),
      );
      assertEquals(
        await rewriteDenoNpmDependencyImports(
          `import merge from "lodash/merge";`,
          projectDir,
          fs,
          new Map([["lodash", "^4"]]),
        ),
        `import merge from "npm:lodash@4.17.21/merge";`,
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});
```

- [ ] **Step 2: Run the new golden tests**

Run:

```bash
deno test --no-check --allow-all src/transforms/import-rewriter/core.test.ts
```

Expected: PASS before refactor. If the expected string differs, update the test to the exact current output before moving code.

- [ ] **Step 3: Run focused baseline**

Run:

```bash
deno test --no-check --allow-all \
  src/transforms/import-rewriter \
  src/transforms/esm/import-rewriter.test.ts \
  src/transforms/esm/import-attributes.test.ts \
  src/modules/server/ssr-import-rewriter.test.ts \
  src/discovery/import-rewriter.test.ts \
  src/routing/api/module-loader/external-import-rewriter.test.ts
```

Expected: PASS. If this baseline fails before implementation, stop this candidate and report the failing test as pre-existing.

- [ ] **Step 4: Commit golden tests**

```bash
git add src/transforms/import-rewriter/core.test.ts
git commit -m "Protect import rewrite semantics before consolidation" \
  -m "The import rewrite refactor needs exact-output guards across transform, SSR, discovery, and route-loading paths before shared mechanics move behind a private Module." \
  -m "Constraint: Public rewrite entrypoints and generated strings must remain byte-compatible" \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Tested: deno test --no-check --allow-all src/transforms/import-rewriter/core.test.ts" \
  -m "Not-tested: Full suite before implementation"
```

---

### Task 2: Extract lexer-bounded edit primitives

**Files:**
- Create: `src/transforms/import-rewriter/import-edit.ts`
- Modify: `src/transforms/import-rewriter/parse-cache.ts`
- Modify: `src/transforms/esm/import-attributes.ts`
- Test: `src/transforms/import-rewriter/core.test.ts`
- Test: `src/transforms/esm/import-attributes.test.ts`

**Interfaces:**
- Consumes: current `parseAllImports`, `applyRewrites`, `replaceSpecifiers`, `upgradeImportAssertions`, and `stripJsonImportAttributes`.
- Produces: one private edit Module with current `parse-cache.ts` exports preserved as shims.

- [ ] **Step 1: Add failing import-edit tests**

Append to `src/transforms/import-rewriter/core.test.ts`:

```ts
import { applyImportEdits, parseImportEdits } from "./import-edit.ts";

describe("import edit core", () => {
  it("edits specifiers while preserving HTTP strings and attributes", async () => {
    const code = `const u = "https://example.com/a";\nimport m from "./a.json" with { type: "json" };\n`;
    const parsed = await parseImportEdits(code);
    const out = applyImportEdits(parsed, new Map([[0, { specifier: "./b.json" }]]));
    assertEquals(
      out,
      `const u = "https://example.com/a";\nimport m from "./b.json" with { type: "json" };\n`,
    );
  });
});
```

Run:

```bash
deno test --no-check --allow-all src/transforms/import-rewriter/core.test.ts
```

Expected: FAIL with module not found for `import-edit.ts`.

- [ ] **Step 2: Create `import-edit.ts`**

Move the current implementation from `src/transforms/import-rewriter/parse-cache.ts` into `src/transforms/import-rewriter/import-edit.ts` with these exported names:

```ts
export interface ParsedImportEdits {
  imports: ImportSpecifierInfo[];
  urlMap: Map<string, string>;
  maskedCode: string;
}

export async function initLexer(): Promise<void>;
export async function parseImportEdits(code: string): Promise<ParsedImportEdits>;
export function applyImportEdits(
  parsed: ParsedImportEdits,
  rewrites: Map<number, { specifier?: string | null; statement?: string }>,
): string;
export async function replaceImportSpecifiers(
  code: string,
  replacer: (specifier: string, isDynamic: boolean) => string | null | undefined,
): Promise<string>;
export function importAttributeRange(imp: ImportSpecifier): { start: number; end: number };
```

Keep the existing HTTP URL masking pattern and end-to-start replacement order.

- [ ] **Step 3: Convert `parse-cache.ts` to a shim**

Replace implementation in `src/transforms/import-rewriter/parse-cache.ts` with delegating exports:

```ts
import { applyImportEdits, type ParsedImportEdits } from "./import-edit.ts";

export {
  initLexer,
  parseImportEdits as parseAllImports,
  replaceImportSpecifiers as replaceSpecifiers,
} from "./import-edit.ts";

export type ParsedImports = ParsedImportEdits;

export function applyRewrites(
  _code: string,
  parsed: ParsedImportEdits,
  rewrites: Map<number, { specifier?: string | null; statement?: string }>,
): string {
  return applyImportEdits(parsed, rewrites);
}
```

- [ ] **Step 4: Reuse attribute ranges in `import-attributes.ts`**

Modify `src/transforms/esm/import-attributes.ts` so `attributeRange` comes from `importAttributeRange`. Preserve the existing regex constants, `parseMaskedImports` usage, and exact output strings until tests prove `parseImportEdits` can replace it safely.

- [ ] **Step 5: Run edit and attribute tests**

```bash
deno test --no-check --allow-all \
  src/transforms/import-rewriter/core.test.ts \
  src/transforms/esm/import-attributes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit edit extraction**

```bash
git add src/transforms/import-rewriter/import-edit.ts src/transforms/import-rewriter/parse-cache.ts src/transforms/esm/import-attributes.ts src/transforms/import-rewriter/core.test.ts
git commit -m "Concentrate import edit mechanics behind one private Module" \
  -m "Lexer initialization, URL masking, range-based replacement, and import attribute range handling now share one implementation while existing entrypoints remain shims." \
  -m "Constraint: Attribute and HTTP URL position behavior must remain byte-compatible" \
  -m "Rejected: Regex-only import attributes | string literals and generated bundles require lexer-bounded edits" \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Tested: deno test --no-check --allow-all src/transforms/import-rewriter/core.test.ts src/transforms/esm/import-attributes.test.ts"
```

---

### Task 3: Extract package resolution helpers

**Files:**
- Create: `src/transforms/import-rewriter/package-resolution.ts`
- Modify: `src/discovery/import-rewriter.ts`
- Modify: `src/routing/api/module-loader/external-import-rewriter.ts`
- Test: `src/transforms/import-rewriter/core.test.ts`
- Test: `src/discovery/import-rewriter.test.ts`
- Test: `src/routing/api/module-loader/external-import-rewriter.test.ts`
- Test: `src/routing/api/module-loader/loader-helpers.test.ts`

**Interfaces:**
- Consumes: current discovery package helpers and route loader export-entry helpers.
- Produces: reusable private helpers for discovery and route Adapters.

- [ ] **Step 1: Add package-resolution tests**

Append to `src/transforms/import-rewriter/core.test.ts`:

```ts
import {
  resolveContainedPackagePath,
  resolvePackageExportPath,
  splitPackageSubpath,
} from "./package-resolution.ts";

describe("package resolution core", () => {
  it("splits scoped and unscoped package subpaths", () => {
    assertEquals(splitPackageSubpath("react/jsx-runtime"), {
      name: "react",
      subpath: "./jsx-runtime",
    });
    assertEquals(splitPackageSubpath("@scope/pkg/sub/path"), {
      name: "@scope/pkg",
      subpath: "./sub/path",
    });
  });

  it("resolves exact, conditional, array, and glob export entries", () => {
    const exportsMap = {
      ".": [{ import: "./esm.js" }, "./fallback.js"],
      "./jsx-runtime": { import: "./jsx-runtime.js" },
      "./*": "./*.js",
    };
    assertEquals(resolvePackageExportPath(exportsMap, "."), "./esm.js");
    assertEquals(resolvePackageExportPath(exportsMap, "./jsx-runtime"), "./jsx-runtime.js");
    assertEquals(resolvePackageExportPath(exportsMap, "./debounce"), "./debounce.js");
  });

  it("rejects package paths that escape the package directory", () => {
    assertEquals(
      resolveContainedPackagePath("/app/node_modules/pkg", "./index.js"),
      "/app/node_modules/pkg/index.js",
    );
    assertEquals(resolveContainedPackagePath("/app/node_modules/pkg", "../../secret.js"), null);
  });
});
```

Run:

```bash
deno test --no-check --allow-all src/transforms/import-rewriter/core.test.ts
```

Expected: FAIL with module not found or missing exported helpers.

- [ ] **Step 2: Create `package-resolution.ts`**

Extract the current discovery helpers:

- `splitPackageSubpath`
- `pickExportEntry` as `pickPackageExportEntry`
- `resolveExportPath` as `resolvePackageExportPath`

Add containment:

```ts
export function resolveContainedPackagePath(packagePath: string, entryPoint: string): string | null {
  const resolved = pathHelper.resolve(packagePath, entryPoint);
  const packagePathPrefix = packagePath.endsWith(pathHelper.SEPARATOR)
    ? packagePath
    : packagePath + pathHelper.SEPARATOR;
  return resolved === packagePath || resolved.startsWith(packagePathPrefix) ? resolved : null;
}
```

Import `#veryfront/compat/path` as `pathHelper` to match current path behavior.

- [ ] **Step 3: Update discovery Adapter**

In `src/discovery/import-rewriter.ts`, replace local package helper definitions with imports from `package-resolution.ts`.

Keep these exact behaviors:

- `resolvePackageToFileUrl` returns `null` for escaping paths.
- Missing package lookups are not cached.
- Positive package resolutions are cached with the existing LRU cache.
- Invalid local Veryfront export sources do not fall back to runtime resolution.

- [ ] **Step 4: Update route Adapter usage**

In `src/routing/api/module-loader/external-import-rewriter.ts`, reuse the new helpers where behavior matches:

- use `resolvePackageExportPath` when resolving ESM package entries,
- use `resolveContainedPackagePath` for ESM-only entry and subpath containment where it can replace the current `isWithinDirectory` check without changing behavior.

Do not delete `resolveExportEntry` from `src/routing/api/module-loader/loader-helpers.ts` unless all existing callers are updated and `loader-helpers.test.ts` passes.

- [ ] **Step 5: Run package tests**

```bash
deno test --no-check --allow-all \
  src/transforms/import-rewriter/core.test.ts \
  src/discovery/import-rewriter.test.ts \
  src/routing/api/module-loader/external-import-rewriter.test.ts \
  src/routing/api/module-loader/loader-helpers.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit package-resolution extraction**

```bash
git add src/transforms/import-rewriter/package-resolution.ts src/transforms/import-rewriter/core.test.ts src/discovery/import-rewriter.ts src/routing/api/module-loader/external-import-rewriter.ts src/routing/api/module-loader/loader-helpers.ts
git commit -m "Make package resolution local to the import rewrite Module" \
  -m "Discovery and route module loading now share package subpath, exports, and containment logic without changing caller-facing rewrite functions." \
  -m "Constraint: Missing package lookups and local veryfront fallback rules are compatibility-sensitive" \
  -m "Rejected: Change route loading to the discovery resolver wholesale | compiled binary shims have distinct semantics" \
  -m "Confidence: medium" \
  -m "Scope-risk: moderate" \
  -m "Tested: deno test --no-check --allow-all src/transforms/import-rewriter/core.test.ts src/discovery/import-rewriter.test.ts src/routing/api/module-loader/external-import-rewriter.test.ts src/routing/api/module-loader/loader-helpers.test.ts"
```

---

### Task 4: Introduce core orchestration and transform Adapter

**Files:**
- Create: `src/transforms/import-rewriter/core.ts`
- Modify: `src/transforms/import-rewriter/unified-rewriter.ts`
- Modify: `src/transforms/esm/import-rewriter.ts`
- Test: `src/transforms/import-rewriter/core.test.ts`
- Test: `src/transforms/import-rewriter/unified-rewriter.test.ts`
- Test: `src/transforms/import-rewriter/strategies/**/*.test.ts`
- Test: `src/transforms/esm/import-rewriter.test.ts`

**Interfaces:**
- Consumes: `ImportRewriteStrategy`, `RewriteContext`, and existing ESM transform functions.
- Produces: private core runner used by the transform entrypoints.

- [ ] **Step 1: Add core runner tests**

Append to `src/transforms/import-rewriter/core.test.ts`:

```ts
import { rewriteWithImportRewriteCore } from "./core.ts";
import type { ImportRewriteStrategy } from "./types.ts";

describe("import rewrite core runner", () => {
  it("runs strategies in caller-provided order", async () => {
    const strategies: ImportRewriteStrategy[] = [
      {
        name: "first",
        priority: 10,
        matches: (specifier) => specifier === "target",
        rewrite: () => ({ specifier: "first" }),
      },
      {
        name: "second",
        priority: 0,
        matches: (specifier) => specifier === "target",
        rewrite: () => ({ specifier: "second" }),
      },
    ];

    const out = await rewriteWithImportRewriteCore({
      code: `import x from "target";`,
      strategies,
      context: {
        filePath: "/project/app/page.tsx",
        projectDir: "/project",
        projectId: "p1",
        target: "browser",
        dev: false,
        reactVersion: "19.2.4",
      },
    });
    assertEquals(out, `import x from "first";`);
  });
});
```

Run:

```bash
deno test --no-check --allow-all src/transforms/import-rewriter/core.test.ts
```

Expected: FAIL with module not found for `core.ts`.

- [ ] **Step 2: Implement `core.ts`**

Create `src/transforms/import-rewriter/core.ts`:

```ts
import { applyImportEdits, parseImportEdits } from "./import-edit.ts";
import type { ImportSpecifierInfo, ImportRewriteStrategy, RewriteContext, RewriteResult } from "./types.ts";

export interface TransformCoreInput {
  code: string;
  context: RewriteContext;
  strategies: ImportRewriteStrategy[];
}

export async function rewriteWithImportRewriteCore(input: TransformCoreInput): Promise<string> {
  const parsed = await parseImportEdits(input.code);
  if (parsed.imports.length === 0) return input.code;

  const rewrites = new Map<number, { specifier?: string | null; statement?: string }>();
  for (let i = 0; i < parsed.imports.length; i++) {
    const imp = parsed.imports[i]!;
    const result = rewriteOne(imp.specifier, imp, input.context, input.strategies);
    if (result.specifier !== null || result.statement !== undefined) {
      rewrites.set(i, result);
    }
  }

  return rewrites.size === 0 ? input.code : applyImportEdits(parsed, rewrites);
}

function rewriteOne(
  specifier: string,
  info: ImportSpecifierInfo,
  ctx: RewriteContext,
  strategies: ImportRewriteStrategy[],
): RewriteResult {
  for (const strategy of strategies) {
    if (!strategy.matches(specifier, ctx)) continue;
    const result = strategy.rewrite(info, ctx);
    if (result.specifier !== null || result.statement !== undefined) return result;
  }
  return { specifier: null };
}
```

- [ ] **Step 3: Delegate `UnifiedImportRewriter` to the core**

In `src/transforms/import-rewriter/unified-rewriter.ts`, keep the constructor and default strategy sorting unchanged. Replace the body inside `withSpan` with:

```ts
return await rewriteWithImportRewriteCore({ code, context: ctx, strategies: this.strategies });
```

Remove the now-unused private `rewriteImport` method only after tests pass.

- [ ] **Step 4: Keep ESM browser entrypoints as compatibility Adapters**

Keep `addHMRTimestamps`, `rewriteBareImports`, and `rewriteVendorImports` in `src/transforms/esm/import-rewriter.ts`. Reuse `replaceSpecifiers` through the existing `parse-cache.ts` shim only if output stays identical.

- [ ] **Step 5: Run transform tests**

```bash
deno test --no-check --allow-all \
  src/transforms/import-rewriter/core.test.ts \
  src/transforms/import-rewriter/unified-rewriter.test.ts \
  src/transforms/import-rewriter/strategies \
  src/transforms/esm/import-rewriter.test.ts \
  src/transforms/esm/import-attributes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit transform Adapter**

```bash
git add src/transforms/import-rewriter/core.ts src/transforms/import-rewriter/unified-rewriter.ts src/transforms/esm/import-rewriter.ts src/transforms/import-rewriter/core.test.ts
git commit -m "Route transform rewriting through the private import core" \
  -m "The strategy runner now lives behind a private Module while the transform Adapter preserves strategy ordering, custom strategy behavior, HMR timestamps, bare imports, vendor imports, and import attributes." \
  -m "Constraint: Strategy priority and caller-provided order have different compatibility rules" \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Tested: deno test --no-check --allow-all src/transforms/import-rewriter/core.test.ts src/transforms/import-rewriter/unified-rewriter.test.ts src/transforms/import-rewriter/strategies src/transforms/esm/import-rewriter.test.ts src/transforms/esm/import-attributes.test.ts"
```

---

### Task 5: Add SSR Adapter behind current entrypoints

**Files:**
- Create: `src/transforms/import-rewriter/ssr-adapter.ts`
- Modify: `src/modules/server/ssr-import-rewriter.ts`
- Test: `src/transforms/import-rewriter/core.test.ts`
- Test: `src/modules/server/ssr-import-rewriter.test.ts`
- Test: `src/modules/server/module-server.test.ts`
- Test: `src/modules/server/module-batch-handler.test.ts`

**Interfaces:**
- Consumes: current `SSRImportRewriteTarget` and existing non-exported `SSRRewriteOptions` shape.
- Produces: private SSR Adapter functions, with module server entrypoints unchanged.

- [ ] **Step 1: Add SSR Adapter exact tests**

Append to `src/transforms/import-rewriter/core.test.ts`:

```ts
import { rewriteSSRImportsCompat } from "./ssr-adapter.ts";

describe("SSR import Adapter", () => {
  it("preserves legacy regex scope and query order", () => {
    const code = [
      `import X from "@/x";`,
      `import Y from "./y.js";`,
      `const text = 'import Z from "@/z";';`,
    ].join("\n");
    assertEquals(
      rewriteSSRImportsCompat(code, {
        projectSlug: "p",
        branch: "b",
        cacheBuster: "v",
      }),
      [
        `import X from "/_vf_modules/x.js?ssr=true&project=p&branch=b&v=v";`,
        `import Y from "./y.js?ssr=true&project=p&branch=b&v=v";`,
        `const text = 'import Z from "@/z";';`,
      ].join("\n"),
    );
  });
});
```

Run:

```bash
deno test --no-check --allow-all src/transforms/import-rewriter/core.test.ts
```

Expected: FAIL with module not found for `ssr-adapter.ts`.

- [ ] **Step 2: Implement `ssr-adapter.ts` by moving current code**

Move the current implementation from `src/modules/server/ssr-import-rewriter.ts` into `src/transforms/import-rewriter/ssr-adapter.ts`, preserving the implementation exactly.

Export compatibility names:

```ts
export interface SSRImportRewriteTarget {
  specifier: string;
  kind: "alias" | "relative";
  modulePath: string;
  rewrittenPath: string;
}

export function stripSSRModuleJsExtensionCompat(path: string): string;
export function resolveSSRImportTargetModulePathCompat(
  target: SSRImportRewriteTarget,
  currentModulePath: string,
): string;
export function rewriteSSRImportsCompat(code: string, options?: SSRRewriteOptions): string;
export function rewriteSSRImportsCompatAsync(
  code: string,
  options?: SSRRewriteOptions,
): Promise<string>;
```

Keep `SSRRewriteOptions` unexported unless TypeScript requires exporting it for function signatures.

- [ ] **Step 3: Convert `ssr-import-rewriter.ts` to a public shim**

Replace `src/modules/server/ssr-import-rewriter.ts` with:

```ts
export type { SSRImportRewriteTarget } from "#veryfront/transforms/import-rewriter/ssr-adapter.ts";
export {
  rewriteSSRImportsCompat as applySSRImportRewrites,
  rewriteSSRImportsCompatAsync as applySSRImportRewritesAsync,
  resolveSSRImportTargetModulePathCompat as resolveSSRImportTargetModulePath,
  stripSSRModuleJsExtensionCompat as stripSSRModuleJsExtension,
} from "#veryfront/transforms/import-rewriter/ssr-adapter.ts";
```

If compile fails because `SSRRewriteOptions` leaks through declaration output, export that type from the Adapter and re-export it only as needed.

- [ ] **Step 4: Run SSR tests**

```bash
deno test --no-check --allow-all \
  src/transforms/import-rewriter/core.test.ts \
  src/modules/server/ssr-import-rewriter.test.ts \
  src/modules/server/module-server.test.ts \
  src/modules/server/module-batch-handler.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit SSR Adapter**

```bash
git add src/transforms/import-rewriter/ssr-adapter.ts src/modules/server/ssr-import-rewriter.ts src/transforms/import-rewriter/core.test.ts
git commit -m "Hide SSR import rewrite quirks behind a compatibility Adapter" \
  -m "SSR keeps its legacy regex scope, rewrite order, React runtime handling, and query byte ordering while its implementation moves into the import rewrite Module." \
  -m "Constraint: SSR output URLs are cache keys and must remain byte-compatible" \
  -m "Rejected: Convert SSR to the transform strategy runner immediately | parser-driven rewrites risk whitespace and string-literal drift" \
  -m "Confidence: medium" \
  -m "Scope-risk: moderate" \
  -m "Tested: deno test --no-check --allow-all src/transforms/import-rewriter/core.test.ts src/modules/server/ssr-import-rewriter.test.ts src/modules/server/module-server.test.ts src/modules/server/module-batch-handler.test.ts"
```

---

### Task 6: Add route and discovery Adapter helpers

**Files:**
- Create: `src/transforms/import-rewriter/route-adapter.ts`
- Modify: `src/discovery/import-rewriter.ts`
- Modify: `src/routing/api/module-loader/external-import-rewriter.ts`
- Test: `src/transforms/import-rewriter/core.test.ts`
- Test: `src/discovery/import-rewriter.test.ts`
- Test: `src/discovery/transpiler.test.ts`
- Test: `src/routing/api/module-loader/external-import-rewriter.test.ts`
- Test: `src/routing/api/module-loader/loader.test.ts`

**Interfaces:**
- Consumes: current discovery and route-loading functions.
- Produces: shared private route/discovery helpers with public shims unchanged.

- [ ] **Step 1: Add route Adapter tests**

Append to `src/transforms/import-rewriter/core.test.ts`:

```ts
import {
  rewriteCompiledVeryfrontImportsForRoute,
  rewriteDenoNodeBuiltinsForRoute,
} from "./route-adapter.ts";

describe("route import Adapter", () => {
  it("preserves route compiled Veryfront shims", () => {
    assertEquals(
      rewriteCompiledVeryfrontImportsForRoute(`const a = import("veryfront/react/head");`),
      `const a = import("./_vf_react_head.mjs");`,
    );
  });

  it("preserves route Deno builtin prefixes", () => {
    assertEquals(
      rewriteDenoNodeBuiltinsForRoute(`const p = import("path");`),
      `const p = import("node:path");`,
    );
  });
});
```

Run:

```bash
deno test --no-check --allow-all src/transforms/import-rewriter/core.test.ts
```

Expected: FAIL with module not found for `route-adapter.ts`.

- [ ] **Step 2: Move low-risk pure route helpers first**

Create `src/transforms/import-rewriter/route-adapter.ts` and move or wrap:

- `NODE_BUILTINS` only if existing public export remains available from `external-import-rewriter.ts`,
- compiled Veryfront import rewrite,
- Deno node builtin rewrite,
- Deno npm dependency rewrite,
- compiled user dependency rewrite,
- ESM dependency location type and resolver.

Use private names in the Adapter:

```ts
export function rewriteCompiledVeryfrontImportsForRoute(code: string): string;
export function rewriteDenoNodeBuiltinsForRoute(code: string): string;
export function rewriteCompiledUserDependencyImportsForRoute(
  code: string,
  userDeps: Map<string, string>,
  esmDeps?: Map<string, EsmDependencyLocation>,
): string;
export function rewriteDenoNpmDependencyImportsForRoute(
  code: string,
  projectDir: string,
  fs: FileSystem,
  userDeps: Map<string, string>,
): Promise<string>;
```

- [ ] **Step 3: Keep the compiled-binary require shim stable**

Keep `generateCompiledBinaryRequireShim(projectDir)` exported from `src/routing/api/module-loader/external-import-rewriter.ts`. It can delegate to the Adapter only if the returned shim string remains byte-compatible with current tests.

- [ ] **Step 4: Move Node route helpers carefully**

Move or delegate:

- `readProjectDependencies`
- `getNodeExternalPackagesToResolve`
- `resolveNodePackageToFileUrl`
- `resolveEsmUserDependencies`
- `loadVeryfrontExportsMap`
- `rewriteNodeExternalImports`
- `rewriteExternalImports`

Keep the public exports in `src/routing/api/module-loader/external-import-rewriter.ts` unchanged. The shim may import Adapter functions and re-export them under current names.

- [ ] **Step 5: Keep discovery entrypoints local**

In `src/discovery/import-rewriter.ts`, use `package-resolution.ts` and route-adapter regex helpers only where behavior is identical. Keep `rewriteForDeno` and `rewriteDiscoveryImports` in this file as compatibility entrypoints because discovery has different caller dependencies and runtime fallback rules.

- [ ] **Step 6: Run route and discovery tests**

```bash
deno test --no-check --allow-all \
  src/transforms/import-rewriter/core.test.ts \
  src/discovery/import-rewriter.test.ts \
  src/discovery/transpiler.test.ts \
  src/routing/api/module-loader/external-import-rewriter.test.ts \
  src/routing/api/module-loader/loader.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit route Adapter**

```bash
git add src/transforms/import-rewriter/route-adapter.ts src/discovery/import-rewriter.ts src/routing/api/module-loader/external-import-rewriter.ts src/transforms/import-rewriter/core.test.ts
git commit -m "Unify route import rewrite mechanics without changing loaders" \
  -m "Discovery and route module loading now share package and rewrite helpers behind the import rewrite Module while preserving existing runtime-specific entrypoints." \
  -m "Constraint: Node, Deno, and compiled binary route loading intentionally diverge" \
  -m "Rejected: One public route/discovery rewrite function | caller contracts and runtime metadata differ" \
  -m "Confidence: medium" \
  -m "Scope-risk: moderate" \
  -m "Tested: deno test --no-check --allow-all src/transforms/import-rewriter/core.test.ts src/discovery/import-rewriter.test.ts src/discovery/transpiler.test.ts src/routing/api/module-loader/external-import-rewriter.test.ts src/routing/api/module-loader/loader.test.ts"
```

---

### Task 7: Delete duplicate private logic and verify compatibility

**Files:**
- Modify: `src/transforms/import-rewriter/parse-cache.ts`
- Modify: `src/transforms/import-rewriter/unified-rewriter.ts`
- Modify: `src/transforms/esm/import-rewriter.ts`
- Modify: `src/transforms/esm/import-attributes.ts`
- Modify: `src/modules/server/ssr-import-rewriter.ts`
- Modify: `src/discovery/import-rewriter.ts`
- Modify: `src/routing/api/module-loader/external-import-rewriter.ts`
- Modify: `src/transforms/import-rewriter/index.ts` only if internal aliases require it.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: final cleanup with duplicate private classification, edit, and package-resolution logic removed.

- [ ] **Step 1: Remove duplicate helpers**

Delete local helpers that now have a single owner:

- duplicate package/subpath splitters,
- duplicate export map pickers,
- duplicate package containment guards,
- duplicate parser/edit replacement helpers,
- the private `UnifiedImportRewriter.rewriteImport` method if `core.ts` fully owns it.

Do not delete compatibility entrypoints or focused tests.

- [ ] **Step 2: Check dependency files**

Run:

```bash
git diff -- deno.json deno.lock
```

Expected: no dependency changes for this refactor.

- [ ] **Step 3: Run diff check**

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 4: Run focused verification**

```bash
deno test --no-check --allow-all \
  src/transforms/import-rewriter \
  src/transforms/esm/import-rewriter.test.ts \
  src/transforms/esm/import-attributes.test.ts \
  src/modules/server/ssr-import-rewriter.test.ts \
  src/modules/server/module-server.test.ts \
  src/modules/server/module-batch-handler.test.ts \
  src/discovery/import-rewriter.test.ts \
  src/discovery/transpiler.test.ts \
  src/routing/api/module-loader/external-import-rewriter.test.ts \
  src/routing/api/module-loader/loader.test.ts \
  src/routing/api/module-loader/loader-helpers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run broader related selection**

```bash
deno test --no-check --allow-all --parallel \
  src/transforms \
  src/modules/server \
  src/discovery \
  src/routing/api/module-loader
```

Expected: PASS, or rerun failing tests individually and classify unrelated pre-existing failures with exact test names.

- [ ] **Step 6: Commit final cleanup**

```bash
git add src/transforms/import-rewriter src/transforms/esm/import-rewriter.ts src/transforms/esm/import-attributes.ts src/modules/server/ssr-import-rewriter.ts src/discovery/import-rewriter.ts src/routing/api/module-loader/external-import-rewriter.ts
git commit -m "Remove duplicate import rewrite semantics after Adapter parity" \
  -m "The import rewrite core now owns shared edit and package-resolution behavior, leaving transform, SSR, discovery, and route-loading files as compatibility Adapters." \
  -m "Constraint: Public entrypoints remain unchanged for downstream callers" \
  -m "Confidence: medium" \
  -m "Scope-risk: moderate" \
  -m "Directive: Add new import rewrite behavior through the private core first, then expose it through the narrow Adapter that owns that runtime" \
  -m "Tested: deno test --no-check --allow-all src/transforms/import-rewriter src/transforms/esm/import-rewriter.test.ts src/transforms/esm/import-attributes.test.ts src/modules/server/ssr-import-rewriter.test.ts src/modules/server/module-server.test.ts src/modules/server/module-batch-handler.test.ts src/discovery/import-rewriter.test.ts src/discovery/transpiler.test.ts src/routing/api/module-loader/external-import-rewriter.test.ts src/routing/api/module-loader/loader.test.ts src/routing/api/module-loader/loader-helpers.test.ts" \
  -m "Not-tested: Full repository test suite"
```

---

## Final verification

Run:

```bash
git status --short
git diff --check
git diff -- deno.json deno.lock
deno test --no-check --allow-all \
  src/transforms/import-rewriter \
  src/transforms/esm/import-rewriter.test.ts \
  src/transforms/esm/import-attributes.test.ts \
  src/modules/server/ssr-import-rewriter.test.ts \
  src/modules/server/module-server.test.ts \
  src/modules/server/module-batch-handler.test.ts \
  src/discovery/import-rewriter.test.ts \
  src/discovery/transpiler.test.ts \
  src/routing/api/module-loader/external-import-rewriter.test.ts \
  src/routing/api/module-loader/loader.test.ts \
  src/routing/api/module-loader/loader-helpers.test.ts
deno test --no-check --allow-all --parallel \
  src/transforms \
  src/modules/server \
  src/discovery \
  src/routing/api/module-loader
```

Stop condition:

- exact-output golden tests pass,
- existing focused tests pass,
- public entrypoints and import-map exports remain,
- no new dependency appears in `deno.json` or `deno.lock`,
- `git diff --check` passes.

## Remaining risks

- The broad parallel command can expose unrelated timing or environment failures. Rerun any failure alone before classifying it.
- The SSR Adapter intentionally keeps regex semantics. That limits cleanup but preserves byte compatibility.
- Generated bundles can contain import-looking strings. Do not broaden regexes or unmasking without a golden test that includes embedded source strings.

## Handoff guidance

Implement tasks in order. Do not start Task 3 until Task 2 is committed, because package-resolution cleanup depends on stable edit shims. Do not delete duplicate private code until all Adapters are green. Use one Lore commit per task so each rollback point is reviewable.
