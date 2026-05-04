# PR 12: `@veryfront/ext-anthropic` Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the Anthropic runtime (`createAnthropicModelRuntime` + its private helpers) out of core's `src/provider/runtime-loader.ts` into a standalone workspace extension `@veryfront/ext-anthropic`, registered into the existing `AIProviderRegistry` contract.

**Architecture:** Mirrors the pattern proven by PR 11 (`ext-openai`). The registry contract, `ExtensionLoader.primeContracts()`, bootstrap wiring, and `src/provider/shared/` barrel are already in place — PR 12 reuses all of them. Anthropic is structurally simpler than OpenAI: no Responses API, no embeddings, one factory. The extension exposes only `createModel()` on the `AIProvider` interface (no `createEmbedding`, no `createResponses`).

**Tech Stack:** Deno workspace members, TypeScript, `@std/testing/bdd`, `@std/assert`. No new dependencies. Anthropic uses `x-api-key` + `anthropic-version` headers via the existing `createAnthropicRequestInit` helper in `src/provider/runtime-loader/provider-request-init.ts` (already re-exported from the shared barrel).

**Branch:** `feat/ext-anthropic` (branched off `feat/ext-openai`).

---

## Pre-reqs (already landed in `feat/ext-openai`)

Do not re-do these — they are the infrastructure this PR builds on:

- `src/extensions/interfaces/ai-provider.ts` — `AIProvider`, `AIProviderConfig`, `AIProviderRegistry`, `AIProviderRegistryName`
- `src/extensions/registries/ai-provider-registry.ts` + `createAIProviderRegistry()`
- `ExtensionLoader.primeContracts(record)` — survives `teardownAll()` reset
- `orchestrateExtensions({ primeContracts })` option
- `src/server/bootstrap.ts` primes the registry before `setupAll`
- `src/provider/shared/index.ts` barrel re-exports retry/error/SSE helpers + URL + request-init builders
- `tests/_helpers/context.ts` has `registerExtOpenAIForTests()` — Task 9 adds the sibling for Anthropic

## File map

**New files:**
- `extensions/ext-anthropic/deno.json`
- `extensions/ext-anthropic/src/index.ts`
- `extensions/ext-anthropic/src/index.test.ts`
- `extensions/ext-anthropic/src/anthropic-provider.ts`
- `extensions/ext-anthropic/src/anthropic-provider.test.ts`

**Modified files:**
- `deno.json` (root) — add workspace member
- `src/provider/runtime-loader.ts` — delete Anthropic factory + helpers
- `src/provider/runtime-loader.test.ts` — delete migrated Anthropic test blocks
- `src/provider/model-registry.ts` — rewire `"anthropic"` autoinit branch through registry
- `src/provider/veryfront-cloud/provider.ts` — rewire `"anthropic"` case through registry
- `src/extensions/recommendations.ts` — add `AIProvider:anthropic` recommendation
- `src/extensions/integration.test.ts` — add ext-anthropic integration test
- `tests/_helpers/context.ts` — materialize `<projectDir>/extensions/ext-anthropic/index.ts` + `registerExtAnthropicForTests()`

## Task overview

| Phase | Task | Scope |
|-------|------|-------|
| **A — Scaffold** | 1 | Workspace manifest + root `deno.json` member |
| | 2 | AnthropicProvider wrapper (delegating) + factory + smoke tests |
| **B — Rewire consumers** | 3 | `model-registry.ts` anthropic branch → registry with clear-error fallback |
| | 4 | `veryfront-cloud/provider.ts` anthropic case → registry |
| | 5 | Integration test for ext-anthropic |
| **C — Move implementation** | 6 | Migrate Anthropic tests from `runtime-loader.test.ts` |
| | 7 | Move `createAnthropicModelRuntime` + Anthropic-specific helpers into `anthropic-provider.ts`, delete from core |
| | 8 | Recommendations map + test-harness materialization |
| **D — Validate** | 9 | Full test suite + lint + draft PR |

---

## Phase A — Scaffold `ext-anthropic` workspace

### Task 1: Workspace manifest

**Files:**
- Create: `extensions/ext-anthropic/deno.json`
- Modify: `deno.json` (root)

- [ ] **Step 1: Create `extensions/ext-anthropic/deno.json`**

```json
{
  "name": "@veryfront/ext-anthropic",
  "version": "0.1.0",
  "exports": "./src/index.ts",
  "veryfront": {
    "extension": true,
    "capabilities": [
      { "type": "contract", "name": "AIProvider:anthropic" }
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

Open `deno.json` at repo root. Locate the `"workspace": [...]` array — it includes `./extensions/ext-openai`, `./extensions/ext-babel`, `./extensions/ext-redis` (sorted order). Add `./extensions/ext-anthropic` before `./extensions/ext-babel`:

```json
  "workspace": [
    "./extensions/ext-anthropic",
    "./extensions/ext-babel",
    "./extensions/ext-openai",
    "./extensions/ext-redis"
  ],
