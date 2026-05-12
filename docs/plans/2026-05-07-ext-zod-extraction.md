# ext-zod Extraction — Three-Phase Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move zod out of veryfront's core supply chain into a first-party extension `@veryfront/ext-zod`. After this work, the only code in this repo that imports `zod` lives in `extensions/ext-zod/`; root `deno.json` no longer declares `zod`; consumers of veryfront who do not need schema validation pay nothing for zod.

**Architecture:** The `SchemaValidator` contract interface and `defineSchema` lazy factory **already exist** in `src/extensions/interfaces/schema-validator.ts` and `src/schemas/define.ts`. A working zod adapter exists at `src/schemas/zod-adapter.ts` and is auto-registered when `src/schemas/index.ts` is imported. The migration is therefore three things in order: (A) move the adapter to a real extension and switch from import-side-effect registration to the `builtin-extensions.ts` registry pattern; (B) rewrite the 369 files that still `import { z } from "zod"` to instead use `defineSchema((v) => …)`; (C) remove `zod` from root `deno.json` and ban direct imports.

**Tech Stack:** Deno workspaces, the existing `SchemaValidator` contract, `tryResolve`/`register` from `src/extensions/contracts.ts`, the `createBuiltinExtensions` pattern in `src/extensions/builtin-extensions.ts`, zod 4.3.6 (kept inside ext-zod).

---

## Current State (verified at planning time, 2026-05-07)

| Asset | Path | Status |
|---|---|---|
| Contract interface | `src/extensions/interfaces/schema-validator.ts` (159 lines) | Complete — full DSL: primitives, composites, chainables, coerce, refine, transform, discriminatedUnion |
| Lazy factory | `src/schemas/define.ts` (48 lines) | Complete — `defineSchema((v) => …)` resolves SchemaValidator on first call, caches |
| Adapter | `src/schemas/zod-adapter.ts` (180 lines) | Complete in core — wraps zod under the contract, exports `registerZodAdapter()` |
| Auto-registration | `src/schemas/index.ts` line 12-15 | `import { registerZodAdapter } from "./zod-adapter.ts"; registerZodAdapter();` — side-effect on import |
| Roadmap row | `docs/guides/extensions.md:240` | Lists `@veryfront/ext-zod` as default `SchemaValidator` impl |
| Recommendation | `src/extensions/recommendations.ts:25` | Maps `"SchemaValidator"` → `"@veryfront/ext-zod"` |
| Builtin chain | `src/extensions/builtin-extensions.ts` | Template for how ext-zod will register |
| Direct zod callsites | `src/`, `cli/` | **369 files** still `import { z } from "zod"` |
| `defineSchema` callsites | `src/schemas/`, `src/extensions/interfaces/` | **7 files** — only the schemas module itself |
| Adoption rate | — | ~2% — 7 / (7 + 369) |

**Implication:** the contract and adapter are *built*; the migration is mostly a callsite rewrite, not a design exercise.

## What this roadmap explicitly does NOT cover

- Replacing zod with a different validator (e.g., valibot). Out of scope — ext-zod stays zod-backed.
- Type-level perfection across every callsite. `z.infer<typeof X>` rewrites to `InferSchema<ReturnType<typeof getX>>` will sometimes need an `as` cast where the new types lose info. Acceptable; track as follow-up.
- Decoupling tool-call schemas (used in `src/tool/`) from zod's runtime — those callsites are part of Phase B, not a separate workstream.

---

# Phase A — Build `extensions/ext-zod` (1 PR)

**Deliverable:** A new workspace member `extensions/ext-zod/` that owns the zod adapter and registers `SchemaValidator` via the `builtin-extensions.ts` chain. Core no longer auto-registers the adapter; zod stops being a runtime requirement of `src/schemas/index.ts`. Every existing test still passes.

**Risk:** Low. Pure relocation — the adapter code itself doesn't change. The registration timing changes from "imported as a side effect of `src/schemas/index.ts`" to "registered when `createBuiltinExtensions()` runs at app bootstrap." Anything that uses `defineSchema()` *before* extension bootstrap will throw — Task A4 hunts those.

## Layering — what lives where (do not get this wrong)

The `src/schemas/` module today is a mix of three responsibilities. Phase A and B preserve this three-way split — only the **adapter** moves into ext-zod:

