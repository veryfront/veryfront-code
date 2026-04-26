# PR 13: `@veryfront/ext-google` Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the Google runtime (`createGoogleModelRuntime` + `createGoogleEmbeddingRuntime` + their private helpers) out of core's `src/provider/runtime-loader.ts` into a standalone workspace extension `@veryfront/ext-google`, registered into the existing `AIProviderRegistry` contract. After this PR, `runtime-loader.ts` contains only shared plumbing — no provider-specific factories — clearing the way for PR 14 to physically split the file.

**Architecture:** Mirrors PR 11 (ext-openai) and PR 12 (ext-anthropic). The registry contract, `ExtensionLoader.primeContracts()`, bootstrap wiring, and `src/provider/shared/` barrel are all in place. Google differs from Anthropic in two ways: (1) it has an embedding factory in addition to the language-model factory, so `GoogleProvider` implements both `createModel()` **and** `createEmbedding()`; (2) it authenticates via `x-goog-api-key` header / `key=` query param rather than `Authorization: Bearer` or `x-api-key`. The auth wiring is already encapsulated in helpers re-exported from the shared barrel (`getGoogleGenerateContentUrl`, `getGoogleStreamGenerateContentUrl`, `getGoogleEmbeddingUrl`), so the move is mostly mechanical.

**Tech Stack:** Deno workspace members, TypeScript, `@std/testing/bdd`, `@std/assert`. No new dependencies.

**Branch:** `feat/ext-google` (branched off `feat/ext-anthropic`).

---

## Pre-reqs (already landed in `feat/ext-openai` / `feat/ext-anthropic`)

Do not re-do these:

- `src/extensions/interfaces/ai-provider.ts` — `AIProvider`, `AIProviderConfig`, `AIProviderRegistry`, `AIProviderRegistryName`. `AIProvider.createModel` is required; `createEmbedding` and `createResponses` are optional (Google implements `createModel` + `createEmbedding`).
- `src/extensions/registries/ai-provider-registry.ts` + `createAIProviderRegistry()`
- `ExtensionLoader.primeContracts(record)` — survives `teardownAll()` reset
- `orchestrateExtensions({ primeContracts })` option
- `src/server/bootstrap.ts` primes the registry before `setupAll`
- `src/provider/shared/index.ts` — re-exports `getGoogleGenerateContentUrl`, `getGoogleStreamGenerateContentUrl`, `getGoogleEmbeddingUrl`, plus all the cross-provider plumbing (`buildProviderError`, `requestJson`, `requestStream`, `parseSseChunk`, `mergeUsage`, `unwrapToolInputSchema`, `ProviderError` family, `RuntimeUsage`, `ProviderWarning`)
- `tests/_helpers/context.ts` has `registerExtOpenAIForTests()` + `registerExtAnthropicForTests()` — Task 8 adds the Google sibling.

## File map

**New files:**
- `extensions/ext-google/deno.json`
- `extensions/ext-google/src/index.ts`
- `extensions/ext-google/src/index.test.ts`
- `extensions/ext-google/src/google-provider.ts`
- `extensions/ext-google/src/google-provider.test.ts`

**Modified files:**
- `deno.json` (root) — add workspace member
- `src/provider/runtime-loader.ts` — delete Google factories + helpers; narrow `ProviderKind` if it loses its `"google"` member
- `src/provider/runtime-loader.test.ts` — delete migrated Google test blocks
- `src/provider/model-registry.ts` — rewire `"google"` autoinit branch through the registry
- `src/provider/veryfront-cloud/provider.ts` — rewire `"google"` case through the registry
- `src/provider/runtime-loader/runtime-loader.ts` (or wherever `createGoogleModelRuntime` is currently re-exported, if anywhere) — drop the re-export
- `src/extensions/recommendations.ts` — ensure `AIProvider:google` recommendation points at `@veryfront/ext-google`
- `src/extensions/integration.test.ts` — add ext-google integration test
- `tests/_helpers/context.ts` — materialize `<projectDir>/extensions/ext-google/index.ts` + `registerExtGoogleForTests()`

## Task overview

| Phase | Task | Scope |
|-------|------|-------|
| **A — Scaffold** | 1 | Workspace manifest + root `deno.json` member |
| | 2 | GoogleProvider wrapper (delegating, both createModel + createEmbedding) + factory + smoke tests |
| **B — Rewire consumers** | 3 | `model-registry.ts` google branch → registry with clear-error fallback |
| | 4 | `veryfront-cloud/provider.ts` google case → registry |
| | 5 | Integration test for ext-google |
| **C — Move implementation** | 6 | Migrate Google tests from `runtime-loader.test.ts` |
| | 7 | Move `createGoogleModelRuntime` + `createGoogleEmbeddingRuntime` + Google-specific helpers into `google-provider.ts`; delete from core; narrow `ProviderKind` |
| | 8 | Recommendations map + test-harness materialization |
| **D — Validate** | 9 | Full test suite + lint + draft PR |

---