```

Keep every other existing entry untouched.

- [ ] **Step 3: Validate JSON**

Run: `deno check --config deno.json`
Expected: clean — validates JSON. No `src/` directory exists yet, so type-checking doesn't touch the extension.

- [ ] **Step 4: Commit**

```bash
git add extensions/ext-anthropic/deno.json deno.json
git commit -m "feat(ext-anthropic): scaffold workspace manifest"
```

---

### Task 2: AnthropicProvider wrapper + factory + smoke tests

**Why this task exists.** Prove the provider class integrates with the registry end-to-end *before* moving the ~1500 lines of Anthropic factory code. Task 7 later replaces the placeholder delegation with the real ported code.

The AnthropicProvider exposes **only** `createModel()` — not `createEmbedding` or `createResponses`. The `AIProvider` interface (see `src/extensions/interfaces/ai-provider.ts`) makes these optional.

**Files:**
- Create: `extensions/ext-anthropic/src/anthropic-provider.ts`
- Create: `extensions/ext-anthropic/src/index.ts`
- Create: `extensions/ext-anthropic/src/index.test.ts`

- [ ] **Step 1: Create the delegating wrapper**

Create `extensions/ext-anthropic/src/anthropic-provider.ts`:

```ts
/**
 * Anthropic provider — implements the {@link AIProvider} contract.
 *
 * Initial implementation delegates to the legacy `createAnthropicModelRuntime`
 * factory still living in core's `runtime-loader.ts`. Task 7 moves that
 * factory into this file along with all Anthropic-specific helpers.
 */