| File | Today | After ext-zod | Reason |
|---|---|---|---|
| `src/schemas/define.ts` (lazy factory) | Validator-agnostic; depends only on the contract | **Stays in core** | The bridge between core and any `SchemaValidator` impl. Already correct. |
| `src/schemas/common.ts`, `src/schemas/primitives.ts` (Email, Slug, Url, nonEmptyString, semver, portNumber, …) | Import `zod` directly | **Stay in core; migrated to `defineSchema((v) => …)` in Phase B batch B1** | These are framework conveniences any veryfront app should get. Coupling them to `ext-zod` would mean apps that swap to a hypothetical `ext-valibot` lose the standard schemas — wrong layering. |
| `src/schemas/zod-adapter.ts` (180 lines, the only file that imports `zod`) | In core | **Moves to `extensions/ext-zod/src/adapter.ts`** | This is the only file that should know zod exists. |

Concretely: **do not move `common.ts` or `primitives.ts` into `extensions/ext-zod/`.** They build on the contract DSL the same way every other migrated file does; they just happen to live in the framework's standard library because they're useful everywhere.

`extensions/ext-zod/` ends up small — just the adapter, not a library of schemas.

## File Structure

- Create: `extensions/ext-zod/deno.json`
- Create: `extensions/ext-zod/src/index.ts` — `extZod()` factory returning a `ResolvedExtension['extension']`
- Create: `extensions/ext-zod/src/adapter.ts` — moved from `src/schemas/zod-adapter.ts` (delete from core)
- Create: `extensions/ext-zod/src/adapter.test.ts` — moved from any existing tests
- Modify: `src/schemas/index.ts` — drop the `registerZodAdapter` side-effect import; re-export `defineSchema` only
- Modify: `src/extensions/builtin-extensions.ts` — import `extZod` and add to the array returned by `createBuiltinExtensions()`
- Modify: `deno.json` (root) — add `extensions/ext-zod` to `workspace`; **keep** `zod` in `imports` for now (Phase C removes it)
- Delete: `src/schemas/zod-adapter.ts`

## Task A1: Scaffold the extension manifest and entry

- [ ] **Step 1: Verify `extensions/ext-zod/` does not yet exist**

```bash
test -d extensions/ext-zod && echo "EXISTS — abort" || echo "OK to create"
```

Expected: `OK to create`.

- [ ] **Step 2: Create `extensions/ext-zod/deno.json`**

```jsonc
{
  "name": "@veryfront/ext-zod",
  "version": "0.1.0",
  "exports": "./src/index.ts",
  "veryfront": {
    "extension": true,
    "capabilities": [
      { "type": "contract", "name": "SchemaValidator" }
    ]
  },
  "imports": {
    "zod": "npm:zod@4.3.6",
    "@std/assert": "jsr:@std/assert@1",
    "@std/testing/bdd": "jsr:@std/testing@1/bdd",
    "veryfront/extensions": "../../src/extensions/index.ts",
    "veryfront/extensions/interfaces": "../../src/extensions/interfaces/index.ts",
    "veryfront/extensions/contracts": "../../src/extensions/contracts.ts"
  },
  "tasks": {
    "test": "deno test --no-check --allow-all src/"
  }
}
```

- [ ] **Step 3: Add to root workspace**

In root `deno.json`, append `"./extensions/ext-zod"` to the `"workspace"` array (alphabetical position).

- [ ] **Step 4: Verify Deno recognizes the workspace member**

```bash
deno cache --reload=false extensions/ext-zod/deno.json 2>&1 | head
```

Expected: no errors. (Empty output if the file is just JSON and has no source yet.)

## Task A2: Move the adapter

- [ ] **Step 1: Copy `src/schemas/zod-adapter.ts` to `extensions/ext-zod/src/adapter.ts`**

Use `Read` then `Write`. Update the relative imports inside the file:
- `"#veryfront/extensions/contracts.ts"` → `"veryfront/extensions/contracts"`
- `"#veryfront/extensions/interfaces/index.ts"` → `"veryfront/extensions/interfaces"`

- [ ] **Step 2: Run the adapter file in isolation to confirm it parses**

```bash
deno check extensions/ext-zod/src/adapter.ts
```

Expected: PASS.

- [ ] **Step 3: Write the extension entry `extensions/ext-zod/src/index.ts`**

```ts
/**
 * @veryfront/ext-zod — default SchemaValidator implementation backed by zod.
 *
 * Registered automatically by createBuiltinExtensions(); also exports the
 * factory shape for explicit registration in tests.
 */

import type { Extension, ExtensionContext } from "veryfront/extensions/interfaces";
import { register } from "veryfront/extensions/contracts";
import { createZodAdapter } from "./adapter.ts";

export function extZod(): Extension {
  let registered = false;
  return {
    name: "ext-zod",
    version: "0.1.0",
    capabilities: [{ type: "contract", name: "SchemaValidator" }],
    setup(ctx: ExtensionContext) {
      register("SchemaValidator", createZodAdapter());
      registered = true;
      ctx.logger.info("[ext-zod] SchemaValidator registered");
    },
    teardown() {
      // contracts module owns lifecycle; nothing to undo here in current API.
      registered = false;
    },
  };
}

export default extZod;
export { createZodAdapter } from "./adapter.ts";
```