## Phase A — Scaffold `ext-google` workspace

### Task 1: Workspace manifest

**Files:**
- Create: `extensions/ext-google/deno.json`
- Modify: `deno.json` (root)

- [ ] **Step 1: Create `extensions/ext-google/deno.json`**

```json
{
  "name": "@veryfront/ext-google",
  "version": "0.1.0",
  "exports": "./src/index.ts",
  "veryfront": {
    "extension": true,
    "capabilities": [
      { "type": "contract", "name": "AIProvider:google" }
    ]
  },
  "imports": {
    "@std/assert": "jsr:@std/assert@1",
    "@std/testing/bdd": "jsr:@std/testing@1/bdd",
    "veryfront/extensions": "../../src/extensions/index.ts",
    "veryfront/extensions/interfaces": "../../src/extensions/interfaces/index.ts",
    "veryfront/provider/shared": "../../src/provider/shared/index.ts",
    "veryfront/provider/types": "../../src/provider/types.ts"
  },
  "tasks": {
    "test": "deno test --no-check --allow-all src/"
  }
}
```

- [ ] **Step 2: Add workspace member in root `deno.json`**

Open `deno.json` at repo root. Locate the `"workspace": [...]` array — after PR 12 it includes `./extensions/ext-anthropic`, `./extensions/ext-babel`, `./extensions/ext-openai`, `./extensions/ext-redis` (sorted). Add `./extensions/ext-google` between `ext-babel` and `ext-openai`:

```json
  "workspace": [
    "./extensions/ext-anthropic",
    "./extensions/ext-babel",
    "./extensions/ext-google",
    "./extensions/ext-openai",
    "./extensions/ext-redis"
  ],
```

- [ ] **Step 3: Validate JSON**

Run: `deno check --config deno.json`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add extensions/ext-google/deno.json deno.json
git commit -m "feat(ext-google): scaffold workspace manifest"
```

---

### Task 2: GoogleProvider wrapper + factory + smoke tests

**Why this task exists.** Prove the provider class integrates with the registry end-to-end *before* moving the ~1100 lines of Google factory + embedding code. Task 7 later replaces the placeholder delegation with the real ported code.

The GoogleProvider exposes **both** `createModel()` **and** `createEmbedding()`. The `AIProvider` interface (see `src/extensions/interfaces/ai-provider.ts`) makes `createEmbedding` optional, so this is the first provider to exercise that path end-to-end (ext-anthropic only had `createModel`; ext-openai has `createModel` + `createResponses`).

**Files:**
- Create: `extensions/ext-google/src/google-provider.ts`
- Create: `extensions/ext-google/src/index.ts`
- Create: `extensions/ext-google/src/index.test.ts`

- [ ] **Step 1: Create the delegating wrapper**

Create `extensions/ext-google/src/google-provider.ts`:

```ts
/**
 * Google provider — implements the {@link AIProvider} contract.
 *
 * Initial implementation delegates to the legacy `createGoogleModelRuntime`
 * and `createGoogleEmbeddingRuntime` factories still living in core's
 * `runtime-loader.ts`. Task 7 moves those factories into this file along
 * with all Google-specific helpers.
 */

import type {
  AIProvider,
  AIProviderConfig,
  AIProviderEmbeddingConfig,
} from "veryfront/extensions/interfaces";
import type {
  EmbeddingRuntime,
  ModelRuntime,
} from "veryfront/provider/types";
import {
  createGoogleEmbeddingRuntime,
  createGoogleModelRuntime,
} from "../../../src/provider/runtime-loader.ts";

export class GoogleProvider implements AIProvider {
  readonly id = "google";

  createModel(modelId: string, config: AIProviderConfig): ModelRuntime {
    return createGoogleModelRuntime({
      apiKey: config.credential,
      baseURL: config.baseURL,
      name: config.name ?? "google",
      fetch: config.fetch,
    }, modelId);
  }