import type {
  AIProvider,
  AIProviderConfig,
} from "veryfront/extensions/interfaces";
import type { ModelRuntime } from "veryfront/provider/types";
import { createAnthropicModelRuntime } from "../../../src/provider/runtime-loader.ts";

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic";

  createModel(modelId: string, config: AIProviderConfig): ModelRuntime {
    // Anthropic accepts either `apiKey` (x-api-key) or `authToken`
    // (Authorization: Bearer). The normalized `credential` field maps to
    // `apiKey` by default; callers that need an auth token pass it via the
    // optional `authToken` override on the config record.
    const anthropicConfig = {
      apiKey: config.credential,
      authToken: typeof config.authToken === "string" ? config.authToken : undefined,
      baseURL: config.baseURL,
      name: config.name ?? "anthropic",
      fetch: config.fetch,
    };
    return createAnthropicModelRuntime(anthropicConfig, modelId);
  }
}
```

- [ ] **Step 2: Create the `ExtensionFactory` entry point**

Create `extensions/ext-anthropic/src/index.ts`:

```ts
/**
 * @veryfront/ext-anthropic — registers the Anthropic provider into the
 * core `AIProviderRegistry`.
 *
 * @module extensions/ext-anthropic
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type { AIProviderRegistry } from "veryfront/extensions/interfaces";
import { AIProviderRegistryName } from "veryfront/extensions/interfaces";
import { AnthropicProvider } from "./anthropic-provider.ts";

const extAnthropic: ExtensionFactory = () => {
  const provider = new AnthropicProvider();
  return {
    name: "ext-anthropic",
    version: "0.1.0",
    capabilities: [{ type: "contract", name: "AIProvider:anthropic" }],
    setup(ctx) {
      const registry = ctx.require<AIProviderRegistry>(AIProviderRegistryName);
      registry.register(provider);
      ctx.logger.info("[ext-anthropic] Anthropic provider registered");
    },
    teardown() {
      // No resources to release.
    },
  };
};

export default extAnthropic;
export { AnthropicProvider };
```

- [ ] **Step 3: Write the smoke test**

Create `extensions/ext-anthropic/src/index.test.ts`:

```ts
import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import extAnthropic, { AnthropicProvider } from "./index.ts";
import type { AIProviderRegistry } from "veryfront/extensions/interfaces";

describe("ext-anthropic", () => {
  it("factory descriptor advertises the AIProvider:anthropic capability", () => {
    const ext = extAnthropic();
    assertEquals(ext.name, "ext-anthropic");
    assertEquals(ext.capabilities?.[0], {
      type: "contract",
      name: "AIProvider:anthropic",
    });
  });

  it("setup registers the provider in the AIProviderRegistry", () => {
    const ext = extAnthropic();
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
    assert(registered.anthropic instanceof AnthropicProvider);
  });
});
```

- [ ] **Step 4: Run the smoke tests**

Run: `deno test --no-check --allow-all extensions/ext-anthropic/src/index.test.ts`
Expected: `2 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add extensions/ext-anthropic/src/
git commit -m "feat(ext-anthropic): AnthropicProvider wrapper + factory + smoke tests"
```

---

## Phase B — Rewire consumers

### Task 3: Rewire `model-registry.ts::autoInitializeFromEnv()` anthropic branch

**File:** `src/provider/model-registry.ts`

The current `"anthropic"` branch lives immediately after the `"openai"` branch that PR 11 rewired. Find the block starting `if (!manager.has("anthropic")) { manager.registerShared("anthropic", (id) => { ...` — it calls `getAnthropicEnvConfig()` and `createAnthropicModelRuntime`.

- [ ] **Step 1: Verify the imports needed already exist**

Check the top of the file. After PR 11, these three imports were added:
```ts
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { AIProviderRegistry } from "#veryfront/extensions/interfaces/index.ts";
import { AIProviderRegistryName } from "#veryfront/extensions/interfaces/index.ts";
```

If any are missing, add them. No new imports are needed for this task.

- [ ] **Step 2: Rewrite the `"anthropic"` branch**

Find `if (!manager.has("anthropic"))` and replace its body:

```ts
  if (!manager.has("anthropic")) {
    manager.registerShared("anthropic", (id) => {
      const config = getAnthropicEnvConfig();
      if (!config.apiKey) {
        throw toError(
          createError({
            type: "config",
            message:
              "ANTHROPIC_API_KEY not set. Set the environment variable or register a custom provider with registerModelProvider().",
          }),
        );
      }
      const registry = tryResolve<AIProviderRegistry>(AIProviderRegistryName);
      const provider = registry?.get("anthropic");
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
            "Anthropic provider not installed. Add @veryfront/ext-anthropic to use anthropic/* models.",
        }),
      );
    });
  }
```

**Why throw instead of fallback?** Task 7 deletes `createAnthropicModelRuntime` from core; there is no fallback to call. The throw matches the pattern PR 11 established after moving OpenAI factories.

Leave the `"google"`, `"local"`, `"veryfront-cloud"` branches untouched — PR 13 handles Google.

- [ ] **Step 3: Type-check**

Run: `deno check src/provider/model-registry.ts`
Expected: no errors.

- [ ] **Step 4: Run provider tests**

Run: `deno test --no-check --allow-all src/provider/`
Expected: all tests pass. If any test previously asserted the direct `createAnthropicModelRuntime` call path, either update the assertion to expect the throw (test must prime a provider to succeed) or seed the registry with a stub provider. Note any test adjustments in the commit body.

- [ ] **Step 5: Commit**

```bash
git add src/provider/model-registry.ts
git commit -m "refactor(provider): anthropic autoinit delegates to AIProviderRegistry"
```

---

### Task 4: Rewire `veryfront-cloud/provider.ts` anthropic case

**File:** `src/provider/veryfront-cloud/provider.ts`

The current `case "anthropic":` block calls `createAnthropicModelRuntime` directly. Rewrite to use the registry.

- [ ] **Step 1: Verify the imports already exist**

The three registry imports were added in PR 11:
```ts
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { AIProviderRegistry } from "#veryfront/extensions/interfaces/index.ts";
import { AIProviderRegistryName } from "#veryfront/extensions/interfaces/index.ts";
```

No new imports needed.

- [ ] **Step 2: Rewrite the `case "anthropic"` block**

Locate:
```ts
    case "anthropic":
      return createAnthropicModelRuntime({
        authToken: apiToken,
        baseURL,
        name: "veryfront-cloud",
        fetch,
      }, upstreamModelId);
```

Replace with:
```ts
    case "anthropic": {
      const registry = tryResolve<AIProviderRegistry>(AIProviderRegistryName);
      const anthropic = registry?.get("anthropic");
      if (anthropic) {
        return anthropic.createModel(upstreamModelId, {
          credential: apiToken,
          authToken: apiToken,
          baseURL,
          name: "veryfront-cloud",
          fetch,
        });
      }
      throw new Error(
        "Anthropic provider not installed. Add @veryfront/ext-anthropic to use anthropic/* models via veryfront-cloud.",
      );
    }
```

**Note:** Veryfront Cloud passes its upstream token as `authToken` (Bearer). The `AnthropicProvider.createModel` wrapper (Task 2 Step 1) reads `config.authToken` from the config record and uses it in preference to `config.credential` when set. Both fields are passed so the downstream factory can pick whichever auth mode is active.

Leave `case "google":` (and any others) untouched.

- [ ] **Step 3: Type-check**

Run: `deno check src/provider/veryfront-cloud/provider.ts`
Expected: no errors. If "Unused variable `createAnthropicModelRuntime`" surfaces, remove that import.

- [ ] **Step 4: Run cloud provider tests**

Run: `deno test --no-check --allow-all src/provider/veryfront-cloud/`
Expected: all tests pass. If a test hits the anthropic case without priming the registry, update the assertion to expect the throw or seed a provider stub in the test setup.

- [ ] **Step 5: Commit**

```bash
git add src/provider/veryfront-cloud/provider.ts
git commit -m "refactor(provider): veryfront-cloud anthropic case uses AIProviderRegistry"
```

---

### Task 5: Integration test for `ext-anthropic`

**Purpose:** confirm that from priming the registry → extension setup → registry has `"anthropic"`. Mirrors the PR 11 integration test for ext-openai.

**File:** `src/extensions/integration.test.ts`

- [ ] **Step 1: Read the existing pattern**

Read the existing `"ext-openai registers into the primed AIProviderRegistry"` test added in PR 11. Note:
- Uses `noopLogger` (not `silentLogger`)
- Uses `resolve<T>(name)` from `./index.ts` (already in scope)
- Constructs the inline extension with `satisfies ResolvedExtension` — fields are `source: "local-file"`, `origin: "virtual://…"`, `extension: …`

- [ ] **Step 2: Append the ext-anthropic integration test**

Just below the existing `ext-openai` test, add:

```ts
import extAnthropic from "../../extensions/ext-anthropic/src/index.ts";

it("ext-anthropic registers into the primed AIProviderRegistry", async () => {
  const registry = createAIProviderRegistry();
  const loader = new ExtensionLoader(noopLogger);
  loader.primeContracts({ [AIProviderRegistryName]: registry });
  await loader.setupAll([
    {
      source: "local-file",
      origin: "virtual://ext-anthropic",
      extension: extAnthropic(),
    } satisfies ResolvedExtension,
  ], {});
  const resolved = resolve<AIProviderRegistry>(AIProviderRegistryName);
  assertEquals(resolved, registry);
  assert(registry.has("anthropic"));
  await loader.teardownAll();
});
```

Use whatever `createAIProviderRegistry`, `AIProviderRegistryName`, `AIProviderRegistry`, `ExtensionLoader`, `noopLogger`, `resolve`, `ResolvedExtension` imports were brought in for the ext-openai test — they're already at the top of the file.

- [ ] **Step 3: Run the test**

Run: `deno test --no-check --allow-all src/extensions/integration.test.ts --filter "ext-anthropic"`
Expected: PASS (1 passed).

- [ ] **Step 4: Commit**

```bash
git add src/extensions/integration.test.ts
git commit -m "test(extensions): integration test for ext-anthropic registry registration"
```

---

## Phase C — Move implementation into the extension

### Task 6: Migrate Anthropic tests from `runtime-loader.test.ts`

**Purpose:** pre-stage the tests in the extension so they run against the moved implementation as soon as Task 7 lands. These tests currently pass against the in-core factory via the core-relative import; after Task 7 they'll reference the ported factory via an extension-relative import.

**Files:**
- Create: `extensions/ext-anthropic/src/anthropic-provider.test.ts`
- Modify: `src/provider/runtime-loader.test.ts` (delete migrated blocks)

- [ ] **Step 1: Inventory Anthropic-only test blocks**

```bash
grep -n "createAnthropicModelRuntime(" src/provider/runtime-loader.test.ts
```

Expected output includes ~30 callsites across several `describe()` / `it()` blocks. For each, trace up to the nearest `describe(` or top-level `it(` and note the line range.

Exclude **cross-provider** tests that also use `createOpenAIModelRuntime` or `createGoogleModelRuntime` (they test inter-provider interactions and stay in core). To find them:

```bash
grep -n -l "createAnthropicModelRuntime.*createOpenAIModelRuntime\|createAnthropicModelRuntime.*createGoogleModelRuntime" src/provider/runtime-loader.test.ts
```

Or read each enclosing block and check.

- [ ] **Step 2: Copy Anthropic-only blocks verbatim into the new test file**

Create `extensions/ext-anthropic/src/anthropic-provider.test.ts`. Start with the imports the original file uses, adapting the source of the factory:

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

import { createAnthropicModelRuntime } from "./anthropic-provider.ts";
```

**Note:** `createAnthropicModelRuntime` will be `export`-ed from `./anthropic-provider.ts` in Task 7. For the moment the symbol doesn't exist there — that's intentional; the test file compiles only after Task 7.

Then paste each identified Anthropic `describe`/`it` block verbatim. If helper functions at the top of `runtime-loader.test.ts` (e.g. `collectAsync`, `readRequestBody`, `readRequestHeader`, mock fetch builders) are used by these blocks, inline them at the top of `anthropic-provider.test.ts` (ext-openai did the same).

- [ ] **Step 3: Delete the migrated blocks from `runtime-loader.test.ts`**

Remove the same Anthropic-only `describe`/`it` blocks. Keep OpenAI (via `../../extensions/ext-openai/src/openai-provider.ts` imports after PR 11's Task 14), Google, and cross-provider blocks.

If deletion leaves a helper function unused in `runtime-loader.test.ts`, either delete it or leave it — both are acceptable; lint will flag unused helpers that you should then delete.

- [ ] **Step 4: Do NOT run tests yet**

The new test file references `createAnthropicModelRuntime` from `./anthropic-provider.ts`, which doesn't export it until Task 7. Running now produces a missing-symbol error — expected. Commit anyway to make the migration reviewable as an isolated change.

- [ ] **Step 5: Commit**

```bash
git add extensions/ext-anthropic/src/anthropic-provider.test.ts \
        src/provider/runtime-loader.test.ts
git commit -m "test(ext-anthropic): migrate Anthropic runtime tests from core runtime-loader"
```

---

### Task 7: Move `createAnthropicModelRuntime` + Anthropic-specific helpers out of core

**This is the largest task in PR 12.** Expect ~1500 lines of code motion (smaller than PR 11 Task 14 because Anthropic has one factory, not three). Follow the dependency closure:

1. Move the `createAnthropicModelRuntime` factory.
2. Move every private helper it calls that is used **only** by Anthropic code (not by OpenAI or Google — OpenAI already moved in PR 11 so this is mostly "not Google").
3. Leave shared helpers in `runtime-loader.ts` (they're already `export`-ed and re-exported from `src/provider/shared/`).

**Files:**
- Modify: `extensions/ext-anthropic/src/anthropic-provider.ts` (paste the moved code)
- Modify: `src/provider/runtime-loader.ts` (delete what moved)

- [ ] **Step 1: Inventory Anthropic-specific symbols in `runtime-loader.ts`**

Run:
```bash
grep -n "^function.*[Aa]nthropic\|^async function.*[Aa]nthropic\|^export function.*[Aa]nthropic\|streamAnthropic\|AnthropicCitation\b\|AnthropicCompatibleMessage\b\|AnthropicCompatibleRequest\b\|AnthropicStreamToolCallState\b\|AnthropicStreamReasoningState\b\|^export interface AnthropicRuntimeConfig" src/provider/runtime-loader.ts
```

Expected hits (line numbers approximate — use the actual ones):

- `export interface AnthropicRuntimeConfig` (~line 40)
- `type AnthropicCompatibleMessage` (~line 362)
- `type AnthropicCompatibleRequest` (~line 366)
- `type AnthropicStreamToolCallState` (~line 384)
- `type AnthropicStreamReasoningState` (~line 390)
- `function normalizeAnthropicFinishReason` (~line 627)
- `function extractAnthropicUsage` (~line 655)
- `function normalizeAnthropicToolChoice` (~line 706)
- `function pushAnthropicUserContent` (~line 743)
- `function resolveAnthropicCacheControlBlock` (~line 770)
- `function toAnthropicMessages` (~line 782)
- `function resolveAnthropicProviderType` (~line 896)
- `function toAnthropicTools` (~line 904)
- `function getAnthropicModelCapabilities` (~line 971)
- `function resolveAnthropicMaxTokens` (~line 999)
- `function resolveAnthropicThinkingBudget` (~line 1018)
- `function buildAnthropicMessagesRequest` (~line 1040)
- `type AnthropicCitation` (~line 1186)
- `function normalizeAnthropicCitation` (~line 1214)
- `function buildAnthropicGenerateResult` (~line 1234)
- `async function* streamAnthropicCompatibleParts` (~line 1375)
- `export function createAnthropicModelRuntime` (~line 3331)

For each, confirm it is **not** called from any non-Anthropic code:
```bash
grep -n "<SYMBOL>" src/provider/runtime-loader.ts
```
If a symbol appears only inside moved code blocks, it's safe to move. If any non-Anthropic code (e.g. Google's factory, shared helpers) calls it, keep it in core and export it from the shared barrel instead.

- [ ] **Step 2: Rewrite `anthropic-provider.ts` with the moved code**

Replace the current contents of `extensions/ext-anthropic/src/anthropic-provider.ts` with:

```ts
/**
 * Anthropic provider — implements the {@link AIProvider} contract for
 * Anthropic's Messages API (direct + via Veryfront Cloud / Bedrock-compatible
 * proxies).
 *
 * Ported from `src/provider/runtime-loader.ts` as part of PR 12.
 *
 * @module extensions/ext-anthropic/anthropic-provider
 */

