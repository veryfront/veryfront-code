# PR 11 — AIProviderRegistry + ext-openai Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the `AIProviderRegistry` contract, a default Map-backed impl primed at bootstrap, and extract the OpenAI provider into `extensions/ext-openai/`. Anthropic + Google factories stay in `runtime-loader.ts` for PRs 12/13.

**Architecture:** Core gains an `AIProvider` / `AIProviderRegistry` contract pair. A `Map`-backed registry is primed into the contract store by `orchestrateExtensions()` **after** `ExtensionLoader.teardownAll()` clears the registry but **before** the per-extension `setup()` loop. The registry is then handed to extensions via `ctx.resolve()`. `ext-openai` registers an `OpenAIProvider` wrapping the existing `createOpenAIModelRuntime` / `createOpenAIResponsesRuntime` / `createOpenAIEmbeddingRuntime` factories. Those factories move wholesale from `src/provider/runtime-loader.ts` into the extension together with their OpenAI-specific helpers; shared helpers (retry, error shaping, SSE, URL builders) are re-exported through a new `src/provider/shared/` barrel so `ext-openai` (and later `ext-anthropic`/`ext-google`) import from a stable public surface. `model-registry.ts::autoInitializeFromEnv()` rewires its `"openai"` branch to resolve the registry; Anthropic/Google branches are unchanged. `veryfront-cloud/provider.ts` rewires its `"openai"` / `"moonshotai"` switch cases.

**Tech Stack:** Deno workspaces, JSR `@std/assert` + `@std/testing/bdd`, npm/esm.sh for OpenAI HTTP plumbing. No new runtime deps in core.

**Reference PR:** #1225 (`ext-babel`) — mirror its workspace layout, `setup()` registration style, test structure, and `deno.json` import-map pattern.

**Spec:** `docs/superpowers/specs/2026-04-23-multi-llm-provider-extensions-design.md`.

---

## File structure

### Files created in core

| File | Responsibility |
|------|----------------|
| `src/extensions/interfaces/ai-provider.ts` | `AIProvider`, `AIProviderRegistry`, `AIProviderConfig`, `AIProviderRegistryName` types. |
| `src/extensions/registries/ai-provider-registry.ts` | `Map`-backed `AIProviderRegistry` default impl + `createAIProviderRegistry()` factory. |
| `src/extensions/registries/ai-provider-registry.test.ts` | Unit tests for register / unregister / require / duplicate guard / unknown-id error. |
| `src/provider/shared/index.ts` | Barrel re-exporting shared plumbing for extensions. |

### Files created for the extension

| File | Responsibility |
|------|----------------|
| `extensions/ext-openai/deno.json` | Workspace manifest with import map to core. |
| `extensions/ext-openai/src/index.ts` | `ExtensionFactory` — resolves registry, registers `OpenAIProvider`. |
| `extensions/ext-openai/src/openai-provider.ts` | `OpenAIProvider` class + factory functions moved from core. |
| `extensions/ext-openai/src/openai-provider.test.ts` | OpenAI HTTP tests migrated from `runtime-loader.test.ts`. |
| `extensions/ext-openai/src/index.test.ts` | Smoke test for factory + `setup()` registration. |

### Files modified

| File | Change |
|------|--------|
| `src/extensions/interfaces/index.ts` | Drop old `AIModelProvider` exports; export new `ai-provider.ts` types. |
| `src/extensions/interfaces/ai-model-provider.ts` | **Deleted.** |
| `src/extensions/recommendations.ts` | Rename `"AIModelProvider"` key → `"AIProvider:openai"`. |
| `src/extensions/loader.ts` | Add `primeContracts(map)` method; apply primed contracts inside `setupAll()` after `teardownAll()`. |
| `src/extensions/orchestrate.ts` | Accept `primeContracts` option; pass to loader. |
| `src/server/bootstrap.ts` (and any other `orchestrateExtensions()` callsite) | Build registry, pass as `primeContracts: { AIProviderRegistry: registry }`. |
| `src/provider/runtime-loader.ts` | Delete OpenAI-specific factories + helpers moved to `ext-openai`. Re-export surface kept until PR 14. |
| `src/provider/runtime-loader.test.ts` | Delete OpenAI test blocks migrated to `ext-openai`. |
| `src/provider/model-registry.ts` | `"openai"` autoinit branch now calls `registry.get("openai")?.createModel(...)`. |
| `src/provider/veryfront-cloud/provider.ts` | `"openai"` / `"moonshotai"` switch cases use registry. |
| `deno.json` (root) | Add `"./extensions/ext-openai"` to `workspace`. |

---

## Phase A — Land the contract + registry infrastructure

### Task 1: Create the `AIProvider` / `AIProviderRegistry` interface

**Files:**
- Create: `src/extensions/interfaces/ai-provider.ts`

- [ ] **Step 1: Write the interface file**

Create `src/extensions/interfaces/ai-provider.ts` with this exact content:

```ts
/**
 * Contract interface for LLM provider extensions.
 *
 * A single `AIProviderRegistry` impl lives in the contract registry under
 * {@link AIProviderRegistryName}. Each provider extension resolves the
 * registry in its `setup()` and calls `registry.register(provider)`.
 * Core consumers (model-registry, veryfront-cloud) resolve the registry
 * and dispatch on provider id parsed from `"provider/model"` strings.
 *
 * @module extensions/interfaces/ai-provider
 */

import type { EmbeddingRuntime, ModelRuntime } from "../../provider/types.ts";

/** Config passed to any provider's create* method. */
export interface AIProviderConfig {
  /** API credential — maps to OpenAI `apiKey`, Anthropic `authToken`, Google `apiKey` internally. */
  credential: string;
  /** Override the provider's base URL (e.g. Azure OpenAI, self-hosted gateway). */
  baseURL?: string;
  /** Override fetch (veryfront-cloud uses this to inject project auth headers). */
  fetch?: typeof fetch;
  /** Display name shown in errors + telemetry. Defaults to provider id. */
  name?: string;
  /** Provider-specific extras. */
  [key: string]: unknown;
}

/**
 * An LLM provider implementation. Extensions register one of these with the
 * {@link AIProviderRegistry} during setup(). `createModel` is required;
 * `createEmbedding` and `createResponses` are optional and absent on
 * providers that don't support them.
 */
export interface AIProvider {
  /** Stable id used in model strings: "openai" / "anthropic" / "google". */
  readonly id: string;
  createModel(modelId: string, config: AIProviderConfig): ModelRuntime;
  createEmbedding?(modelId: string, config: AIProviderConfig): EmbeddingRuntime;
  createResponses?(modelId: string, config: AIProviderConfig): ModelRuntime;
}

/** Registry contract. Single impl created at bootstrap. */
export interface AIProviderRegistry {
  register(provider: AIProvider): void;
  unregister(id: string): void;
  get(id: string): AIProvider | undefined;
  require(id: string): AIProvider;
  list(): AIProvider[];
  has(id: string): boolean;
}

/** Contract name used for `resolve()` / `provide()`. */
export const AIProviderRegistryName = "AIProviderRegistry" as const;
```