  createEmbedding(modelId: string, config: AIProviderEmbeddingConfig): EmbeddingRuntime {
    return createGoogleEmbeddingRuntime({
      apiKey: config.credential,
      baseURL: config.baseURL,
      name: config.name ?? "google",
      fetch: config.fetch,
    }, modelId);
  }
}
```

If `AIProviderEmbeddingConfig` doesn't exist yet (PRs 11/12 didn't need it), check `src/extensions/interfaces/ai-provider.ts`. If absent, Task 2 also adds it as `type AIProviderEmbeddingConfig = AIProviderConfig` (alias) — embedding callers pass the same shape today, but the alias gives us a hook for future divergence. Add the alias in `ai-provider.ts` with a one-line `export type` and re-export from `src/extensions/interfaces/index.ts`. Skip the alias if it's already present.

- [ ] **Step 2: Create the `ExtensionFactory` entry point**

Create `extensions/ext-google/src/index.ts`:

```ts
/**
 * @veryfront/ext-google — registers the Google provider into the
 * core `AIProviderRegistry`.
 *
 * @module extensions/ext-google
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type { AIProviderRegistry } from "veryfront/extensions/interfaces";
import { AIProviderRegistryName } from "veryfront/extensions/interfaces";
import { GoogleProvider } from "./google-provider.ts";

const extGoogle: ExtensionFactory = () => {
  const provider = new GoogleProvider();
  return {
    name: "ext-google",
    version: "0.1.0",
    capabilities: [{ type: "contract", name: "AIProvider:google" }],
    setup(ctx) {
      const registry = ctx.require<AIProviderRegistry>(AIProviderRegistryName);
      registry.register(provider);
      ctx.logger.info("[ext-google] Google provider registered");
    },
    teardown() {
      // No resources to release.
    },
  };
};

export default extGoogle;
export { GoogleProvider };
```

- [ ] **Step 3: Write the smoke test**

Create `extensions/ext-google/src/index.test.ts`:

```ts
import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import extGoogle, { GoogleProvider } from "./index.ts";
import type { AIProviderRegistry } from "veryfront/extensions/interfaces";

describe("ext-google", () => {
  it("factory descriptor advertises the AIProvider:google capability", () => {
    const ext = extGoogle();
    assertEquals(ext.name, "ext-google");
    assertEquals(ext.capabilities?.[0], {
      type: "contract",
      name: "AIProvider:google",
    });
  });

  it("setup registers the provider in the AIProviderRegistry", () => {
    const ext = extGoogle();
    const registered: Record<string, unknown> = {};
    const fakeRegistry: AIProviderRegistry = {
      register: (p) => {
        registered[p.id] = p;
      },
      unregister: () => {},
      get: () => undefined,
      require: () => {
        throw new Error("unused");
      },
      list: () => [],
      has: () => false,
    };
    const ctx = {
      config: {},
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      provide: () => {},
      get: () => undefined,
      require: <T>(name: string): T => {
        if (name === "AIProviderRegistry") return fakeRegistry as unknown as T;
        throw new Error(`unexpected require(${name})`);
      },
    };
    ext.setup?.(ctx as never);
    assert(registered.google instanceof GoogleProvider);
  });

  it("GoogleProvider exposes both createModel and createEmbedding", () => {
    const provider = new GoogleProvider();
    assertEquals(typeof provider.createModel, "function");
    assertEquals(typeof provider.createEmbedding, "function");
  });
});
```

- [ ] **Step 4: Run the smoke tests**

Run: `deno test --no-check --allow-all extensions/ext-google/src/index.test.ts`
Expected: `3 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add extensions/ext-google/src/ src/extensions/interfaces/
git commit -m "feat(ext-google): GoogleProvider wrapper + factory + smoke tests"
```

---

## Phase B — Rewire consumers

### Task 3: Rewire `model-registry.ts::autoInitializeFromEnv()` google branch

**File:** `src/provider/model-registry.ts`

The `"google"` branch sits next to the `"anthropic"` branch that PR 12 rewired. Find the block starting `if (!manager.has("google")) { manager.registerShared("google", (id) => { ...` — it currently calls `getGoogleEnvConfig()` and `createGoogleModelRuntime` (and possibly `createGoogleEmbeddingRuntime` for embedding model ids).

- [ ] **Step 1: Verify the imports needed already exist**

After PRs 11/12, these imports were added:
```ts
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { AIProviderRegistry } from "#veryfront/extensions/interfaces/index.ts";
import { AIProviderRegistryName } from "#veryfront/extensions/interfaces/index.ts";
```

If any are missing, add them.

- [ ] **Step 2: Rewrite the `"google"` branch**

Find `if (!manager.has("google"))` and replace its body. There may be **two** sub-branches: language model registration via `registerShared` and embedding registration via `registerEmbedding` (or similar). Read the current code first to confirm the exact shape.

For the language model branch:

```ts
  if (!manager.has("google")) {
    manager.registerShared("google", (id) => {
      const config = getGoogleEnvConfig();
      if (!config.apiKey) {
        throw toError(
          createError({
            type: "config",
            message:
              "GOOGLE_API_KEY not set. Set the environment variable or register a custom provider with registerModelProvider().",
          }),
        );
      }
      const registry = tryResolve<AIProviderRegistry>(AIProviderRegistryName);
      const provider = registry?.get("google");
      if (provider) {
        return provider.createModel(id, {
          credential: config.apiKey,
          baseURL: config.baseURL,
        });
      }
      throw toError(
        createError({
          type: "config",
          message:
            "Google provider not installed. Add @veryfront/ext-google to use google/* models.",
        }),
      );
    });
  }
```

If there is a parallel embedding registration (e.g. `manager.registerEmbedding("google", ...)`), rewrite it the same way but call `provider.createEmbedding(id, …)` instead, and require `provider.createEmbedding` to exist:

```ts
const provider = registry?.get("google");
if (provider?.createEmbedding) {
  return provider.createEmbedding(id, {
    credential: config.apiKey,
    baseURL: config.baseURL,
  });
}
throw toError(
  createError({
    type: "config",
    message:
      "Google provider does not support embeddings. Add @veryfront/ext-google to use google/* embedding models.",
  }),
);
```

**Why throw instead of fallback?** Task 7 deletes both `createGoogleModelRuntime` and `createGoogleEmbeddingRuntime` from core; there is no fallback to call. The throw matches PRs 11/12.

Leave `"local"`, `"veryfront-cloud"` branches untouched.

- [ ] **Step 3: Type-check**

Run: `deno check src/provider/model-registry.ts`
Expected: no errors.

- [ ] **Step 4: Run provider tests**

Run: `deno test --no-check --allow-all src/provider/`
Expected: all tests pass. If any test asserted the direct `createGoogleModelRuntime` path, either prime a provider in the test setup or update the assertion to expect the throw.

- [ ] **Step 5: Commit**

```bash
git add src/provider/model-registry.ts
git commit -m "refactor(provider): google autoinit delegates to AIProviderRegistry"
```

---

### Task 4: Rewire `veryfront-cloud/provider.ts` google case

**File:** `src/provider/veryfront-cloud/provider.ts`

The current `case "google":` block calls `createGoogleModelRuntime` directly:

```ts
    case "google":
      return createGoogleModelRuntime({
        apiKey: apiToken,
        baseURL,
        name: "veryfront-cloud",
        fetch,
      }, upstreamModelId);
```

- [ ] **Step 1: Verify the imports already exist**

After PRs 11/12:
```ts
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { AIProviderRegistry } from "#veryfront/extensions/interfaces/index.ts";
import { AIProviderRegistryName } from "#veryfront/extensions/interfaces/index.ts";
```

- [ ] **Step 2: Rewrite the `case "google"` block**

Replace with:
```ts
    case "google": {
      const registry = tryResolve<AIProviderRegistry>(AIProviderRegistryName);
      const google = registry?.get("google");
      if (google) {
        return google.createModel(upstreamModelId, {
          credential: apiToken,
          baseURL,
          name: "veryfront-cloud",
          fetch,
        });
      }
      throw new Error(
        "Google provider not installed. Add @veryfront/ext-google to use google/* models via veryfront-cloud.",
      );
    }
```

Leave any other `case` blocks (default, openai, anthropic) untouched — they were rewired in PRs 11/12.

- [ ] **Step 3: Type-check**

Run: `deno check src/provider/veryfront-cloud/provider.ts`
Expected: no errors. If "Unused variable `createGoogleModelRuntime`" surfaces, remove that import (this should be the last remaining direct factory import in this file — confirm with `grep`).

- [ ] **Step 4: Run cloud provider tests**

Run: `deno test --no-check --allow-all src/provider/veryfront-cloud/`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/provider/veryfront-cloud/provider.ts
git commit -m "refactor(provider): veryfront-cloud google case uses AIProviderRegistry"
```

---

### Task 5: Integration test for `ext-google`

**Purpose:** confirm priming → setup → registry has `"google"`. Mirrors the PR 11 / PR 12 integration tests.

**File:** `src/extensions/integration.test.ts`

- [ ] **Step 1: Read the existing pattern**

Read the existing `"ext-anthropic registers into the primed AIProviderRegistry"` test added in PR 12. Note the `noopLogger`, `resolve<T>`, and `satisfies ResolvedExtension` shape.

- [ ] **Step 2: Append the ext-google integration test**

Just below the existing ext-anthropic test, add:

```ts
import extGoogle from "../../extensions/ext-google/src/index.ts";

it("ext-google registers into the primed AIProviderRegistry", async () => {
  const registry = createAIProviderRegistry();
  const loader = new ExtensionLoader(noopLogger);
  loader.primeContracts({ [AIProviderRegistryName]: registry });
  await loader.setupAll([
    {
      source: "local-file",
      origin: "virtual://ext-google",
      extension: extGoogle(),
    } satisfies ResolvedExtension,
  ], {});
  const resolved = resolve<AIProviderRegistry>(AIProviderRegistryName);
  assertEquals(resolved, registry);
  assert(registry.has("google"));
  await loader.teardownAll();
});
```

Reuse the imports already at the top of the file. The `extGoogle` import is the only new one.

- [ ] **Step 3: Run the test**

Run: `deno test --no-check --allow-all src/extensions/integration.test.ts --filter "ext-google"`
Expected: PASS (1 passed).

- [ ] **Step 4: Commit**

```bash
git add src/extensions/integration.test.ts
git commit -m "test(extensions): integration test for ext-google registry registration"
```

---

## Phase C — Move implementation into the extension

### Task 6: Migrate Google tests from `runtime-loader.test.ts`

**Purpose:** pre-stage the tests in the extension so they run against the moved implementation as soon as Task 7 lands.

**Files:**
- Create: `extensions/ext-google/src/google-provider.test.ts`
- Modify: `src/provider/runtime-loader.test.ts` (delete migrated blocks)

- [ ] **Step 1: Inventory Google-only test blocks**

```bash
grep -n "createGoogleModelRuntime(\|createGoogleEmbeddingRuntime(" src/provider/runtime-loader.test.ts
```

For each callsite, trace up to the nearest `describe(` or top-level `it(` and note the line range. After PRs 11 and 12, these should be the *only* runtime-factory tests left in the file (Anthropic and OpenAI are gone), so most blocks here are Google-only and migrate cleanly.

Watch for cross-provider tests (rare at this point — most were removed during PR 11). To find any:

```bash
grep -n "createGoogleModelRuntime.*createOpenAIModelRuntime\|createGoogleModelRuntime.*createAnthropicModelRuntime" src/provider/runtime-loader.test.ts
```

If any exist, leave them in core for now — they'd be deleted by PR 14 along with the file.

- [ ] **Step 2: Copy Google-only blocks verbatim into the new test file**

Create `extensions/ext-google/src/google-provider.test.ts`. Start with imports:

```ts
import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertRejects } from "@std/assert";

import {
  ProviderError,
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderRequestError,
} from "veryfront/provider/shared";

import {
  createGoogleEmbeddingRuntime,
  createGoogleModelRuntime,
} from "./google-provider.ts";
```

**Note:** `createGoogleModelRuntime` / `createGoogleEmbeddingRuntime` will be `export`-ed from `./google-provider.ts` in Task 7. The file won't compile until Task 7 lands — that's intentional.

Paste each identified Google `describe`/`it` block verbatim. Inline any helper functions (`collectAsync`, mock fetch builders, etc.) that the migrated blocks depend on.

- [ ] **Step 3: Delete the migrated blocks from `runtime-loader.test.ts`**

Remove the same Google-only blocks. After this step, `runtime-loader.test.ts` may shrink to only shared-helper tests (parseSseChunk, mergeUsage, unwrapToolInputSchema, toOpenAICompatibleMessages). If it's empty after deletion, delete the file in this step and stop importing it from anywhere — note this in the commit body.

If deletion leaves a helper function unused, delete it.

- [ ] **Step 4: Do NOT run tests yet**

The new test file references symbols not yet exported from `./google-provider.ts`. Commit the migration as an isolated change.

- [ ] **Step 5: Commit**

```bash
git add extensions/ext-google/src/google-provider.test.ts \
        src/provider/runtime-loader.test.ts
git commit -m "test(ext-google): migrate Google runtime tests from core runtime-loader"
```

---

### Task 7: Move Google factories + helpers out of core

**This is the largest task in PR 13.** Expect ~1100 lines of code motion (smaller than PR 11/12 because much of the shared plumbing was already extracted in PR 12).

**Files:**
- Modify: `extensions/ext-google/src/google-provider.ts` (paste the moved code)
- Modify: `src/provider/runtime-loader.ts` (delete what moved)

- [ ] **Step 1: Inventory Google-specific symbols in `runtime-loader.ts`**

Run:
```bash
grep -nE "^(export )?(async )?(function|interface|type).*[Gg]oogle|streamGoogle|GoogleEmbedding|GoogleCompatible|GoogleStream|^export function createGoogle" src/provider/runtime-loader.ts
```

Expected hits (line numbers approximate — use the actual ones):

- `export interface GoogleRuntimeConfig` (~line 15)
- `type GoogleCompatibleContent` (~line 272)
- `type GoogleCompatibleRequest` (~line 276)
- `function extractGoogleEmbedding` (~line 301)
- `function extractGoogleUsageTokens` (~line 322)
- `function normalizeGoogleFinishReason` (~line 812)
- `function extractGoogleUsage` (~line 832)
- `function toGoogleContents` (~line 854)
- `function toGoogleTools` (~line 924)
- `function normalizeGoogleToolChoice` (~line 976)
- `function resolveGoogleThinkingConfig` (~line 1044)
- `function buildGoogleGenerationConfig` (~line 1073)
- `function buildGoogleGenerateContentRequest` (~line 1092)
- `function extractFirstGoogleCandidate` (~line 1157)
- `function extractGoogleCandidateParts` (~line 1167)
- `function buildGoogleGenerateResult` (~line 1181)
- `async function* streamGoogleCompatibleParts` (~line 1229)
- `export function createGoogleModelRuntime` (~line 1345)
- `export function createGoogleEmbeddingRuntime` (~line 1416)

For each, confirm it is **not** called from any non-Google code:
```bash
grep -n "<SYMBOL>" src/provider/runtime-loader.ts
```
If a symbol appears only inside moved code, it's safe to move. If shared code calls it, keep it in core and re-export from `src/provider/shared/index.ts`.

Also note `type ProviderKind = "anthropic" | "openai" | "google"` (~line 329). After PR 13, Google-specific code is gone from core, but `ProviderKind` may still be referenced by shared error types (`ProviderError.provider`, `WarningCollector.provider`). Decide:
  - If `ProviderKind` is only used inside code that's about to move → move it too.
  - If it's used by shared code that stays in core → keep the union as-is. The literal `"google"` is a string, not a forbidden import; leaving it in the union has no runtime cost and lets ext-google still construct provider-typed errors.

Pick the second option unless the first becomes obviously cleaner during the move.

- [ ] **Step 2: Rewrite `google-provider.ts` with the moved code**

Replace the current contents of `extensions/ext-google/src/google-provider.ts` with:

```ts
/**
 * Google provider — implements the {@link AIProvider} contract for
 * Google's Generative Language API (direct + via Veryfront Cloud).
 *
 * Ported from `src/provider/runtime-loader.ts` as part of PR 13.
 *
 * @module extensions/ext-google/google-provider
 */