import type {
  AIProvider,
  AIProviderConfig,
} from "veryfront/extensions/interfaces";
import type { ModelRuntime } from "veryfront/provider/types";
import {
  buildProviderError,
  createAnthropicRequestInit,
  createWarningCollector,
  getAnthropicMessagesUrl,
  isNumberArray,
  mergeUsage,
  parseRetryAfterMs,
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
  withToolInputStatusTransitions,
} from "veryfront/provider/shared";
import type { RuntimePromptMessage } from "veryfront/provider/shared";

// Re-export error classes so extension tests can import them from this module.
export {
  buildProviderError,
  isNumberArray,
  mergeUsage,
  parseRetryAfterMs,
  ProviderError,
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderRequestError,
  TOOL_INPUT_PENDING_THRESHOLD_MS,
  withToolInputStatusTransitions,
};

export interface AnthropicRuntimeConfig {
  apiKey?: string;
  authToken?: string;
  baseURL?: string;
  name?: string;
  fetch?: typeof globalThis.fetch;
}

// --- PASTE MOVED CODE BELOW IN THIS ORDER ---
// 1. AnthropicCompatibleMessage / AnthropicCompatibleRequest / AnthropicStream* / AnthropicCitation types
// 2. Helpers (alphabetical or original order — either is fine):
//    normalizeAnthropicFinishReason, extractAnthropicUsage,
//    normalizeAnthropicToolChoice, pushAnthropicUserContent,
//    resolveAnthropicCacheControlBlock, toAnthropicMessages,
//    resolveAnthropicProviderType, toAnthropicTools,
//    getAnthropicModelCapabilities, resolveAnthropicMaxTokens,
//    resolveAnthropicThinkingBudget, buildAnthropicMessagesRequest,
//    normalizeAnthropicCitation, buildAnthropicGenerateResult,
//    streamAnthropicCompatibleParts
// 3. export function createAnthropicModelRuntime(config, modelId): ModelRuntime { ... }
// --- END PASTE ---

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic";

  createModel(modelId: string, config: AIProviderConfig): ModelRuntime {
    return createAnthropicModelRuntime(
      {
        apiKey: config.credential,
        authToken: typeof config.authToken === "string" ? config.authToken : undefined,
        baseURL: config.baseURL,
        name: config.name ?? "anthropic",
        fetch: config.fetch,
      },
      modelId,
    );
  }
}
```

Paste all the Anthropic-specific functions/types identified in Step 1 verbatim in the marked section. Do **not** rename anything during the move — copy names exactly.

- [ ] **Step 3: Delete the moved code from `runtime-loader.ts`**

Delete each function/type from `src/provider/runtime-loader.ts`:
- `AnthropicRuntimeConfig` interface (~line 40)
- `AnthropicCompatibleMessage` / `AnthropicCompatibleRequest` / `AnthropicStream*` / `AnthropicCitation` types
- All Anthropic helpers listed in Step 1
- `createAnthropicModelRuntime` factory

Do **not** delete:
- `toOpenAICompatibleMessages` / `toOpenAICompatibleTools` — shared (Google may still reference them; verify with grep)
- Shared plumbing (buildProviderError, requestJson, requestStream, etc.)
- Google helpers and `createGoogleModelRuntime` — PR 13 handles those

- [ ] **Step 4: Type-check iteratively**

Run: `deno check extensions/ext-anthropic/src/anthropic-provider.ts`
Expected: any "cannot find symbol X" indicates a helper still needed. For each:
- If X is Anthropic-only and you missed it → move it too.
- If X is shared and not yet in `src/provider/shared/index.ts` → add `export` in `runtime-loader.ts` and a re-export line in `shared/index.ts`, then import from `veryfront/provider/shared`.

Iterate until clean.

Then: `deno check src/provider/runtime-loader.ts src/provider/model-registry.ts src/provider/veryfront-cloud/provider.ts`
Expected: all clean. These files must not reference `createAnthropicModelRuntime` (removed in Task 3 + Task 4) or any deleted symbol.

- [ ] **Step 5: Run tests**

Run tests in this order:

```bash
deno test --no-check --allow-all extensions/ext-anthropic/src/
```
Expected: all migrated Anthropic tests (from Task 6) pass, plus the smoke tests from Task 2.

```bash
deno test --no-check --allow-all src/provider/runtime-loader.test.ts
```
Expected: remaining Google + cross-provider tests pass. Anthropic blocks were deleted in Task 6 Step 3.

```bash
deno test --no-check --allow-all src/extensions/integration.test.ts
```
Expected: Task 5's ext-anthropic test still passes.

```bash
deno test --no-check --allow-all src/provider/
```
Expected: model-registry + veryfront-cloud tests green.

If any test still imports `createAnthropicModelRuntime` from `../runtime-loader.ts`, update the import to point at `../../extensions/ext-anthropic/src/anthropic-provider.ts` (same cross-workspace pattern PR 11 used for `runtime-loader.test.ts`'s remaining cross-provider test).

- [ ] **Step 6: Commit**

```bash
git add extensions/ext-anthropic/src/anthropic-provider.ts \
        src/provider/runtime-loader.ts