> Note: the adapter currently exports `registerZodAdapter()` (which calls `register(...)` itself). Refactor it to export a pure factory `createZodAdapter()` that *returns* the validator object; let the extension's `setup()` hook own the `register()` call.

- [ ] **Step 4: Refactor `adapter.ts` to export `createZodAdapter`**

In the moved adapter, replace the existing `export function registerZodAdapter()` body — it should now just *build* and *return* the `SchemaValidator` instance. Drop the `register(...)` call from inside it.

```ts
// Before (in src/schemas/zod-adapter.ts):
export function registerZodAdapter() {
  register("SchemaValidator", buildAdapter());
}

// After (in extensions/ext-zod/src/adapter.ts):
export function createZodAdapter(): SchemaValidator {
  return buildAdapter();
}
```

(`buildAdapter` is the existing private function that wires zod into the contract — keep its body as-is.)

## Task A3: Wire ext-zod into the builtin extension chain

- [ ] **Step 1: Edit `src/extensions/builtin-extensions.ts`**

Add the import alongside the others (line 6-13 area):

```ts
import extZod from "../../extensions/ext-zod/src/index.ts";
```

Add to the array returned by `createBuiltinExtensions()`:

```ts
{
  source: "builtin",
  origin: "veryfront/ext-zod",
  extension: extZod(),
},
```

Place it **first** in the array — many other builtins build schemas at setup, so SchemaValidator must be registered before they run.

- [ ] **Step 2: Verify load order**

Search for any builtin extension that calls `defineSchema(...)` or `tryResolve("SchemaValidator")` inside its `setup()`. If any exists and ext-zod is not registered before it, `defineSchema` will throw on first use.

```bash
grep -rln "defineSchema\|SchemaValidator" extensions/*/src/ 2>/dev/null
```

Expected: empty (no extension uses schema validation today). If non-empty, validate that ext-zod precedes the consumer in the array.

## Task A4: Drop the import-side-effect registration

- [ ] **Step 1: Edit `src/schemas/index.ts`**

Remove lines 12-15 (the `registerZodAdapter` import and call):

```diff
- import { registerZodAdapter } from "./zod-adapter.ts";
-
- // Register the default SchemaValidator implementation once at module load.
- registerZodAdapter();
-
  export { defineSchema } from "./define.ts";
```

- [ ] **Step 2: Delete `src/schemas/zod-adapter.ts`**

```bash
git rm src/schemas/zod-adapter.ts
```

- [ ] **Step 3: Run the schemas unit tests**

```bash
deno test --no-check --allow-read src/schemas/
```

Expected: tests **fail** with "SchemaValidator contract unresolved — install ext-zod" because no extension bootstrap runs in unit tests.

- [ ] **Step 4: Add a test setup hook that registers ext-zod**

Create `src/schemas/_test-setup.ts`:

```ts
/**
 * Test-only helper: register the zod adapter so unit tests that exercise
 * defineSchema work without going through full app bootstrap.
 */
import { register } from "#veryfront/extensions/contracts.ts";
import { createZodAdapter } from "../../extensions/ext-zod/src/adapter.ts";

register("SchemaValidator", createZodAdapter());
```

Add `import "./_test-setup.ts";` at the top of every `src/schemas/*.test.ts` file. (4 files: `common.test.ts`, `define.test.ts`, `primitives.test.ts`, plus any new ones.)

- [ ] **Step 5: Re-run the schemas tests**

```bash
deno test --no-check --allow-read src/schemas/
```

Expected: PASS.

## Task A5: Audit for other "first-call before bootstrap" hazards

Some files may use `defineSchema` at module top level (not inside a function). Those will throw on import order if ext-zod isn't registered yet.

- [ ] **Step 1: Find module-level defineSchema calls**

```bash
grep -rEn '^(export )?const \w+ = defineSchema\b' src/ cli/ 2>/dev/null
```

Expected: zero matches in production code (defineSchema returns a *getter*; the schema is built lazily when the getter is first invoked, so module-load is safe). If any matches exist, verify the variable is the getter, not the result of calling it.