import type {
  AIProvider,
  AIProviderConfig,
  AIProviderEmbeddingConfig,
} from "veryfront/extensions/interfaces";
import type {
  EmbeddingRuntime,
  ModelRuntime,
} from "veryfront/provider/types";
import {
  buildProviderError,
  createWarningCollector,
  getGoogleEmbeddingUrl,
  getGoogleGenerateContentUrl,
  getGoogleStreamGenerateContentUrl,
  isNumberArray,
  mergeUsage,
  parseRetryAfterMs,
  parseSseChunk,
  ProviderError,
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderRequestError,
  readProviderOptions,
  readRecord,
  readTextParts,
  requestJson,
  requestStream,
  stringifyJsonValue,
  TOOL_INPUT_PENDING_THRESHOLD_MS,
  unwrapToolInputSchema,
  withToolInputStatusTransitions,
} from "veryfront/provider/shared";
import type { ProviderWarning, RuntimeUsage } from "veryfront/provider/shared";

// Re-export error classes so extension tests can import them from this module.
export {
  buildProviderError,
  isNumberArray,
  mergeUsage,
  parseRetryAfterMs,
  parseSseChunk,
  ProviderError,
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderRequestError,
  TOOL_INPUT_PENDING_THRESHOLD_MS,
  unwrapToolInputSchema,
  withToolInputStatusTransitions,
};