git commit -m "feat(ext-anthropic): move createAnthropicModelRuntime factory out of core"
```

---

### Task 8: Recommendations map + test harness materialization

**Files:**
- Modify: `src/extensions/recommendations.ts`
- Modify: `tests/_helpers/context.ts`

- [ ] **Step 1: Read `src/extensions/recommendations.ts`**

The file maps contract names to recommended package names. After PR 11, it has entries like:
```ts
["AIProviderRegistry", "@veryfront/core"],
["AIProvider:openai", "@veryfront/ext-openai"],
["AIProvider:anthropic", "@veryfront/ext-anthropic"],  // may or may not exist yet
["AIProvider:google", "@veryfront/ext-google"],
```

- [ ] **Step 2: Ensure the AIProvider:anthropic entry points at the right package**

If the entry already reads `"@veryfront/ext-anthropic"`, move on. If it's a placeholder (e.g. still `undefined` or missing), add it:

```ts
["AIProvider:anthropic", "@veryfront/ext-anthropic"],
```

- [ ] **Step 3: Read `tests/_helpers/context.ts` and locate the ext-openai materialization block**

Look for the block that creates `<projectDir>/extensions/ext-openai/index.ts` via `mkdir` + `writeTextFile` + `export { default } from "file://…"`. Note the exact helpers used (`resolvePath`, `join`, etc.).

- [ ] **Step 4: Duplicate the materialization for ext-anthropic**

Directly below the ext-openai block, add:

```ts
const extAnthropicDir = join(this.projectDir, "extensions", "ext-anthropic");
await mkdir(extAnthropicDir, { recursive: true });
const extAnthropicReal = resolvePath("extensions/ext-anthropic/src/index.ts");
await writeTextFile(
  join(extAnthropicDir, "index.ts"),
  `export { default } from "${"file://" + extAnthropicReal}";\n`,
);
```

Use the exact helper names (`resolvePath`, `writeTextFile`, etc.) already imported in that file — don't introduce new imports.

- [ ] **Step 5: Duplicate the `registerExtOpenAIForTests` helper as `registerExtAnthropicForTests`**

Find `registerExtOpenAIForTests()` — it creates a fresh `AIProviderRegistry`, registers it at `AIProviderRegistryName` via `register(...)` from `#veryfront/extensions/contracts.ts`, then runs ext-openai's `setup()` against a context whose `require()` returns that registry.