- [ ] **Step 2: Run the full test suite**

```bash
deno task test
```

Expected: PASS. If a test fails with "SchemaValidator contract unresolved", that test entry-point needs to register ext-zod (apply Task A4 Step 4 pattern).

## Task A6: Verify, commit, open PR

- [ ] **Step 1: Verify**

```bash
deno task verify:quick && deno task test:unit && deno task test:integration
```

- [ ] **Step 2: Commit**

```bash
git checkout -b feat/ext-zod-phase-a
git add extensions/ext-zod/ src/schemas/index.ts src/extensions/builtin-extensions.ts deno.json src/schemas/_test-setup.ts src/schemas/*.test.ts
git rm src/schemas/zod-adapter.ts
git commit -m "$(cat <<'EOF'
feat(ext-zod): extract zod adapter into @veryfront/ext-zod (Phase A)

Moves the SchemaValidator implementation out of src/schemas/ into a new
workspace member extensions/ext-zod/. Registration now flows through
createBuiltinExtensions() rather than an import side-effect, matching the
pattern used by ext-mdx, ext-babel, and ext-tailwind.

Functional change: src/schemas/index.ts no longer registers the adapter
on import — applications and tests that use defineSchema() must either
go through app bootstrap or call createZodAdapter() directly via the
test-setup helper added in this PR.

Behind the same SchemaValidator contract; no callsite migration yet.
zod stays in root deno.json. Phase B migrates the 369 direct importers;
Phase C removes the root entry.
EOF
)"
git push -u origin feat/ext-zod-phase-a
gh pr create --title "feat(ext-zod): extract zod adapter into @veryfront/ext-zod (Phase A)" \
  --body "First of three phases. See docs/superpowers/plans/2026-05-07-ext-zod-extraction.md."
```

---

# Phase B — Migrate 369 zod-importing files (≈8–12 PRs, batched by module)

**Deliverable:** Every file outside `extensions/ext-zod/` that today writes `import { z } from "zod"` instead writes `import { defineSchema, type InferSchema } from "veryfront/schemas"` (or equivalent) and constructs schemas via `defineSchema((v) => v.object({ … }))`. Behavior is preserved; types are preserved within the limits of the contract DSL.

**Risk:** Medium per batch, accumulating. The mechanical rewrite is straightforward; the type-level rewrite (`z.infer<typeof X>` → `InferSchema<ReturnType<typeof getX>>`) is where regressions hide.

## Migration shape

The fundamental transform per file is:

```ts
// Before
import { z } from "zod";

export const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
});
export type User = z.infer<typeof UserSchema>;

// usage
const user = UserSchema.parse(input);
```

```ts
// After
import { defineSchema, type InferSchema } from "veryfront/schemas";
import type { Schema } from "veryfront/extensions/interfaces";

export const getUserSchema = defineSchema((v) =>
  v.object({
    id: v.string().uuid(),
    name: v.string().min(1),
  })
);
export type User = InferSchema<ReturnType<typeof getUserSchema>>;

// usage
const user = getUserSchema().parse(input);
```

Three things change at every callsite:
1. The schema becomes a *getter function*, not a value.
2. `z.infer` becomes `InferSchema<ReturnType<typeof get…>>`.
3. Every `Schema.parse(…)` becomes `getSchema().parse(…)`.

## Batch breakdown

Group by directory cluster. Land one batch per PR, in this order. Batch sizes from the planning grep — adjust during execution.

| Batch | Scope | Approx files | Rationale |
|---|---|---|---|
| B1 | **`src/schemas/common.ts` + `src/schemas/primitives.ts` (and their `*.test.ts`)** | 4 | **Must be first.** Both files currently `import { z } from "zod"`; downstream batches reference `nonEmptyString`, `timestamp`, `CommonSchemas.email`, etc., so migrating them after a downstream batch would create a mid-migration type-graph mismatch. Tiny surface — ideal pilot for the recipe. |
| B2 | `src/tool/` (incl. tool-call schemas) | ~30 | Single module, well-bounded. Heavy `z.object` use. |
| B3 | `src/platform/adapters/veryfront-api-client/schemas/` | ~20 | API client schemas; high test coverage. |
| B4 | `src/platform/adapters/fs/github/schemas/` + `src/platform/adapters/fs/veryfront/schemas/` | ~15 | Filesystem adapter schemas. |
| B5 | `src/agent/`, `src/chat/`, `src/prompt/` | ~50 | LLM-facing modules. Likely heaviest discriminated-union use. |
| B6 | `src/workflow/` | ~40 | |
| B7 | `src/mcp/`, `src/jobs/`, `src/resource/` | ~30 | |
| B8 | `src/data/`, `src/cache/`, `src/middleware/`, `src/security/` | ~40 | |
| B9 | `src/build/`, `src/transforms/`, `src/rendering/`, `src/server/` | ~50 | |
| B10 | `src/discovery/`, `src/observability/`, `src/oauth/`, `src/integrations/`, etc. | ~40 | Long tail. |
| B11 | `cli/` | ~25 | CLI surface. |
| B12 | Sweep — anything missed by the regex | residual | Final cleanup; acceptance gate is `grep -rln 'from "zod"' src/ cli/` returning zero. |