export interface GoogleRuntimeConfig {
  apiKey?: string;
  baseURL?: string;
  name?: string;
  fetch?: typeof globalThis.fetch;
}

// --- PASTE MOVED CODE BELOW IN THIS ORDER ---
// 1. GoogleCompatibleContent / GoogleCompatibleRequest types
// 2. Helpers (in original-source order):
//    extractGoogleEmbedding, extractGoogleUsageTokens,
//    normalizeGoogleFinishReason, extractGoogleUsage,
//    toGoogleContents, toGoogleTools, normalizeGoogleToolChoice,
//    resolveGoogleThinkingConfig, buildGoogleGenerationConfig,
//    buildGoogleGenerateContentRequest, extractFirstGoogleCandidate,
//    extractGoogleCandidateParts, buildGoogleGenerateResult,
//    streamGoogleCompatibleParts
// 3. export function createGoogleModelRuntime(config, modelId): ModelRuntime { ... }
// 4. export function createGoogleEmbeddingRuntime(config, modelId): EmbeddingRuntime { ... }
// --- END PASTE ---

export class GoogleProvider implements AIProvider {
  readonly id = "google";

  createModel(modelId: string, config: AIProviderConfig): ModelRuntime {
    return createGoogleModelRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: config.name ?? "google",
        fetch: config.fetch,
      },
      modelId,
    );
  }

  createEmbedding(modelId: string, config: AIProviderEmbeddingConfig): EmbeddingRuntime {
    return createGoogleEmbeddingRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: config.name ?? "google",
        fetch: config.fetch,
      },
      modelId,
    );
  }
}
```

Paste all the Google-specific functions/types identified in Step 1 verbatim in the marked section. Do **not** rename anything during the move.

- [ ] **Step 3: Delete the moved code from `runtime-loader.ts`**

Delete each function/type from `src/provider/runtime-loader.ts`:
- `GoogleRuntimeConfig` interface
- `GoogleCompatibleContent` / `GoogleCompatibleRequest` types
- All Google helpers listed in Step 1
- `createGoogleModelRuntime` factory
- `createGoogleEmbeddingRuntime` factory

Do **not** delete:
- Shared plumbing (`buildProviderError`, `requestJson`, `requestStream`, `parseRetryAfterMs`, `parseSseChunk`, `mergeUsage`, `unwrapToolInputSchema`, `readRecord`, `isNumberArray`, `readTextParts`, `stringifyJsonValue`, `readProviderOptions`, `createWarningCollector`, `withToolInputStatusTransitions`, `TOOL_INPUT_PENDING_THRESHOLD_MS`, `toOpenAICompatibleMessages`, `toOpenAICompatibleTools`)
- The `ProviderKind` union and `ProviderError`/`WarningCollector` types — these are cross-provider plumbing
- Any `RuntimeUsage` / `ProviderWarning` types — shared

After this step `runtime-loader.ts` should contain only shared plumbing (no provider-specific factories or helpers). PR 14 will then physically split it into `src/provider/shared/*.ts` files.

- [ ] **Step 4: Type-check iteratively**

Run: `deno check extensions/ext-google/src/google-provider.ts`
Expected: any "cannot find symbol X" indicates a helper still needed. For each:
- If X is Google-only and you missed it → move it.
- If X is shared and not yet exported from `src/provider/shared/index.ts` → add `export` in `runtime-loader.ts` and a re-export line in `shared/index.ts`, then import from `veryfront/provider/shared`.

Then: `deno check src/provider/runtime-loader.ts src/provider/model-registry.ts src/provider/veryfront-cloud/provider.ts`
Expected: all clean. None of these should still reference `createGoogleModelRuntime` or `createGoogleEmbeddingRuntime`.

- [ ] **Step 5: Run tests**

```bash
deno test --no-check --allow-all extensions/ext-google/src/
```
Expected: all migrated Google tests + smoke tests pass.

```bash
deno test --no-check --allow-all src/provider/runtime-loader.test.ts
```
Expected: passes if any tests remain; alternatively the file may have been deleted in Task 6 Step 3.

```bash
deno test --no-check --allow-all src/extensions/integration.test.ts
```
Expected: Task 5's ext-google test plus the prior ext-openai / ext-anthropic tests still pass.

```bash
deno test --no-check --allow-all src/provider/
```
Expected: model-registry + veryfront-cloud tests green.

If any test still imports `createGoogleModelRuntime` from `../runtime-loader.ts`, repoint it at `../../extensions/ext-google/src/google-provider.ts`.

- [ ] **Step 6: Commit**

```bash
git add extensions/ext-google/src/google-provider.ts \
        src/provider/runtime-loader.ts
git commit -m "feat(ext-google): move Google factories out of core"
```

---

### Task 8: Recommendations map + test harness materialization

**Files:**
- Modify: `src/extensions/recommendations.ts`
- Modify: `tests/_helpers/context.ts`

- [ ] **Step 1: Read `src/extensions/recommendations.ts`**

After PRs 11/12, the file maps:
```ts
["AIProviderRegistry", "@veryfront/core"],
["AIProvider:openai", "@veryfront/ext-openai"],
["AIProvider:anthropic", "@veryfront/ext-anthropic"],
["AIProvider:google", "@veryfront/ext-google"],   // may exist as placeholder
```

- [ ] **Step 2: Ensure the `AIProvider:google` entry points at the right package**

If the entry already reads `"@veryfront/ext-google"`, move on. Otherwise add it:

```ts
["AIProvider:google", "@veryfront/ext-google"],
```

- [ ] **Step 3: Locate the ext-anthropic materialization block in `tests/_helpers/context.ts`**

Find the block (added in PR 12) that creates `<projectDir>/extensions/ext-anthropic/index.ts` via `mkdir` + `writeTextFile`.

- [ ] **Step 4: Duplicate the materialization for ext-google**

Directly below the ext-anthropic block, add:

```ts
const extGoogleDir = join(this.projectDir, "extensions", "ext-google");
await mkdir(extGoogleDir, { recursive: true });
const extGoogleReal = resolvePath("extensions/ext-google/src/index.ts");
await writeTextFile(
  join(extGoogleDir, "index.ts"),
  `export { default } from "${"file://" + extGoogleReal}";\n`,
);
```

Match the helper-name conventions already in the file.

- [ ] **Step 5: Add `registerExtGoogleForTests`**

Find `registerExtAnthropicForTests()`. Add a sibling helper modelled on it:

```ts
import extGoogle from "../../extensions/ext-google/src/index.ts";

async function registerExtGoogleForTests(): Promise<void> {
  const existing = tryResolve<AIProviderRegistry>(AIProviderRegistryName);
  const registry = existing ?? createAIProviderRegistry();
  if (!existing) registerContract(AIProviderRegistryName, registry);
  const ext = extGoogle();
  await ext.setup?.({
    config: {},
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    provide: () => {},
    get: () => undefined,
    require: <T>(name: string): T => {
      if (name === AIProviderRegistryName) return registry as unknown as T;
      throw new Error(`unexpected require(${name})`);
    },
  } as never);
}
```

The `tryResolve`-then-reuse pattern is the same one PR 12 introduced for `registerExtAnthropicForTests` so all three providers share one registry.

- [ ] **Step 6: Call `registerExtGoogleForTests()` everywhere the others are called**

Find call sites of `registerExtOpenAIForTests()` / `registerExtAnthropicForTests()` (typically at module load and inside `withTestContext`'s setup). Add `await registerExtGoogleForTests()` right after each. Order doesn't matter — registration is idempotent per id.

- [ ] **Step 7: Run the tests**

Run: `deno test --no-check --allow-all tests/`
Expected: same baseline as after PR 12. Any new failure resolving `google/*` means the harness isn't priming the registry — trace back to Step 5/6.

- [ ] **Step 8: Commit**

```bash
git add src/extensions/recommendations.ts tests/_helpers/context.ts
git commit -m "test(harness): materialize ext-google + recommendations entry"
```

---

## Phase D — Validate

### Task 9: Full test suite + lint + draft PR

**Files:** none (validation only).

- [ ] **Step 1: Run `deno fmt`**

Run: `deno fmt`
Inspect the diff. Stage and commit only files this PR modified:

```bash
git add extensions/ext-google/ src/provider/runtime-loader.ts src/provider/runtime-loader.test.ts \
        src/provider/model-registry.ts src/provider/veryfront-cloud/provider.ts \
        src/extensions/integration.test.ts src/extensions/recommendations.ts \
        src/extensions/interfaces/ \
        tests/_helpers/context.ts deno.json
git commit -m "chore: apply deno fmt to PR 13 files"
```

- [ ] **Step 2: Run `deno lint`**

Run: `deno lint`
Fix `no-unused-vars` from the Google deletion and commit:

```bash
git commit -m "chore: fix lint errors in PR 13 code"
```

Only fix errors in PR 13's own newly-added/modified code.

- [ ] **Step 3: Run the full test suite**

```bash
deno task test
```

Or:
```bash
deno test --no-check --allow-all src/ extensions/ cli/
```

Expected: same baseline pass/fail counts as after PR 12, plus all new ext-google tests passing.

- [ ] **Step 4: Run the pre-push hook manually**

```bash
SKIP_E2E=1 bash scripts/hooks/pre-push
```

Expected: `All pre-push checks passed!`. If a pre-existing failure appears (e.g. lint:style for `@babel/parser`), confirm it predates the branch by checking `feat/ext-anthropic` and document — don't try to fix unrelated baseline failures here.

- [ ] **Step 5: Push the branch**

```bash
git push -u origin feat/ext-google
```

- [ ] **Step 6: Open the draft PR**

```bash
gh pr create --draft --base feat/ext-anthropic \
  --title "feat(ext-google): extract Google provider behind AIProviderRegistry contract" \
  --body "$(cat <<'EOF'
## Summary

Implements PR 13 of the multi-LLM provider extensions plan — extracts Google from core into `@veryfront/ext-google`, registered under the `AIProvider:google` contract. After this PR, `runtime-loader.ts` contains only shared plumbing — no provider-specific factories — paving the way for PR 14 to physically split the file.

## Scope

- **Phase A — Scaffold:** workspace manifest + GoogleProvider wrapper + smoke tests (covers both `createModel` + `createEmbedding`)
- **Phase B — Rewire consumers:** model-registry + veryfront-cloud route through the registry; clear throw when ext-google is missing
- **Phase C — Move implementation:** `createGoogleModelRuntime` + `createGoogleEmbeddingRuntime` + all Google-specific helpers (~1100 lines) moved out of `runtime-loader.ts`; tests migrated from `runtime-loader.test.ts` into the extension
- **Phase D — Validate:** lint clean; pre-push hook green

## References

- Spec: `docs/superpowers/specs/2026-04-23-multi-llm-provider-extensions-design.md`
- Plan: `docs/superpowers/plans/2026-04-26-pr13-ext-google.md`
- Pattern reference: PRs 11 (ext-openai) + 12 (ext-anthropic)

## Test plan

- [ ] Review the 2 rewire points (`model-registry.ts` google branch, `veryfront-cloud/provider.ts` google case) handle missing ext-google with clear errors
- [ ] Confirm `runtime-loader.ts` has no provider-specific factories left
- [ ] Verify migrated ext-google tests cover all prior Google language + embedding behavior
- [ ] Check that `AIProviderRegistry` contains all three providers after `setupAll` when ext-openai + ext-anthropic + ext-google all load together

## Out of scope

- Physical move of shared plumbing out of `runtime-loader.ts` into per-concern files (PR 14)
- Deleting `runtime-loader.ts` entirely (PR 14)
- Example / docs updates (PR 15)
EOF
)"
```

Mark draft, link in tracker, stop.

---

## Rollback and compatibility

- **Between Task 1 and Task 7**, `runtime-loader.ts` still exports `createGoogleModelRuntime` and `createGoogleEmbeddingRuntime`; `model-registry.ts` and `veryfront-cloud/provider.ts` go through the registry but throw when the extension is missing. If ext-google is loaded, Google works via the registry; if not, `google/*` resolution throws a clear "not installed" error. Same deliberate break pattern as PRs 11/12 — see spec §4.
- **After Task 7**, core contains no Google code. The throw path is the only behavior when ext-google is missing. `runtime-loader.ts` now contains only shared plumbing.
- **OpenAI and Anthropic are untouched.** Their extensions and rewires from PRs 11 and 12 carry through unchanged.

## Out of scope for this PR

- Physically relocating shared plumbing out of `runtime-loader.ts` into `src/provider/shared/*.ts` files (PR 14)
- Deleting `src/provider/runtime-loader.ts` entirely (PR 14)
- Docs and example-extension updates (PR 15)
