# Multi-LLM Provider Extensions — Design

**Date:** 2026-04-23
**Status:** Approved, ready for implementation planning
**Related:** Extensions waves 2-4 plan (`docs/superpowers/plans/2026-04-20-extensions-waves-2-4-and-inlining.md`), PR #1225 (ext-babel, draft)

## Goal

Extract the three built-in LLM providers — OpenAI, Anthropic, Google — from veryfront core into workspace extensions (`@veryfront/ext-openai`, `@veryfront/ext-anthropic`, `@veryfront/ext-google`), behind a new multi-provider contract that lets any number of providers coexist at runtime and be selected by id.

## Background

Today `src/provider/runtime-loader.ts` is 3776 lines containing direct HTTP call paths to OpenAI, Anthropic, and Google. Consumers pick a provider via `switch(providerId)` and call provider-specific factories (`createOpenAIModelRuntime`, `createAnthropicModelRuntime`, `createGoogleModelRuntime`, plus embedding + Responses variants).

A standalone `AIModelProvider` contract interface exists at `src/extensions/interfaces/ai-model-provider.ts` (chat-oriented `complete`/`stream`) but is **not used** by the runtime — it predates the current `ModelRuntime` shape (`doGenerate`/`doStream`, mirrors the AI SDK v1/v2 provider protocol) that consumers actually depend on. The two have drifted.

The contract registry at `src/extensions/contracts.ts` is a singleton `Map<string, unknown>` — one impl per name. Three LLM providers cannot coexist under a single contract name without change.

## Design decisions (summary of brainstorming)

- **B — Registry-as-contract.** Core resolves one contract (`AIProviderRegistry`) that hands out providers by id, rather than unique contract names per provider (e.g. `AIProvider:openai`) or a generic `provideMany` primitive.
- **B3 — New combined contract.** Extensions implement a new `AIProvider` interface tailored to what `ModelRuntime` consumers need — not the existing `AIModelProvider` (too narrow) and not `ModelRuntime` directly (too sprawling).
- **B3a — Core owns the registry, extensions register into it.** Core bootstrap instantiates the registry and registers it into the contract store before `ExtensionLoader.setupAll()`. Each extension's `setup(ctx)` resolves it and calls `registry.register(self)`.
- **B3a-i — All provider-specific code moves to extensions.** Core keeps only contract types and shared plumbing. No back-compat shims.
- **α — Optional methods on one interface.** `createModel` required; `createEmbedding` / `createResponses` optional and absent on providers that don't support them.
- **1 — Shared plumbing stays in core.** Retry, error shaping, SSE parsing, tool-call accumulation, URL helpers live under `src/provider/shared/`. Extensions import them.
- **x — Normalized config at the contract.** `AIProviderConfig` has `credential`, `baseURL?`, `fetch?`, `name?`, plus `[key: string]: unknown` for extras. Extensions map `credential` to whatever their API calls it internally.

## Model selection flow

Unchanged from user's perspective — still `"provider/model"` strings (`"openai/gpt-4o"`, `"anthropic/claude-sonnet-4-20250514"`).

1. User passes `"openai/gpt-4o"` to `resolveModel()` (or it arrives via config / env).
2. `resolveModel()` splits on `/` → `providerId = "openai"`, `modelId = "gpt-4o"`.
3. `resolveModel()` calls `registry.require("openai")`.
4. `resolveModel()` calls `provider.createModel("gpt-4o", { credential, baseURL, fetch })`.
5. Extension (`ext-openai`) builds the `ModelRuntime` using its owned HTTP path.

Providers don't validate model ids — they just forward the string to the upstream API. Model catalogs drift; each provider's API already returns a clear error for unknown ids.

## Contract interfaces

New file: `src/extensions/interfaces/ai-provider.ts` (replaces the deleted `ai-model-provider.ts`).