> **B1 stays in `src/schemas/`** — do not move these files. See Phase A's "Layering" section. After B1, both files use `defineSchema` like any other migrated file; they're just the framework's standard-library schemas, not zod-specific code.

(369 ≈ sum of estimates; per-batch counts will be re-measured at PR open.)

## Per-batch task template

Repeat for each batch B1…B12. Each batch is a separate PR.

**Files:** every file in the batch's scope that imports `zod`.

- [ ] **Step 1: Snapshot baseline tests for the batch**

```bash
BATCH_GLOB="src/tool/**/*.ts"   # adjust per batch
deno task test:unit -- --filter "$(basename $(dirname $BATCH_GLOB))"
```

Expected: PASS. If anything fails before our edits, fix it on `main` first.

- [ ] **Step 2: Identify exact files to migrate**

```bash
grep -rln 'from "zod"' src/tool/ 2>/dev/null | tee /tmp/vf-extzod-batch.txt
```

- [ ] **Step 3: For each file in the list, apply the three transforms**

For file `<path>`:

1. Replace `import { z } from "zod";` → `import { defineSchema, type InferSchema } from "veryfront/schemas";` (and `import type { Schema } from "veryfront/extensions/interfaces";` if `Schema<T>` is referenced as a type).
2. For every `export const FooSchema = z.…(…);` rewrite to `export const getFooSchema = defineSchema((v) => v.…(…));` — translate every `z.X` to `v.X` inside the factory body. The `SchemaValidator` DSL maps 1:1 for the supported subset (see "API mapping" below).
3. For every `z.infer<typeof FooSchema>` rewrite to `InferSchema<ReturnType<typeof getFooSchema>>`.
4. For every internal *callsite* `FooSchema.parse(x)` rewrite to `getFooSchema().parse(x)`. **External callers in other batches still see `FooSchema`** — keep a temporary const alias `export const FooSchema = getFooSchema();` if downstream batches haven't migrated yet, OR (preferred) bump downstream batches in the same PR. Prefer the latter when the cross-batch fan-out is small.
5. Type-check the file: `deno check <path>`. Fix any new errors locally before moving on.

- [ ] **Step 4: Run the batch's tests**

```bash
deno task test:unit -- --filter "$(basename $(dirname $BATCH_GLOB))"
```

Expected: PASS. If a test fails because `Schema<T>`'s DSL is missing a method that the original zod schema needed, see "Gaps" below.

- [ ] **Step 5: Run typecheck for the whole repo**

```bash
deno task typecheck
```

Expected: PASS. Cross-module type errors usually mean a downstream caller still imports the old `FooSchema` value — handle per Step 3 #4.

- [ ] **Step 6: Run integration tests if the batch touches request paths or codegen**

```bash
deno task test:integration
```

- [ ] **Step 7: Commit and open PR**

```bash
git checkout -b refactor/ext-zod-batch-<N>-<scope>
git add src/<scope>/
git commit -m "refactor(<scope>): migrate to defineSchema/SchemaValidator (Phase B, batch <N>)"
git push -u origin HEAD
gh pr create --title "refactor: migrate <scope> to SchemaValidator (Phase B/<N>)" \
  --body "Batch <N> of Phase B — see docs/superpowers/plans/2026-05-07-ext-zod-extraction.md"
```

## API mapping (zod ↔ SchemaValidator DSL)

Verified against `src/extensions/interfaces/schema-validator.ts`. The contract supports the **majority** of zod APIs found in the planning grep but not all — track gaps in Phase B's tracking issue.

**Direct mapping (drop the `z`, use `v`):**