- [ ] **Step 2: Commit**

```bash
git add src/extensions/interfaces/ai-provider.ts
git commit -m "feat(extensions): add AIProvider + AIProviderRegistry contract types"
```

---

### Task 2: Create the Map-backed registry impl with tests

**Files:**
- Create: `src/extensions/registries/ai-provider-registry.ts`
- Create: `src/extensions/registries/ai-provider-registry.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/extensions/registries/ai-provider-registry.test.ts`:

```ts
import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertThrows } from "@std/assert";
import { createAIProviderRegistry } from "./ai-provider-registry.ts";
import type { AIProvider } from "../interfaces/ai-provider.ts";

function fakeProvider(id: string): AIProvider {
  return {
    id,
    createModel: () => {
      throw new Error("not used");
    },
  };
}

describe("AIProviderRegistry", () => {
  it("register + get returns the same instance", () => {
    const reg = createAIProviderRegistry();
    const p = fakeProvider("openai");
    reg.register(p);
    assertEquals(reg.get("openai"), p);
    assert(reg.has("openai"));
  });

  it("get returns undefined for unknown id", () => {
    const reg = createAIProviderRegistry();
    assertEquals(reg.get("nope"), undefined);
    assertEquals(reg.has("nope"), false);
  });

  it("require throws with a helpful message listing known providers", () => {
    const reg = createAIProviderRegistry();
    reg.register(fakeProvider("openai"));
    reg.register(fakeProvider("anthropic"));
    assertThrows(
      () => reg.require("google"),
      Error,
      "google",
    );
    assertThrows(
      () => reg.require("google"),
      Error,
      "openai, anthropic",
    );
  });

  it("register throws on duplicate id (no silent overwrite)", () => {
    const reg = createAIProviderRegistry();
    reg.register(fakeProvider("openai"));
    assertThrows(
      () => reg.register(fakeProvider("openai")),
      Error,
      'AIProvider "openai" is already registered',
    );
  });

  it("unregister allows re-registration", () => {
    const reg = createAIProviderRegistry();
    const p1 = fakeProvider("openai");
    const p2 = fakeProvider("openai");
    reg.register(p1);
    reg.unregister("openai");
    reg.register(p2);
    assertEquals(reg.get("openai"), p2);
  });

  it("list returns providers in insertion order", () => {
    const reg = createAIProviderRegistry();
    reg.register(fakeProvider("openai"));
    reg.register(fakeProvider("anthropic"));
    reg.register(fakeProvider("google"));
    assertEquals(reg.list().map((p) => p.id), ["openai", "anthropic", "google"]);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `deno test --no-check --allow-all src/extensions/registries/ai-provider-registry.test.ts`
Expected: module-not-found for `./ai-provider-registry.ts`.

- [ ] **Step 3: Implement the registry**

Create `src/extensions/registries/ai-provider-registry.ts`:

```ts
/**
 * Default Map-backed implementation of the AIProviderRegistry contract.
 *
 * Preserves insertion order via Map (used by `list()`). Throws on
 * duplicate id to surface silent collisions between extensions.
 *
 * @module extensions/registries/ai-provider-registry
 */

import type { AIProvider, AIProviderRegistry } from "../interfaces/ai-provider.ts";

class AIProviderRegistryImpl implements AIProviderRegistry {
  private readonly providers = new Map<string, AIProvider>();

  register(provider: AIProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(
        `AIProvider "${provider.id}" is already registered. ` +
          `Call unregister("${provider.id}") first if you intend to replace it.`,
      );
    }
    this.providers.set(provider.id, provider);
  }

  unregister(id: string): void {
    this.providers.delete(id);
  }

  get(id: string): AIProvider | undefined {
    return this.providers.get(id);
  }

  require(id: string): AIProvider {
    const p = this.providers.get(id);
    if (p) return p;
    const known = [...this.providers.keys()].join(", ") || "(none)";
    throw new Error(
      `No AIProvider registered for "${id}". Known providers: ${known}.`,
    );
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  list(): AIProvider[] {
    return [...this.providers.values()];
  }
}