```ts
import type { EmbeddingRuntime, ModelRuntime } from "#veryfront/provider/types.ts";

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
 * AIProviderRegistry during setup(). `createModel` is required; embeddings
 * and the OpenAI Responses API are optional and absent on providers that
 * don't support them (e.g. Anthropic has neither).
 */
export interface AIProvider {
  /** Stable id used in model strings: "openai" / "anthropic" / "google". */
  readonly id: string;
  createModel(modelId: string, config: AIProviderConfig): ModelRuntime;
  createEmbedding?(modelId: string, config: AIProviderConfig): EmbeddingRuntime;
  createResponses?(modelId: string, config: AIProviderConfig): ModelRuntime;
}

/**
 * Registry contract. Single impl created at bootstrap, resolved by extensions
 * in their setup() to register themselves, and by core consumers to dispatch.
 */
export interface AIProviderRegistry {
  register(provider: AIProvider): void;
  unregister(id: string): void;
  get(id: string): AIProvider | undefined;
  require(id: string): AIProvider;  // throws with "known providers: ..." message
  list(): AIProvider[];
  has(id: string): boolean;
}

export const AIProviderRegistryName = "AIProviderRegistry" as const;
```

**Duplicate-registration guard**: `register()` throws if a provider with the same id already exists. Prevents silent collisions between e.g. `ext-openai` and a third-party OpenAI-compatible extension. Explicit overrides use `unregister(id)` first.

Core ships a `Map`-backed default impl at `src/extensions/registries/ai-provider-registry.ts`.

## Provider capability matrix

| Provider   | Chat | Streaming | Embeddings | Responses API |
|------------|------|-----------|------------|---------------|
| OpenAI     | ✅   | ✅        | ✅         | ✅            |
| Anthropic  | ✅   | ✅        | ❌         | ❌            |
| Google     | ✅   | ✅        | ✅         | ❌            |

## Core file layout

**Deleted from core**
- `src/provider/runtime-loader.ts` (3776 lines).
- `src/provider/runtime-loader.test.ts`.
- `src/extensions/interfaces/ai-model-provider.ts`.