| zod | SchemaValidator | Notes |
|---|---|---|
| `z.string()`, `z.number()`, `z.boolean()`, `z.date()`, `z.null()`, `z.unknown()`, `z.any()` | `v.string()` … | identical |
| `z.object({ … })` | `v.object({ … })` | identical |
| `z.array(s)` | `v.array(s)` | identical |
| `z.record(k, v)` | `v.record(k, v)` | identical |
| `z.union([a, b])` | `v.union([a, b])` | identical |
| `z.discriminatedUnion("type", [a, b])` | `v.discriminatedUnion("type", [a, b])` | identical |
| `z.literal(x)` | `v.literal(x)` | identical |
| `z.enum(["a","b"])` | `v.enum(["a","b"])` | identical |
| `.optional()` `.nullable()` `.nullish()` `.default(…)` `.describe(…)` `.refine(…)` `.transform(…)` | same | identical chainables |
| `.strict()` `.passthrough()` `.partial()` `.extend(…)` `.merge(…)` | same | identical chainables |
| `.min` `.max` `.int` `.positive` `.nonnegative` `.regex` `.email` `.url` `.uuid` `.datetime` | same | identical chainables |
| `.parse(d)` `.safeParse(d)` | same | identical |
| `z.coerce.string()` etc. | `v.coerce.string()` etc. | identical |
| `z.infer<typeof X>` (type) | `InferSchema<ReturnType<typeof getX>>` | structural difference — getter wrapper |

**Gaps (used in code but not in the contract):**

| zod | Status | Workaround |
|---|---|---|
| `z.lazy(() => …)` (3 callsites) | Not in contract | Add `lazy<T>(factory: () => Schema<T>): Schema<T>` to interface; extend adapter; one prep-PR before B5/B6. |
| `z.tuple([…])` (1 callsite) | Not in contract | Add `tuple<T extends Schema<unknown>[]>(items: T): Schema<…>`; prep-PR. |
| `z.instanceof(C)` (2 callsites) | Not in contract | Add `instanceofType<T>(ctor: new (…args: any[]) => T): Schema<T>`; prep-PR. |
| `z.bigint()` (1 callsite) | Not in contract | Add `bigint(): Schema<bigint>`; trivial. |
| `z.function()` (3 callsites) | Not in contract; rarely a good idea | Migrate the callers off — declare the function shape with TypeScript types and validate args via separate object schemas. |
| `.pipe(other)` (~120 callsites — but mostly RxJS-style false positives) | Not in contract | Re-grep with `.pipe(` AND `Schema` proximity to find real cases. If non-trivial count, add `pipe<U>(next: Schema<U>): Schema<U>`. |
| `.catch(default)` (936 hits, mostly Promise.catch) | Not in contract for zod | Re-grep precisely; if real zod uses exist, add `catch(value: T): Schema<T>` to chainables. |
| `z.preprocess(fn, schema)` | Not in contract | Use `.transform(fn)` chained from a permissive base; document the equivalence. |

**Do this before starting Phase B**: a dedicated PR `feat(ext-zod): expand SchemaValidator DSL — lazy/tuple/instanceof/bigint/pipe`. Without it, batches B5/B6 will hit blockers. Treat that prep-PR as the *first* PR of Phase B (B0).

## Phase B acceptance gate

Phase B is "done" when:

```bash
grep -rln 'from "zod"' src/ cli/ 2>/dev/null | wc -l
# expected: 0
grep -rln 'from "zod"' extensions/ext-zod/src/ 2>/dev/null | wc -l
# expected: ≥ 1 (the adapter)
```

---

# Phase C — Remove zod from core (1 PR)

**Deliverable:** `zod` no longer appears in root `deno.json` or `deno.lock` as a direct (non-extension-scoped) dependency. A lint rule prevents reintroduction.

**Risk:** Low *if* Phase B's acceptance gate is real. The lockfile may still list zod transitively (e.g., from `@mdx-js/mdx`'s ESM types) — that's fine; core no longer pulls it in.

## File Structure