export function createAIProviderRegistry(): AIProviderRegistry {
  return new AIProviderRegistryImpl();
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `deno test --no-check --allow-all src/extensions/registries/ai-provider-registry.test.ts`
Expected: `6 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/extensions/registries/ai-provider-registry.ts \
         src/extensions/registries/ai-provider-registry.test.ts
git commit -m "feat(extensions): Map-backed AIProviderRegistry default impl"
```

---

### Task 3: Wire the new types into the interfaces barrel; delete the old `AIModelProvider`

**Files:**
- Modify: `src/extensions/interfaces/index.ts`
- Delete: `src/extensions/interfaces/ai-model-provider.ts`
- Modify: `src/extensions/recommendations.ts`

- [ ] **Step 1: Update the barrel export**

In `src/extensions/interfaces/index.ts`, find the block:

```ts
// AI model provider
export type {
  AIModelProvider,
  ChatMessage,
  CompletionOptions,
  CompletionResult,
  ContentPart,
  StreamChunk,
  ToolDefinition,
} from "./ai-model-provider.ts";
```

Replace it with:

```ts
// AI provider (registry + per-provider contract)
export type {
  AIProvider,
  AIProviderConfig,
  AIProviderRegistry,
} from "./ai-provider.ts";
export { AIProviderRegistryName } from "./ai-provider.ts";
```

- [ ] **Step 2: Delete the stale interface file**

```bash
git rm src/extensions/interfaces/ai-model-provider.ts
```

- [ ] **Step 3: Update the recommendations map**

In `src/extensions/recommendations.ts`, find the line:

```ts
  ["AIModelProvider", "@veryfront/ext-openai"],
```

Replace with three entries:

```ts
  ["AIProviderRegistry", "@veryfront/ext-openai"],
  ["AIProvider:openai", "@veryfront/ext-openai"],
  ["AIProvider:anthropic", "@veryfront/ext-anthropic"],
  ["AIProvider:google", "@veryfront/ext-google"],
```

- [ ] **Step 4: Confirm nothing else references the old name**

Run: `grep -rn "AIModelProvider\|ai-model-provider" src/ extensions/ 2>/dev/null`
Expected: no output.

- [ ] **Step 5: Confirm the codebase still type-checks**

Run: `deno check src/extensions/interfaces/index.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A src/extensions/interfaces/ src/extensions/recommendations.ts
git commit -m "refactor(extensions): replace unused AIModelProvider with AIProvider contract"
```

---

### Task 4: Add `primeContracts` plumbing to `ExtensionLoader`

**Why this task exists.** `setupAll()` calls `teardownAll()` first (`src/extensions/loader.ts:155`), which calls `reset()` at line 243 — wiping the whole contract registry. If bootstrap registers `AIProviderRegistry` *before* calling `setupAll()`, it gets cleared before extensions ever run. PR #1225 (ext-babel) hit the same bug. Solution: teach the loader to re-apply a caller-supplied map of contracts immediately after the `teardownAll()` call.

**Files:**
- Modify: `src/extensions/loader.ts`
- Modify: `src/extensions/loader.test.ts` (add new test)

- [ ] **Step 1: Write the failing test**

In `src/extensions/loader.test.ts`, append (use the same `describe` block style already in the file — copy an existing `it()`'s imports if any are missing):

```ts
import { resolve as resolveContract } from "./contracts.ts";

describe("ExtensionLoader primeContracts", () => {
  it("applies primed contracts after teardownAll so extensions can resolve them", async () => {
    const loader = new ExtensionLoader(silentLogger);
    const marker = { hello: "world" };
    loader.primeContracts({ Primed: marker });

    let observed: unknown = "unobserved";
    const resolved: ResolvedExtension = {
      source: "local-file",
      path: "virtual://t",
      extension: {
        name: "t-ext",
        version: "0.0.1",
        setup(ctx) {
          observed = ctx.require("Primed");
        },
      },
    };
    await loader.setupAll([resolved], {});
    assertEquals(observed, marker);
    assertEquals(resolveContract("Primed"), marker);
  });
});
```

(If `silentLogger` / `ResolvedExtension` aren't already imported in the test file, copy their imports from the top of the file.)

- [ ] **Step 2: Run the test and watch it fail**

Run: `deno test --no-check --allow-all src/extensions/loader.test.ts -- --filter "primeContracts"`
Expected: compile error ("Property 'primeContracts' does not exist").

- [ ] **Step 3: Implement `primeContracts`**

In `src/extensions/loader.ts`, add a private field + public method to the `ExtensionLoader` class. Find the field declaration block near the top of the class (below `setupOrder: ResolvedExtension[] = [];`) and add:

```ts
  private primed: Record<string, unknown> = {};

  /**
   * Register contracts that will be re-applied after each `setupAll()`
   * teardown pass. Used by `orchestrateExtensions()` to seed infrastructure
   * (e.g. `AIProviderRegistry`) before per-extension `setup()` runs.
   */
  primeContracts(contracts: Record<string, unknown>): void {
    this.primed = { ...this.primed, ...contracts };
  }
```

Then inside `setupAll()`, find the line:

```ts
    await this.teardownAll();
```

Immediately after it, insert:

```ts
    for (const [name, impl] of Object.entries(this.primed)) {
      register(name, impl);
    }
```

(`register` is already imported at the top of the file; verify with a quick grep.)

- [ ] **Step 4: Run the test and watch it pass**

Run: `deno test --no-check --allow-all src/extensions/loader.test.ts -- --filter "primeContracts"`
Expected: PASS.

- [ ] **Step 5: Run the full loader test file to catch regressions**

Run: `deno test --no-check --allow-all src/extensions/loader.test.ts`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/extensions/loader.ts src/extensions/loader.test.ts
git commit -m "feat(extensions): ExtensionLoader.primeContracts for bootstrap-seeded contracts"
```

---

### Task 5: Surface `primeContracts` through `orchestrateExtensions`

**Files:**
- Modify: `src/extensions/orchestrate.ts`
- Modify: `src/extensions/orchestrate.test.ts` (add a test)

- [ ] **Step 1: Write the failing test**

Append to `src/extensions/orchestrate.test.ts` (copy existing imports as needed):

```ts
import { resolve as resolveContract } from "./contracts.ts";

it("orchestrateExtensions passes primeContracts through to the loader", async () => {
  const marker = { seeded: true };
  const loader = await orchestrateExtensions({
    logger: silentLogger,
    extensions: [],
    primeContracts: { Seeded: marker },
  });
  assertEquals(resolveContract("Seeded"), marker);
  await loader.teardownAll();
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `deno test --no-check --allow-all src/extensions/orchestrate.test.ts -- --filter "primeContracts"`
Expected: compile error ("Object literal may only specify known properties").

- [ ] **Step 3: Thread the option through**

In `src/extensions/orchestrate.ts`, find the `OrchestrateExtensionsOptions` interface (near the top around line 24). Add:

```ts
  /** Contracts to seed into the registry after teardown, before setup(). */
  primeContracts?: Record<string, unknown>;
```

Then in the function body near line 169, change:

```ts
  const loader = new ExtensionLoader(logger);
  await loader.setupAll(merged, config as Record<string, unknown>);
```

to:

```ts
  const loader = new ExtensionLoader(logger);
  if (options.primeContracts) {
    loader.primeContracts(options.primeContracts);
  }
  await loader.setupAll(merged, config as Record<string, unknown>);
```

(If the options parameter is destructured differently, reference it via the destructured name — read lines 94-130 of the file to confirm.)

- [ ] **Step 4: Run the test and watch it pass**

Run: `deno test --no-check --allow-all src/extensions/orchestrate.test.ts -- --filter "primeContracts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extensions/orchestrate.ts src/extensions/orchestrate.test.ts
git commit -m "feat(extensions): orchestrateExtensions accepts primeContracts option"
```

---

### Task 6: Prime `AIProviderRegistry` from bootstrap

**Files:**
- Modify: `src/server/bootstrap.ts` (and any other `orchestrateExtensions(` caller)

- [ ] **Step 1: Locate all callsites**

Run: `grep -rn "orchestrateExtensions(" src/ --include='*.ts'`
Expected: one or more callsites — typically `src/server/bootstrap.ts`. Note each one.

- [ ] **Step 2: Patch each callsite**

For every file that calls `orchestrateExtensions(...)`:

1. Add these imports at the top:
   ```ts
   import { AIProviderRegistryName } from "#veryfront/extensions/interfaces/index.ts";
   import { createAIProviderRegistry } from "#veryfront/extensions/registries/ai-provider-registry.ts";
   ```
   (Use the file's existing import-map aliases — `#veryfront/...` vs relative — for consistency.)

2. Build the registry once and pass it to `orchestrateExtensions`:
   ```ts
   const aiProviderRegistry = createAIProviderRegistry();
   const loader = await orchestrateExtensions({
     // ...existing options...
     primeContracts: {
       [AIProviderRegistryName]: aiProviderRegistry,
     },
   });
   ```

- [ ] **Step 3: Type-check**

Run: `deno check src/server/bootstrap.ts`
Expected: no errors.

- [ ] **Step 4: Run bootstrap tests**

Run: `deno test --no-check --allow-all src/server/bootstrap.test.ts`
Expected: all tests pass. If a test constructs the bootstrap path without extensions enabled, it should still pass because the registry is primed regardless.

- [ ] **Step 5: Commit**

```bash
git add src/server/bootstrap.ts  # plus any other patched files
git commit -m "feat(server): prime AIProviderRegistry contract at bootstrap"
```

---

## Phase B — Shared plumbing barrel

### Task 7: Create `src/provider/shared/` re-export barrel

**Why this task exists.** `ext-openai` must import retry/error/SSE/URL helpers that currently live inside `src/provider/runtime-loader.ts`. Rather than physically move them now (which would double this PR's scope), we expose a stable public surface under `src/provider/shared/` that re-exports them. When PRs 12/13/14 finish extracting the other providers, the implementations can be moved into `shared/` and the re-exports rewired without touching extension code.

**Files:**
- Create: `src/provider/shared/index.ts`
- Modify: `src/provider/runtime-loader.ts` (add `export` keyword to helpers needed externally)

- [ ] **Step 1: Identify what needs to be exported**

The OpenAI factory functions (which are moving) depend on these helpers inside `runtime-loader.ts`. Read each to confirm:

- `buildProviderError` (~line 569) — error shaping
- `requestJson` (~line 667) — JSON POST + retry
- `requestStream` (~line 684) — streaming POST + retry
- `parseRetryAfterMs` (~line 548) — used by retry logic; only if `requestJson/Stream` don't fully encapsulate
- `createWarningCollector` (~line 494) — runtime warning aggregation
- `readRecord` (~line 404), `isNumberArray` (~line 400), `extractOpenAIEmbeddings` (~line 412), `extractOpenAIUsageTokens` (~line 433) — only move those that are *not* OpenAI-specific. `extractOpenAIEmbeddings` / `extractOpenAIUsageTokens` are OpenAI-specific; they **move with the provider**, not to shared/.
- `toOpenAICompatibleMessages` (~line 728), `toOpenAICompatibleTools` (~line 788) — **shared** (also used by Google + Anthropic adapters in the current runtime-loader).
- `readProviderOptions` (~line 811), `readTextParts` (~line 718), `stringifyJsonValue` (~line 710), `mergeUsage` (~line 883) — shared utilities.
- `TOOL_INPUT_PENDING_THRESHOLD_MS`, `withToolInputStatusTransitions` from `./runtime-loader/tool-input-status.ts` — already exported; just pass through.
- `getOpenAIChatCompletionsUrl`, `getOpenAIResponsesUrl`, `getOpenAIEmbeddingUrl`, `getAnthropicMessagesUrl`, `getGoogleGenerateContentUrl`, `getGoogleStreamGenerateContentUrl`, `getGoogleEmbeddingUrl` from `./runtime-loader/provider-endpoints.ts` — pass through.
- `createOpenAIRequestInit`, `createAnthropicRequestInit`, `createGoogleRequestInit` from `./runtime-loader/provider-request-init.ts` — pass through.
- `RuntimePromptMessage` type and related types — shared.

For each helper in `runtime-loader.ts` that is currently `function name(...)` without `export` and is needed externally, add the `export` keyword. Do **not** add export to anything OpenAI-specific (those move in Task 14).

- [ ] **Step 2: Add `export` to the shared helpers in `runtime-loader.ts`**

Edit `src/provider/runtime-loader.ts`. For each of the following, change `function X` to `export function X` (and `async function X` to `export async function X`):

- `buildProviderError`
- `requestJson`
- `requestStream`
- `parseRetryAfterMs`
- `createWarningCollector`
- `readRecord`
- `isNumberArray`
- `toOpenAICompatibleMessages`
- `toOpenAICompatibleTools`
- `readProviderOptions`
- `readTextParts`
- `stringifyJsonValue`
- `mergeUsage`

Also export the `RuntimePromptMessage` type: find the `type RuntimePromptMessage = ...` declaration (~line 45) and change `type` to `export type`.

Export any other types that the OpenAI factories reference that aren't already exported (compile errors in Task 14 will flag these — this first pass is a best-effort).

- [ ] **Step 3: Create the barrel file**

Create `src/provider/shared/index.ts`:

```ts
/**
 * Shared plumbing consumed by the `@veryfront/ext-*` provider extensions.
 *
 * This barrel is the stable public surface: implementations currently live
 * in `runtime-loader.ts` and `runtime-loader/` subdirectory. Future PRs
 * (post ext-anthropic / ext-google extraction) may move the implementations
 * into this directory; extensions keep importing from here unchanged.
 *
 * @module provider/shared
 */

// URL builders
export {
  getAnthropicMessagesUrl,
  getGoogleEmbeddingUrl,
  getGoogleGenerateContentUrl,
  getGoogleStreamGenerateContentUrl,
  getOpenAIChatCompletionsUrl,
  getOpenAIEmbeddingUrl,
  getOpenAIResponsesUrl,
} from "../runtime-loader/provider-endpoints.ts";

// Request init builders
export {
  createAnthropicRequestInit,
  createGoogleRequestInit,
  createOpenAIRequestInit,
} from "../runtime-loader/provider-request-init.ts";

// Tool-input status transitions
export {
  TOOL_INPUT_PENDING_THRESHOLD_MS,
  withToolInputStatusTransitions,
} from "../runtime-loader/tool-input-status.ts";

// Retry / error / HTTP plumbing (currently in runtime-loader.ts).
export {
  buildProviderError,
  createWarningCollector,
  isNumberArray,
  mergeUsage,
  parseRetryAfterMs,
  readProviderOptions,
  readRecord,
  readTextParts,
  requestJson,
  requestStream,
  stringifyJsonValue,
  toOpenAICompatibleMessages,
  toOpenAICompatibleTools,
} from "../runtime-loader.ts";

export type { RuntimePromptMessage } from "../runtime-loader.ts";
```

- [ ] **Step 4: Type-check**

Run: `deno check src/provider/shared/index.ts`
Expected: no errors. Any "not exported" complaint means the corresponding `export` keyword was missed in Step 2 — fix and rerun.

- [ ] **Step 5: Commit**

```bash
git add src/provider/runtime-loader.ts src/provider/shared/index.ts
git commit -m "refactor(provider): expose shared plumbing through src/provider/shared barrel"
```

---

## Phase C — Scaffold `ext-openai` workspace

### Task 8: Create the `ext-openai` workspace manifest

**Files:**
- Create: `extensions/ext-openai/deno.json`
- Modify: `deno.json` (root)

- [ ] **Step 1: Create the extension's `deno.json`**

Write `extensions/ext-openai/deno.json`:

```json
{
  "name": "@veryfront/ext-openai",
  "version": "0.1.0",
  "exports": "./src/index.ts",
  "veryfront": {
    "extension": true,
    "capabilities": [
      { "type": "contract", "name": "AIProvider:openai" }
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

- [ ] **Step 2: Add the workspace member to the root `deno.json`**

In the root `deno.json`, find:

```json
  "workspace": [
    "./extensions/ext-redis"
  ],
```

Add `./extensions/ext-openai` (sorted order is fine):

```json
  "workspace": [
    "./extensions/ext-openai",
    "./extensions/ext-redis"
  ],
```

- [ ] **Step 3: Type-check the workspace**

Run: `deno check --config deno.json extensions/ext-openai/deno.json` (or simply `deno task check` if one exists)
Expected: no errors. The `extensions/ext-openai/src/` directory doesn't exist yet so nothing is type-checked against the manifest itself — this step just validates JSON.

- [ ] **Step 4: Commit**

```bash
git add extensions/ext-openai/deno.json deno.json
git commit -m "feat(ext-openai): scaffold workspace manifest"
```

---

### Task 9: Write the `OpenAIProvider` wrapper with a smoke test

**Why this task exists.** Before moving the 600+ lines of OpenAI factory code, prove the provider class integrates with the registry end-to-end. Task 14 will replace the placeholder factory calls with the real ones.

**Files:**
- Create: `extensions/ext-openai/src/openai-provider.ts`
- Create: `extensions/ext-openai/src/index.ts`
- Create: `extensions/ext-openai/src/index.test.ts`

- [ ] **Step 1: Write a temporary `OpenAIProvider` backed by core's current exports**

Create `extensions/ext-openai/src/openai-provider.ts`:

```ts
/**
 * OpenAI provider — implements the {@link AIProvider} contract.
 *
 * Delegates to the legacy `createOpenAI*Runtime` factories still living in
 * core's `runtime-loader.ts`. Task 14 moves those factories into this file.
 */

import type {
  AIProvider,
  AIProviderConfig,
} from "veryfront/extensions/interfaces";
import type { EmbeddingRuntime, ModelRuntime } from "veryfront/provider/types";
import {
  createOpenAIEmbeddingRuntime,
  createOpenAIModelRuntime,
  createOpenAIResponsesRuntime,
} from "../../../src/provider/runtime-loader.ts";

export class OpenAIProvider implements AIProvider {
  readonly id = "openai";

  createModel(modelId: string, config: AIProviderConfig): ModelRuntime {
    return createOpenAIModelRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: config.name ?? "openai",
        fetch: config.fetch,
      },
      modelId,
    );
  }

  createEmbedding(modelId: string, config: AIProviderConfig): EmbeddingRuntime {
    return createOpenAIEmbeddingRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: config.name ?? "openai",
        fetch: config.fetch,
      },
      modelId,
    );
  }

  createResponses(modelId: string, config: AIProviderConfig): ModelRuntime {
    return createOpenAIResponsesRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: config.name ?? "openai",
        fetch: config.fetch,
      },
      modelId,
    );
  }
}
```

- [ ] **Step 2: Write the `ExtensionFactory` entry point**

Create `extensions/ext-openai/src/index.ts`:

```ts
/**
 * @veryfront/ext-openai — registers the OpenAI provider into the
 * core `AIProviderRegistry`.
 *
 * @module extensions/ext-openai
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type { AIProviderRegistry } from "veryfront/extensions/interfaces";
import { AIProviderRegistryName } from "veryfront/extensions/interfaces";
import { OpenAIProvider } from "./openai-provider.ts";

const extOpenAI: ExtensionFactory = () => {
  const provider = new OpenAIProvider();
  return {
    name: "ext-openai",
    version: "0.1.0",
    capabilities: [{ type: "contract", name: "AIProvider:openai" }],
    setup(ctx) {
      const registry = ctx.require<AIProviderRegistry>(AIProviderRegistryName);
      registry.register(provider);
      ctx.logger.info("[ext-openai] OpenAI provider registered");
    },
    teardown() {
      // No resources to release.
    },
  };
};

export default extOpenAI;
export { OpenAIProvider };
```

- [ ] **Step 3: Write the smoke test**

Create `extensions/ext-openai/src/index.test.ts`:

```ts
import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import extOpenAI, { OpenAIProvider } from "./index.ts";
import type { AIProviderRegistry } from "veryfront/extensions/interfaces";

describe("ext-openai", () => {
  it("factory descriptor advertises the AIProvider:openai capability", () => {
    const ext = extOpenAI();
    assertEquals(ext.name, "ext-openai");
    assertEquals(ext.capabilities?.[0], {
      type: "contract",
      name: "AIProvider:openai",
    });
  });

  it("setup registers the provider in the AIProviderRegistry", () => {
    const ext = extOpenAI();
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
    assert(registered.openai instanceof OpenAIProvider);
  });
});
```

- [ ] **Step 4: Run the smoke test**

Run: `deno task --config extensions/ext-openai/deno.json test`
Or from the worktree root: `deno test --no-check --allow-all extensions/ext-openai/src/index.test.ts`
Expected: `2 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add extensions/ext-openai/src/
git commit -m "feat(ext-openai): OpenAIProvider wrapper + factory + smoke tests"
```

---

## Phase D — Rewire consumers to the registry

### Task 10: Rewire `model-registry.ts::autoInitializeFromEnv()` for OpenAI only

**Files:**
- Modify: `src/provider/model-registry.ts`

- [ ] **Step 1: Add the registry resolution at the top of the function**

In `src/provider/model-registry.ts`, find `function autoInitializeFromEnv(): void { ... }` (around line 75). Add these imports at the top of the file next to the other imports:

```ts
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { AIProviderRegistry } from "#veryfront/extensions/interfaces/index.ts";
import { AIProviderRegistryName } from "#veryfront/extensions/interfaces/index.ts";
```

- [ ] **Step 2: Rewrite the `"openai"` branch**

In `autoInitializeFromEnv()`, find the `if (!manager.has("openai")) { ... }` block (lines 83–100). Replace its body so the factory goes through the registry when one is primed:

```ts
  if (!manager.has("openai")) {
    manager.registerShared("openai", (id) => {
      const config = getOpenAIEnvConfig();
      if (!config.apiKey) {
        throw toError(
          createError({
            type: "config",
            message:
              "OPENAI_API_KEY not set. Set the environment variable or register a custom provider with registerModelProvider().",
          }),
        );
      }
      const registry = tryResolve<AIProviderRegistry>(AIProviderRegistryName);
      const provider = registry?.get("openai");
      if (provider) {
        return provider.createModel(id, {
          credential: config.apiKey,
          baseURL: config.baseURL,
        });
      }
      // Fallback: legacy direct-factory path. Still reachable during the
      // PR 11 → 14 migration window when ext-openai isn't installed.
      return createOpenAIModelRuntime(
        { apiKey: config.apiKey, baseURL: config.baseURL },
        id,
      );
    });
  }
```

Leave the `"anthropic"`, `"google"`, `"local"`, and `"veryfront-cloud"` branches untouched — PRs 12 and 13 handle Anthropic and Google.

- [ ] **Step 3: Run the model-registry tests**

Run: `deno test --no-check --allow-all src/provider/` (or the specific model-registry test file if one exists)
Expected: existing tests still pass. If any test asserted the factory path was called directly for OpenAI, update the assertion or seed the registry with a provider stub.

- [ ] **Step 4: Commit**

```bash
git add src/provider/model-registry.ts
git commit -m "refactor(provider): openai autoinit delegates to AIProviderRegistry when primed"
```

---

### Task 11: Rewire `veryfront-cloud/provider.ts` OpenAI case

**Files:**
- Modify: `src/provider/veryfront-cloud/provider.ts`

- [ ] **Step 1: Rewrite the switch**

Read the full file (`src/provider/veryfront-cloud/provider.ts`) — it's ~60 lines. Replace:

```ts
    case "openai":
    case "moonshotai":
      return createOpenAIModelRuntime({
        apiKey: apiToken,
        baseURL,
        name: "veryfront-cloud",
        fetch,
      }, upstreamModelId);
```

with:

```ts
    case "openai":
    case "moonshotai": {
      const registry = tryResolve<AIProviderRegistry>(AIProviderRegistryName);
      const openai = registry?.get("openai");
      if (openai) {
        return openai.createModel(upstreamModelId, {
          credential: apiToken,
          baseURL,
          name: "veryfront-cloud",
          fetch,
        });
      }
      // Fallback while ext-openai isn't installed.
      return createOpenAIModelRuntime({
        apiKey: apiToken,
        baseURL,
        name: "veryfront-cloud",
        fetch,
      }, upstreamModelId);
    }
```

Add the imports at the top of the file (next to the existing imports):

```ts
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { AIProviderRegistry } from "#veryfront/extensions/interfaces/index.ts";
import { AIProviderRegistryName } from "#veryfront/extensions/interfaces/index.ts";
```

- [ ] **Step 2: Type-check**

Run: `deno check src/provider/veryfront-cloud/provider.ts`
Expected: no errors.

- [ ] **Step 3: Run veryfront-cloud tests**

Run: `deno test --no-check --allow-all src/provider/veryfront-cloud/`
Expected: all tests pass (or module has no test file — in which case, skip).

- [ ] **Step 4: Commit**

```bash
git add src/provider/veryfront-cloud/provider.ts
git commit -m "refactor(provider): veryfront-cloud openai case uses AIProviderRegistry when primed"
```

---

### Task 12: End-to-end integration check

**Purpose:** confirm that from bootstrap → extension load → `resolveModel("openai/gpt-4o")` the registry path is actually exercised. If an existing integration test covers this, extend it; otherwise add a minimal one.

**Files:**
- Create or Modify: `src/extensions/integration.test.ts`

- [ ] **Step 1: Check whether an existing integration test loads ext-openai**

Run: `grep -rn "ext-openai" src/ 2>/dev/null`
If no test references ext-openai yet, proceed to add one. If one exists, skip to Step 4.

- [ ] **Step 2: Add an integration test case**

In `src/extensions/integration.test.ts` (pattern-match against the existing integration tests in this file — copy a working setup and adapt), append:

```ts
import { AIProviderRegistryName } from "./interfaces/index.ts";
import type { AIProviderRegistry } from "./interfaces/index.ts";
import { createAIProviderRegistry } from "./registries/ai-provider-registry.ts";
import extOpenAI from "../../extensions/ext-openai/src/index.ts";
import { resolve as resolveContract } from "./contracts.ts";

it("ext-openai registers into the primed AIProviderRegistry", async () => {
  const registry = createAIProviderRegistry();
  const loader = new ExtensionLoader(silentLogger);
  loader.primeContracts({ [AIProviderRegistryName]: registry });
  await loader.setupAll([
    {
      source: "local-file",
      path: "virtual://ext-openai",
      extension: extOpenAI(),
    },
  ], {});
  const resolved = resolveContract<AIProviderRegistry>(AIProviderRegistryName);
  assertEquals(resolved, registry);
  assert(registry.has("openai"));
  await loader.teardownAll();
});
```

- [ ] **Step 3: Run the integration test**

Run: `deno test --no-check --allow-all src/extensions/integration.test.ts -- --filter "ext-openai"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/extensions/integration.test.ts
git commit -m "test(extensions): integration test for ext-openai registry registration"
```

---

## Phase E — Move the OpenAI factories into the extension

### Task 13: Migrate OpenAI tests from `runtime-loader.test.ts`

**Purpose:** before moving the factory implementation, set up its tests in the extension so we have confidence-preserving coverage. Tests call the factories through the still-in-core imports; Task 14 flips that.

**Files:**
- Create: `extensions/ext-openai/src/openai-provider.test.ts`
- Modify: `src/provider/runtime-loader.test.ts` (delete migrated blocks)

- [ ] **Step 1: Inventory the OpenAI test blocks in `runtime-loader.test.ts`**

Read `src/provider/runtime-loader.test.ts`. Identify `describe(...)` / `it(...)` blocks that exclusively exercise `createOpenAIModelRuntime`, `createOpenAIResponsesRuntime`, or `createOpenAIEmbeddingRuntime`. Note line ranges for each.

(The reference blocks are the ones matching `createOpenAIModelRuntime(` at lines 191, 309, 399, 449, 515, 582 plus surrounding setup — extend via nearest `describe()` boundary.)

- [ ] **Step 2: Copy those blocks into the extension test file**

Create `extensions/ext-openai/src/openai-provider.test.ts`. Start with the existing test's imports, but change:

```ts
import {
  createOpenAIModelRuntime,
  createOpenAIResponsesRuntime,
} from "./runtime-loader.ts";
```

to the extension-relative import:

```ts
import {
  createOpenAIEmbeddingRuntime,
  createOpenAIModelRuntime,
  createOpenAIResponsesRuntime,
} from "./openai-provider.ts";
```

(These exports will exist after Task 14; for now the file references a not-yet-defined symbol — that's fine, we run tests only after Task 14 completes.)

Copy all the identified OpenAI `describe`/`it` blocks verbatim. If they rely on helper functions (mock fetch builders, fixture data) at the top of `runtime-loader.test.ts`, copy those helpers too, or factor them into a shared test helper file under `extensions/ext-openai/src/__test__/fixtures.ts`.

- [ ] **Step 3: Delete the migrated blocks from `runtime-loader.test.ts`**

Remove the same `describe`/`it` blocks from `src/provider/runtime-loader.test.ts`. Anthropic and Google blocks stay.

- [ ] **Step 4: Don't run tests yet** — they reference symbols that move in Task 14. Commit anyway to make the migration reviewable.

```bash
git add extensions/ext-openai/src/openai-provider.test.ts \
         src/provider/runtime-loader.test.ts
git commit -m "test(ext-openai): migrate OpenAI runtime tests from core runtime-loader"
```

---

### Task 14: Move OpenAI factories + their private helpers from `runtime-loader.ts` to `ext-openai`

**This is the largest task.** Expect 600–800 lines of code motion. Follow the dependency closure:

1. Move the three `export function create*` declarations.
2. Move every private helper they call that is *only* used by OpenAI code (not by Anthropic or Google).
3. Leave shared helpers (already `export`-ed in Task 7 Step 2) in `runtime-loader.ts`; import them into the extension from `veryfront/provider/shared`.

**Files:**
- Modify: `extensions/ext-openai/src/openai-provider.ts` (accept the moved code)
- Modify: `src/provider/runtime-loader.ts` (delete what moved)

- [ ] **Step 1: Identify OpenAI-specific helpers**

Read `src/provider/runtime-loader.ts` and mark each function/const as either **OpenAI-specific** or **shared**. OpenAI-specific includes (reference: grep output at write-time):

- Embedding helpers: `extractOpenAIEmbeddings`, `extractOpenAIUsageTokens`
- Result shaping: `normalizeOpenAIFinishReason`, `extractOpenAIUsage`, `extractOpenAIContentText`, `extractOpenAIToolCalls`, `isOpenAIReasoningModel`, `isNativeOpenAIModel`, `isFixedSamplingModel`, `resolveOpenAIReasoningEffort`, `buildOpenAIChatRequest`
- Chat streaming: `extractFirstChoice`, `buildOpenAIGenerateResult`, `streamOpenAICompatibleParts`
- Factory: `createOpenAIModelRuntime`
- Responses API: all of `toOpenAIResponsesInput`, `toOpenAIResponsesTools`, `buildOpenAIResponsesRequest`, `extractOpenAIResponsesUsage`, `normalizeOpenAIResponsesFinishReason`, `buildOpenAIResponsesGenerateResult`, `streamOpenAIResponsesParts`, `createOpenAIResponsesRuntime`
- Embedding factory: `createOpenAIEmbeddingRuntime`
- OpenAI config: `OpenAIRuntimeConfig` type
- Any OpenAI-only type alias (e.g. `OpenAICompatibleChatMessage`, `OpenAICompatibleChoice` — verify by grepping usage)

- [ ] **Step 2: Expand `openai-provider.ts` with the moved code**

Replace `extensions/ext-openai/src/openai-provider.ts` with the following skeleton, then paste the moved functions in order (imports → types → helpers → factories → class):

```ts
/**
 * OpenAI provider — implements the {@link AIProvider} contract for OpenAI,
 * OpenAI-compatible endpoints (Azure OpenAI, Moonshot AI), and OpenAI's
 * Responses API.
 *
 * Ported from `src/provider/runtime-loader.ts` as part of PR 11.
 *
 * @module extensions/ext-openai/openai-provider
 */

import type {
  AIProvider,
  AIProviderConfig,
} from "veryfront/extensions/interfaces";
import type {
  EmbeddingRuntime,
  ModelRuntime,
} from "veryfront/provider/types";
import {
  buildProviderError,
  createOpenAIRequestInit,
  createWarningCollector,
  getOpenAIChatCompletionsUrl,
  getOpenAIEmbeddingUrl,
  getOpenAIResponsesUrl,
  isNumberArray,
  mergeUsage,
  parseRetryAfterMs,
  readProviderOptions,
  readRecord,
  readTextParts,
  requestJson,
  requestStream,
  stringifyJsonValue,
  toOpenAICompatibleMessages,
  toOpenAICompatibleTools,
  TOOL_INPUT_PENDING_THRESHOLD_MS,
  withToolInputStatusTransitions,
} from "veryfront/provider/shared";
import type { RuntimePromptMessage } from "veryfront/provider/shared";

// --- OpenAI runtime config ---

export interface OpenAIRuntimeConfig {
  apiKey: string;
  baseURL?: string;
  name?: string;
  fetch?: typeof globalThis.fetch;
}

// --- Paste all OpenAI-specific private helpers, types, and factories here ---
//     See Task 14 Step 1 for the list. Move verbatim from runtime-loader.ts.

// export function createOpenAIModelRuntime(...) { ... }
// export function createOpenAIResponsesRuntime(...) { ... }
// export function createOpenAIEmbeddingRuntime(...) { ... }

// --- Provider class at the bottom ---

export class OpenAIProvider implements AIProvider {
  readonly id = "openai";

  createModel(modelId: string, config: AIProviderConfig): ModelRuntime {
    return createOpenAIModelRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: config.name ?? "openai",
        fetch: config.fetch,
      },
      modelId,
    );
  }

  createEmbedding(modelId: string, config: AIProviderConfig): EmbeddingRuntime {
    return createOpenAIEmbeddingRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: config.name ?? "openai",
        fetch: config.fetch,
      },
      modelId,
    );
  }

  createResponses(modelId: string, config: AIProviderConfig): ModelRuntime {
    return createOpenAIResponsesRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: config.name ?? "openai",
        fetch: config.fetch,
      },
      modelId,
    );
  }
}
```

- [ ] **Step 3: Delete the moved code from `runtime-loader.ts`**

For each function listed in Step 1 as OpenAI-specific, delete its declaration from `src/provider/runtime-loader.ts`. Also delete the `OpenAIRuntimeConfig` interface (line ~23).

Keep the `export { TOOL_INPUT_PENDING_THRESHOLD_MS, withToolInputStatusTransitions };` line (Anthropic + Google still need these via the runtime-loader surface).

- [ ] **Step 4: Type-check the extension**

Run: `deno check extensions/ext-openai/src/openai-provider.ts`
Expected: errors of the form "cannot find symbol X" — for each, trace X back to `runtime-loader.ts`:
- If X is another OpenAI-only helper, move it too.
- If X is shared and not yet in `shared/index.ts`, add an `export` in `runtime-loader.ts` and a re-export line in `shared/index.ts`.
Iterate until clean.

- [ ] **Step 5: Type-check core**

Run: `deno check src/provider/runtime-loader.ts src/provider/model-registry.ts src/provider/veryfront-cloud/provider.ts`
Expected: model-registry and veryfront-cloud still import `createOpenAIModelRuntime` for the fallback path — update their imports to `from "../../extensions/ext-openai/src/openai-provider.ts"`.

Actually **don't cross workspace boundaries in core imports**. Instead:
- Remove the fallback `createOpenAIModelRuntime(...)` call from both files. When `ext-openai` isn't installed and the registry doesn't have `"openai"`, throw a clear error instead.
- In `model-registry.ts` at Step 2 of Task 10's rewrite, replace the fallback `return createOpenAIModelRuntime(...)` with:
  ```ts
  throw toError(createError({
    type: "config",
    message: "OpenAI provider not installed. Add @veryfront/ext-openai to use openai/* models.",
  }));
  ```
- In `veryfront-cloud/provider.ts` at Task 11, replace the fallback with an equivalent throw.
- Drop the now-unused `import { createOpenAIModelRuntime } from "../runtime-loader.ts"` in both files.

- [ ] **Step 6: Run the extension test suite**

Run: `deno test --no-check --allow-all extensions/ext-openai/src/`
Expected: all migrated OpenAI tests + the smoke test pass.

- [ ] **Step 7: Run the remaining core runtime-loader tests**

Run: `deno test --no-check --allow-all src/provider/runtime-loader.test.ts`
Expected: Anthropic + Google test blocks still pass. OpenAI blocks were deleted in Task 13 Step 3.

- [ ] **Step 8: Commit**

```bash
git add extensions/ext-openai/src/openai-provider.ts \
         src/provider/runtime-loader.ts \
         src/provider/model-registry.ts \
         src/provider/veryfront-cloud/provider.ts