Add a sibling helper:

```ts
import extAnthropic from "../../extensions/ext-anthropic/src/index.ts";

async function registerExtAnthropicForTests(): Promise<void> {
  const registry = createAIProviderRegistry();
  registerContract(AIProviderRegistryName, registry);
  const ext = extAnthropic();
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

Mirror whatever shape `registerExtOpenAIForTests` uses — if it's synchronous, make this synchronous too; if the ctx construction differs, match it.

- [ ] **Step 6: Call `registerExtAnthropicForTests()` wherever the openai version is called**

Find call sites of `registerExtOpenAIForTests()` (typically at module load and inside `withTestContext`). Add `await registerExtAnthropicForTests()` (or sync call, matching the existing pattern) right after each one.

- [ ] **Step 7: Run the tests**

Run: `deno test --no-check --allow-all tests/`
Expected: same pre-existing failure baseline as recorded after PR 11 (compiled-binary + browser tests). No new failures. Any new failure in a path that resolves `anthropic/*` means the harness isn't priming the registry correctly — trace back to Step 5/6.

- [ ] **Step 8: Commit**

```bash
git add src/extensions/recommendations.ts tests/_helpers/context.ts
git commit -m "test(harness): materialize ext-anthropic + recommendations entry"
```

---

## Phase D — Validate

### Task 9: Full test suite + lint + draft PR

**Files:** none (validation only).

- [ ] **Step 1: Run `deno fmt`**

Run: `deno fmt`
Expected: possibly some files reformatted. Inspect the diff — if a formatting change touches a file you modified, stage and amend. Don't commit unrelated fmt changes.

```bash
# Only stage files you modified in this PR
git add extensions/ext-anthropic/ src/provider/runtime-loader.ts src/provider/runtime-loader.test.ts \
        src/provider/model-registry.ts src/provider/veryfront-cloud/provider.ts \
        src/extensions/integration.test.ts src/extensions/recommendations.ts \
        tests/_helpers/context.ts deno.json
git commit -m "chore: apply deno fmt to PR 12 files"
```

- [ ] **Step 2: Run `deno lint`**

Run: `deno lint`
Expected: clean. If PR-12-introduced code has `no-unused-vars` errors (common after moving code), fix them (prefix with `_` or delete) and commit:

```bash
git commit -m "chore: fix lint errors in PR 12 code"
```

Only fix errors in PR 12's own newly-added/modified code — leave pre-existing errors alone.

- [ ] **Step 3: Run the full test suite**

Check `deno.json` for the root test task. Typically:
```bash
deno task test
```

Or the finer-grained target:
```bash
deno test --no-check --allow-all src/ extensions/ cli/
```

Expected: the same baseline pass/fail counts as after PR 11 landed. PR 12's own additions (ext-anthropic tests, integration test, test harness changes) should all pass. The pre-existing compiled-binary / browser failures remain.

- [ ] **Step 4: Run the pre-push hook manually**

Run:
```bash
SKIP_E2E=1 bash scripts/hooks/pre-push
```

Expected: `All pre-push checks passed!`.

If the hook fails on formatting/lint/typecheck, loop back to the owning task — don't commit a hot-fix without tracing the root cause.

- [ ] **Step 5: Push the branch**

Run:
```bash
git push -u origin feat/ext-anthropic
```

Expected: the remote pre-push hook runs again (it's wired to the same script). If the push fails on a check that passed locally, re-run the local hook and investigate the difference.

- [ ] **Step 6: Open the draft PR**

```bash
gh pr create --draft --base feat/ext-openai \
  --title "feat(ext-anthropic): extract Anthropic provider behind AIProviderRegistry contract" \
  --body "$(cat <<'EOF'
## Summary

Implements PR 12 of the multi-LLM provider extensions plan — extracts Anthropic from core into `@veryfront/ext-anthropic`, registered under the `AIProvider:anthropic` contract. Google stays in core for now (PR 13).

## Scope

- **Phase A — Scaffold:** workspace manifest + AnthropicProvider wrapper + smoke tests
- **Phase B — Rewire consumers:** model-registry + veryfront-cloud route through the registry; clear throw when ext-anthropic is missing
- **Phase C — Move implementation:** `createAnthropicModelRuntime` + all Anthropic-specific helpers (~1500 lines) moved out of `runtime-loader.ts`; tests migrated from `runtime-loader.test.ts` into the extension
- **Phase D — Validate:** lint clean; pre-push hook green

## References

- Spec: `docs/superpowers/specs/2026-04-23-multi-llm-provider-extensions-design.md`
- Plan: `docs/superpowers/plans/2026-04-24-pr12-ext-anthropic.md`
- Pattern reference: PR 11 (ext-openai) — `docs/superpowers/plans/2026-04-23-pr11-ai-provider-registry-and-ext-openai.md`

## Test plan

- [ ] Review the 2 rewire points (`model-registry.ts` anthropic branch, `veryfront-cloud/provider.ts` anthropic case) handle missing ext-anthropic with clear errors
- [ ] Confirm `runtime-loader.ts` is still green for remaining Google tests
- [ ] Verify migrated ext-anthropic tests cover all prior Anthropic behavior
- [ ] Check that `AIProviderRegistry` still contains all three providers after `ExtensionLoader.setupAll` when both ext-openai and ext-anthropic load together

## Out of scope

- Google extraction (PR 13)
- Physical move of shared plumbing out of `runtime-loader.ts` (PR 14)
- Deleting `runtime-loader.ts` entirely (PR 14)
- Example / docs updates (PR 15)
EOF
)"
```

Expected: draft PR URL printed. Mark it draft, link it in the task tracker, stop.

---

## Rollback and compatibility

- **Between Task 1 and Task 7**, `runtime-loader.ts` still exports `createAnthropicModelRuntime`; `model-registry.ts` and `veryfront-cloud/provider.ts` go through the registry when primed but now throw (not fall back to the in-core factory) when the extension is missing. This means:
  - If PR 11 landed and ext-openai is loaded, OpenAI works.
  - If ext-anthropic is loaded, Anthropic works via the registry.
  - If ext-anthropic is **not** loaded (e.g. mid-bisect), any `anthropic/*` resolution throws a clear "not installed" error rather than silently succeeding via the in-core factory. This is a deliberate break — see spec §4.
- **After Task 7**, core contains no Anthropic code. The throw path is the only behavior when ext-anthropic is missing.
- **Google is untouched** through this PR. Its tests in `runtime-loader.test.ts` still run; its branches in `model-registry.ts` and `veryfront-cloud/provider.ts` still use the direct factory path. PR 13 extracts it.

## Out of scope for this PR

- Google extraction (PR 13)
- Deleting `src/provider/runtime-loader.ts` entirely (PR 14)
- Physically relocating shared plumbing out of `runtime-loader.ts` into `src/provider/shared/*.ts` files (PR 14)
- Docs and example-extension updates (PR 15)