- Modify: `deno.json` — delete `"zod": "npm:zod@4.3.6"` from `imports`
- Modify: `package.json` (root) — delete `"zod"` from `dependencies` (it's a Node-side build dep that was misaligned anyway; if PR 2 of the supply-chain set already aligned this, double-check)
- Modify: `npm/package.json` — review whether the npm distribution still ships zod; if not, drop it
- Create: `scripts/lint/ban-zod-imports.ts` — fails if any file outside `extensions/ext-zod/` imports `zod`
- Modify: `deno.json` `tasks` — add `"lint:ban-zod": "deno run --allow-read scripts/lint/ban-zod-imports.ts"` and add to `verify`/`verify:quick`
- Modify: `docs/guides/extensions.md` — flip the row from "planned" to "shipping"
- Modify: `SECURITY.md` (created in supply-chain PR 7) — note that ext-zod is now the canonical schema validator

## Task C1: Verify Phase B is fully done

- [ ] **Step 1: Re-run the acceptance gate**

```bash
remaining=$(grep -rln 'from "zod"' src/ cli/ 2>/dev/null | wc -l)
echo "remaining direct zod imports in src/cli: $remaining"
[ "$remaining" -eq 0 ] || { echo "BLOCKED: Phase B not complete"; exit 1; }
```

Expected: `0`.

## Task C2: Remove the `zod` entry from root `deno.json`

- [ ] **Step 1: Delete the line**

In `deno.json`, remove from `imports`:

```jsonc
"zod": "npm:zod@4.3.6",
```

- [ ] **Step 2: Format and validate**

```bash
deno fmt deno.json
deno eval "JSON.parse(Deno.readTextFileSync('deno.json'))" && echo OK
```

- [ ] **Step 3: Refresh lockfile and confirm zod is no longer pulled by core**

```bash
deno cache --reload=false src/index.ts cli/main.ts
grep -E '"npm:zod@' deno.lock | head
```

Expected: no top-level `"npm:zod@…"` specifier in the *core* resolution. (zod will still appear under `extensions/ext-zod` resolution and possibly transitively — that's fine.)

- [ ] **Step 4: Verify build still works without core's zod entry**

```bash
deno task verify:quick
```

Expected: PASS.

## Task C3: Add the lint rule

- [ ] **Step 1: Write failing test**

Create `scripts/lint/ban-zod-imports.test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { findIllegalZodImports } from "./ban-zod-imports.ts";

describe("findIllegalZodImports", () => {
  it("flags imports of zod outside extensions/ext-zod", () => {
    const files = [
      { path: "src/foo.ts", content: 'import { z } from "zod";' },
      { path: "extensions/ext-zod/src/adapter.ts", content: 'import { z } from "zod";' },
      { path: "src/bar.ts", content: 'import { defineSchema } from "veryfront/schemas";' },
    ];
    const result = findIllegalZodImports(files);
    assertEquals(result.map((r) => r.path), ["src/foo.ts"]);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
deno test --allow-read scripts/lint/ban-zod-imports.test.ts
```

- [ ] **Step 3: Implement `scripts/lint/ban-zod-imports.ts`**

```ts
import { walk } from "@std/fs";

export interface IllegalImport {
  path: string;
  line: number;
}

export function findIllegalZodImports(
  files: Array<{ path: string; content: string }>,
): IllegalImport[] {
  const result: IllegalImport[] = [];
  for (const f of files) {
    if (f.path.startsWith("extensions/ext-zod/")) continue;
    const lines = f.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (/from\s+["']zod["']/.test(lines[i])) {
        result.push({ path: f.path, line: i + 1 });
      }
    }
  }
  return result;
}

if (import.meta.main) {
  const files: Array<{ path: string; content: string }> = [];
  for await (const entry of walk(".", {
    exts: [".ts", ".tsx"],
    skip: [/\bnode_modules\b/, /\bdist\b/, /\bcoverage\b/, /\bnpm\/esm\b/, /\b\.worktrees\b/],
  })) {
    if (!entry.isFile) continue;
    files.push({ path: entry.path, content: await Deno.readTextFile(entry.path) });
  }
  const offenders = findIllegalZodImports(files);
  if (offenders.length === 0) {
    console.log("✅ No illegal zod imports.");
    Deno.exit(0);
  }
  console.log(`❌ ${offenders.length} illegal zod imports:`);
  for (const o of offenders) console.log(`  ${o.path}:${o.line}`);
  Deno.exit(1);
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
deno test --allow-read scripts/lint/ban-zod-imports.test.ts
```

- [ ] **Step 5: Run the lint against the repo**

```bash
deno run --allow-read scripts/lint/ban-zod-imports.ts
```

Expected: `✅ No illegal zod imports.` If any offender remains, that file slipped through Phase B — migrate it before merging Phase C.

- [ ] **Step 6: Add the task and wire into `verify`**

In `deno.json` `tasks`:

```jsonc
"lint:ban-zod": "deno run --allow-read scripts/lint/ban-zod-imports.ts"
```

Append `&& deno task lint:ban-zod` to both `verify` and `verify:quick`.

## Task C4: Update docs

- [ ] **Step 1: `docs/guides/extensions.md:240`** — already lists ext-zod; no change needed unless the doc says "planned" elsewhere.

- [ ] **Step 2: `SECURITY.md`** (assuming supply-chain PR 7 has landed) — under "Supply Chain Posture", add: *"`zod` is no longer a core dependency. The schema-validation contract is provided exclusively by `@veryfront/ext-zod`."*

- [ ] **Step 3: Add a release note entry** (if the project keeps `CHANGELOG.md` — check first; if not, skip).

## Task C5: Verify, commit, open PR

- [ ] **Step 1: Final verification**

```bash
deno task verify
```

Expected: PASS, including the new `lint:ban-zod` task.

- [ ] **Step 2: Commit and open PR**

```bash
git checkout -b chore/ext-zod-phase-c-remove-zod-from-core
git add deno.json deno.lock package.json npm/package.json scripts/lint/ban-zod-imports.ts scripts/lint/ban-zod-imports.test.ts SECURITY.md docs/guides/extensions.md
git commit -m "$(cat <<'EOF'
chore(ext-zod): remove zod from core; ban direct zod imports (Phase C)

With Phase B complete (0 direct zod imports remain in src/ or cli/),
remove the "zod" entry from root deno.json. zod is now declared only by
extensions/ext-zod/, which other code reaches via the SchemaValidator
contract through defineSchema().

Adds scripts/lint/ban-zod-imports.ts to prevent reintroduction; wired
into deno task verify.

Result: core's npm dependency surface for zod drops from 1 (and 369
direct importers) to 0.
EOF
)"
git push -u origin chore/ext-zod-phase-c-remove-zod-from-core
gh pr create --title "chore(ext-zod): remove zod from core (Phase C)" \
  --body "Final phase. See docs/superpowers/plans/2026-05-07-ext-zod-extraction.md."
```

---

# Cross-cutting concerns

## Test infrastructure

After Phase A, every test file that exercises a schema must register the SchemaValidator before use. Three patterns:

1. **Unit tests in `src/schemas/`** — import `_test-setup.ts` (Phase A Task A4 Step 4).
2. **Other unit tests touching schemas indirectly** — register in the test file's setup hook, or rely on a shared bootstrap file.
3. **Integration tests** — go through full app bootstrap, which runs `createBuiltinExtensions()` automatically. No change needed.

Consider adding a global test bootstrap (`tests/_bootstrap.ts`) imported by all test runners — but that's a separate refactor; per-file imports work today.

## Performance

`defineSchema()` adds two layers of indirection per validation: the getter call and the contract resolution. The getter is cached after first call (zero-cost thereafter); the resolution happens once per schema lifetime. Net cost is ~1 extra function call per schema *first use* — negligible. If a hot path measures regression, profile and consider denormalizing back to a direct schema reference inside that hot path (still going through SchemaValidator, just hoisted out of the inner loop).

## Codemod option

A jscodeshift-style automated rewrite would save ~5h per batch. Two options:

1. **`ts-morph`** (npm package) — mature, supports the rewrites described above. Requires Node, not Deno. Acceptable as a one-off codemod tool — write the script, run it, commit the output, never run again.
2. **Hand-rolled Deno + TypeScript Compiler API** — more work to set up, but stays inside the toolchain.

Recommendation: write a `ts-morph` codemod *for the mechanical 80%* (import rewrite, schema-decl rewrite, infer-type rewrite) and review the output per batch. Hand-fix the 20% that needs judgment (z.lazy circular refs, complex unions, etc.). The codemod itself is its own preparatory PR if the team chooses this route.

---

# PR Inventory

| Phase | PR | Estimated effort |
|---|---|---|
| A | feat(ext-zod): extract zod adapter (Phase A) | 0.5 day |
| B0 | feat(ext-zod): expand DSL — lazy/tuple/instanceof/bigint/pipe | 0.5 day |
| B1–B12 | refactor: migrate `<scope>` to SchemaValidator (Phase B/N) | 1–2 days each, 12 batches |
| C | chore(ext-zod): remove zod from core (Phase C) | 0.5 day |
| Total | | ~3–4 weeks elapsed (1 engineer) |

# Self-Review Checklist

- [ ] Phase A delivers a working ext-zod that registers via the builtin chain — no behavioral regression measurable.
- [ ] Phase B's API mapping table covers every zod construct found by the planning grep; gaps have explicit mitigations.
- [ ] Phase B's batch boundaries don't create cross-batch type-inference cycles (e.g., a schema used by B2 but defined in B5).
- [ ] Phase C's lint rule has a test and is wired into `verify`.
- [ ] No phase silently relies on a not-yet-merged supply-chain PR (this roadmap is independent of the 7 supply-chain plans, but Phase C's SECURITY.md update assumes supply-chain PR 7 has landed — note this in Phase C's PR body).