git commit -m "feat(ext-openai): move createOpenAI*Runtime factories out of core"
```

---

### Task 15: Make `tests/_helpers/context.ts` materialize `ext-openai` for integration tests

**Why this task exists.** ext-babel's integration tests needed a file re-export at `<projectDir>/extensions/ext-babel/index.ts` because `discoverProjectExtensions` skips symlinks (`entry.isDirectory === false` for a symlink). ext-openai will hit the same path. See commit history on `tests/_helpers/context.ts` for the exact pattern.

**Files:**
- Modify: `tests/_helpers/context.ts`

- [ ] **Step 1: Locate the `createProjectStructure` helper**

Read `tests/_helpers/context.ts`. Find the block that materializes `<projectDir>/extensions/ext-babel/index.ts`. It looks roughly like:

```ts
const extBabelDir = join(this.projectDir, "extensions", "ext-babel");
await mkdir(extBabelDir, { recursive: true });
const extBabelReal = resolvePath("extensions/ext-babel/src/index.ts");
await writeTextFile(
  join(extBabelDir, "index.ts"),
  `export { default } from "${"file://" + extBabelReal}";\n`,
);
```

- [ ] **Step 2: Duplicate it for ext-openai**

Directly below, add:

```ts
const extOpenAIDir = join(this.projectDir, "extensions", "ext-openai");
await mkdir(extOpenAIDir, { recursive: true });
const extOpenAIReal = resolvePath("extensions/ext-openai/src/index.ts");
await writeTextFile(
  join(extOpenAIDir, "index.ts"),
  `export { default } from "${"file://" + extOpenAIReal}";\n`,
);
```

- [ ] **Step 3: Find the `registerExtBabelForTests()` helper (or equivalent)**

Look for a helper that pre-registers ext-babel's factory into the test harness. Add an `registerExtOpenAIForTests()` sibling that does the same for ext-openai: import the default factory from `extensions/ext-openai/src/index.ts`, construct the extension descriptor, run its `setup()` against a context that provides the `AIProviderRegistry`.

Exact signature mirrors `registerExtBabelForTests()` — copy-adapt it. If the helper also primes the `AIProviderRegistry` contract itself (it needs to, so that `setup()` can `require()` it), add the import and the priming:

```ts
import { createAIProviderRegistry } from "#veryfront/extensions/registries/ai-provider-registry.ts";
import { register as registerContract } from "#veryfront/extensions/contracts.ts";
import { AIProviderRegistryName } from "#veryfront/extensions/interfaces/index.ts";