**New in core**
- `src/extensions/interfaces/ai-provider.ts` — contract types.
- `src/extensions/registries/ai-provider-registry.ts` — default `Map`-backed impl.
- `src/provider/shared/` — shared plumbing moved from `runtime-loader.ts`:
  - `retry.ts` — retry/backoff.
  - `errors.ts` — `buildProviderError`, `ProviderKind`, error shaping.
  - `sse.ts` — SSE parsing (shared by OpenAI + Google; Anthropic's event shape differs and stays in-extension).
  - `tool-call-stream.ts` — tool-call delta accumulation.
  - `endpoints.ts` — moved from `runtime-loader/provider-endpoints.ts`.
  - `request-init.ts` — moved from `runtime-loader/provider-request-init.ts`.
- Bootstrap patch: register `AIProviderRegistry` instance into the contract registry before `ExtensionLoader.setupAll()`.

**Stays in core, gets thinner**
- `src/provider/model-registry.ts` — `autoInitializeFromEnv()` iterates `registry.list()` instead of three hard-coded branches.
- `src/provider/veryfront-cloud/provider.ts` — the `switch(provider)` becomes `registry.require(provider).createModel(upstreamModelId, { credential, baseURL, fetch, name: "veryfront-cloud" })`.
- `src/provider/types.ts` — unchanged.
- `src/provider/local/` and `src/provider/veryfront-cloud/` — unchanged. Local models aren't an HTTP LLM provider; veryfront-cloud dispatches *to* the AI providers.

**New extension workspace members** (mirror `ext-babel`'s shape)
- `extensions/ext-openai/` — `createOpenAIModelRuntime`, `createOpenAIResponsesRuntime`, `createOpenAIEmbeddingRuntime`.
- `extensions/ext-anthropic/` — `createAnthropicModelRuntime`, Anthropic SSE event handling.
- `extensions/ext-google/` — `createGoogleModelRuntime`, `createGoogleEmbeddingRuntime`.

Each extension imports shared plumbing from `veryfront/provider/shared` via its own `deno.json` import map.

## Extension shape — `ext-openai` worked example

`extensions/ext-openai/deno.json`:

```json
{
  "name": "@veryfront/ext-openai",
  "exports": "./src/index.ts",
  "veryfront": { "extension": true },
  "imports": {
    "@std/assert": "jsr:@std/assert@^1",
    "@std/testing/bdd": "jsr:@std/testing/bdd@^1",
    "veryfront/extensions": "../../src/extensions/index.ts",
    "veryfront/extensions/interfaces": "../../src/extensions/interfaces/index.ts",
    "veryfront/provider/shared": "../../src/provider/shared/index.ts",
    "veryfront/provider/types": "../../src/provider/types.ts"
  }
}
```

`extensions/ext-openai/src/index.ts`:

```ts
import type { ExtensionFactory } from "veryfront/extensions";
import type { AIProviderRegistry } from "veryfront/extensions/interfaces";
import { OpenAIProvider } from "./openai-provider.ts";

const extOpenAI: ExtensionFactory = () => ({
  name: "ext-openai",
  capabilities: [{ type: "contract", name: "AIProvider:openai" }],
  setup(ctx) {
    const registry = ctx.resolve<AIProviderRegistry>("AIProviderRegistry");
    registry.register(new OpenAIProvider());
  },
});

export default extOpenAI;
export { OpenAIProvider };
```

`extensions/ext-openai/src/openai-provider.ts`:

```ts
import type { AIProvider, AIProviderConfig } from "veryfront/extensions/interfaces";
import type { EmbeddingRuntime, ModelRuntime } from "veryfront/provider/types";
import {
  buildProviderError,
  getOpenAIChatCompletionsUrl,
  getOpenAIEmbeddingUrl,
  getOpenAIResponsesUrl,
  parseSSE,
  retryWithBackoff,
} from "veryfront/provider/shared";

export class OpenAIProvider implements AIProvider {
  readonly id = "openai";

  createModel(modelId: string, config: AIProviderConfig): ModelRuntime {
    return createOpenAIModelRuntime({
      apiKey: config.credential,
      baseURL: config.baseURL,
      name: config.name ?? "openai",
      fetch: config.fetch,
    }, modelId);
  }

  createEmbedding(modelId: string, config: AIProviderConfig): EmbeddingRuntime {
    return createOpenAIEmbeddingRuntime({
      apiKey: config.credential,
      baseURL: config.baseURL,
      name: config.name ?? "openai",
      fetch: config.fetch,
    }, modelId);
  }

  createResponses(modelId: string, config: AIProviderConfig): ModelRuntime {
    return createOpenAIResponsesRuntime({
      apiKey: config.credential,
      baseURL: config.baseURL,
      name: config.name ?? "openai",
      fetch: config.fetch,
    }, modelId);
  }
}

// createOpenAIModelRuntime, createOpenAIResponsesRuntime,
// createOpenAIEmbeddingRuntime — verbatim from the old runtime-loader.ts
// with shared helpers sourced from veryfront/provider/shared.
function createOpenAIModelRuntime(/* ... */): ModelRuntime { /* ... */ }
function createOpenAIResponsesRuntime(/* ... */): ModelRuntime { /* ... */ }
function createOpenAIEmbeddingRuntime(/* ... */): EmbeddingRuntime { /* ... */ }
```

`ext-anthropic` and `ext-google` follow the same shape. Anthropic omits `createEmbedding` and `createResponses`; Google omits `createResponses`.

**Capability naming**: `{ type: "contract", name: "AIProvider:openai" }` — each extension declares what *it* provides, not what infrastructure it uses. The registry is core infrastructure and is not a capability that extensions contribute.

## Tests

`runtime-loader.test.ts` (one file, tests all three providers today) splits along provider lines:

- OpenAI tests → `extensions/ext-openai/src/openai-provider.test.ts`.
- Anthropic tests → `extensions/ext-anthropic/src/anthropic-provider.test.ts`.
- Google tests → `extensions/ext-google/src/google-provider.test.ts`.

Each test file imports the factory under test directly — no registry round-trip needed. Registry behaviour is tested in a separate small file under `src/extensions/registries/ai-provider-registry.test.ts` (register/unregister/require, duplicate-id guard, unknown-id error message).

A smoke test per extension follows the `ext-babel` pattern: factory returns the expected descriptor + capability, and `setup(ctx)` with a fake context registers an instance into a mock registry.

## PR sequence

Five PRs. PR 11 does the heavy infrastructure lift and extracts the first provider; 12 and 13 mirror it for the other two; 14/15 clean up.

### PR 11 — core contract + registry + `ext-openai`

1. Create `src/extensions/interfaces/ai-provider.ts`.
2. Delete `src/extensions/interfaces/ai-model-provider.ts` (+ fix barrel exports).
3. Create `src/extensions/registries/ai-provider-registry.ts` (`Map`-backed impl + test).
4. Patch bootstrap to register `AIProviderRegistry` instance before `ExtensionLoader.setupAll()`.
5. Extract shared plumbing from `runtime-loader.ts` into `src/provider/shared/` (retry, errors, sse, tool-call-stream, endpoints, request-init). Update `runtime-loader.ts` to import from there.
6. Scaffold `extensions/ext-openai/` workspace member: `deno.json`, `src/index.ts`, `src/openai-provider.ts`, `src/openai-provider.test.ts`.
7. Move `createOpenAIModelRuntime`, `createOpenAIResponsesRuntime`, `createOpenAIEmbeddingRuntime` from `runtime-loader.ts` into `ext-openai`.
8. Migrate OpenAI tests from `runtime-loader.test.ts` into `ext-openai`.
9. Rewrite `model-registry.ts::autoInitializeFromEnv()` to iterate `registry.list()`. Anthropic + Google branches keep calling the old factories for now.
10. Rewrite the `openai` / `moonshotai` cases in `veryfront-cloud/provider.ts` to use `registry.require("openai").createModel(...)`. Anthropic + Google cases unchanged.
11. Pre-push hook green (full test suite + lint).

**Risk:** proves the design end-to-end. If something doesn't fit, discovered here.

### PR 12 — `ext-anthropic`

Steps 6–10 of PR 11, for Anthropic. Moves `createAnthropicModelRuntime` out with its Anthropic-specific SSE handling. Removes the Anthropic branch from `model-registry.ts` autoinit and `veryfront-cloud/provider.ts` switch. Smaller PR — infrastructure already in place.

### PR 13 — `ext-google`

Mirror of PR 12 for Google. Moves `createGoogleModelRuntime` + `createGoogleEmbeddingRuntime`. After landing, `runtime-loader.ts` contains no provider-specific code.

### PR 14 — delete `runtime-loader.ts`

`runtime-loader.ts` and `runtime-loader.test.ts` are deleted. Any remaining internal imports (e.g. `runtime-inspection.ts`) are updated. `src/provider/runtime-loader/` subdirectory (containing the already-extracted `provider-endpoints.ts` + `provider-request-init.ts`) can be merged into `src/provider/shared/` if cleaner, or left as-is.

### PR 15 — docs + examples *(optional, may fold into 14)*

- Remove references to `createOpenAIModelRuntime` et al. as public APIs from docs.
- Document the `AIProvider` contract for third-party extension authors.
- Example extension in `examples/` showing how to add an OpenAI-compatible provider.

## Rollback story

Each of PR 11–13 keeps the other unextracted providers working against the old factories. `model-registry.ts::autoInitializeFromEnv()` has three independent `if (!manager.has(id))` blocks — one gets rewired per PR, the other two keep using the old factories. No long-lived broken state between PRs; every merge leaves a working test suite.

## Out of scope

- `ext-esbuild` extraction (PR 9 in the waves plan — larger, 32-file scope, scheduled separately).
- Migrating the `ModelRuntime` protocol itself. The `doGenerate`/`doStream` shape stays as-is; this design only changes *who* implements it and *how* consumers look it up.
- Model catalog validation in the provider layer. Unknown model ids continue to be rejected by the upstream API.
- Multi-tenancy of the registry. The registry is process-global, same as today's `ProjectScopedRegistryManager` for model providers. Project-scoping remains handled at `model-registry.ts`.

## Open questions — none at time of writing

All decisions locked during brainstorming. If implementation surfaces a constraint that doesn't fit (e.g. Anthropic SSE needs something from shared/sse.ts that can't cleanly be shared), revisit and note the deviation here.