function registerExtOpenAIForTests(): void {
  const registry = createAIProviderRegistry();
  registerContract(AIProviderRegistryName, registry);
  // Then run ext-openai's setup against a fake ctx that resolves the registry.
  // Mirror whatever registerExtBabelForTests does for context construction.
}
```

Call `registerExtOpenAIForTests()` from wherever `registerExtBabelForTests()` is invoked (module load + inside `runWithCacheDir`).

- [ ] **Step 4: Run the production-server tests**

Run: `deno test --no-check --allow-all tests/`
Expected: all tests pass, including any integration tests that `resolveModel("openai/gpt-4o-mini")` during bootstrap.

- [ ] **Step 5: Commit**

```bash
git add tests/_helpers/context.ts
git commit -m "test(harness): materialize ext-openai in projectDir for integration tests"
```

---

## Phase F — Validate end-to-end

### Task 16: Full test suite + lint

**Files:** none (validation only).

- [ ] **Step 1: Run lint**

Run: `deno lint`
Expected: no errors. Fix any surfaced by newly-added code.

- [ ] **Step 2: Run the full test suite**

Run: `deno task test` (or whatever the root test task is — check `deno.json` `tasks`)
Expected: all tests pass. The pre-push hook runs this; match whichever command it executes.

- [ ] **Step 3: Run the pre-push hook manually as a final gate**

Run: `./scripts/pre-push` (or `.git/hooks/pre-push` if installed)
Expected: green — `NNN passed | 0 failed` and "All pre-push checks passed!".

If anything fails, loop back to the owning task; don't commit a hot-fix without tracing to the root cause.

- [ ] **Step 4: Open the draft PR**

Push the branch and open a draft PR titled `feat(ext-openai): extract OpenAI provider behind AIProviderRegistry contract`. Body should link to the design spec (`docs/superpowers/specs/2026-04-23-multi-llm-provider-extensions-design.md`) and summarize the 15 tasks above by phase.

---

## Rollback and compatibility

- **Between Task 3 and Task 14**, `runtime-loader.ts` still exports the OpenAI factories and `model-registry.ts` still falls back to them. The contract+registry path is additive.
- **After Task 14**, core no longer contains OpenAI code. Consumers must have `ext-openai` installed (it's in the workspace — shipped with the repo). The error message added at Task 14 Step 5 tells users what to do if they somehow build without it.
- **Anthropic + Google are untouched** through this PR. Their tests in `runtime-loader.test.ts` still run; their branches in `model-registry.ts` and `veryfront-cloud/provider.ts` still use the direct factory path. PRs 12 and 13 extract them.
- **`AIModelProvider` deletion (Task 3)** is safe because no runtime code referenced the interface — only the barrel and the recommendations map. Grep confirmed at plan-write time.

## Out of scope for this PR

- Moving Anthropic or Google code (PR 12 / 13).
- Deleting `src/provider/runtime-loader.ts` entirely (PR 14).
- Physically relocating shared plumbing out of `runtime-loader.ts` into `src/provider/shared/*.ts` files. The barrel re-exports keep the public surface stable; the physical move is deferred to PR 14.
- Docs and example-extension updates (PR 15).
