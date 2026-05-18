---
title: "veryfront/provider"
description: "Provider registry. Maps \"provider/model\" strings to framework-compatible model runtimes. Auto-initializes built-in providers from environment variables on first use."
order: 20
---

# veryfront/provider

Provider registry. Maps "provider/model" strings to framework-compatible model runtimes. Auto-initializes built-in providers from environment variables on first use.

## Import

```ts
import {
  registerModelProvider,
  resolveModel,
  hasModelProvider,
  getRegisteredModelProviders,
  clearModelProviders,
  ensureModelReady,
} from "veryfront/provider";
```

## Examples

### Resolve a model

```ts
import { resolveModel } from "veryfront/provider";

const model = resolveModel("veryfront-cloud/openai/gpt-5.2");
```

## API

### `registerModelProvider(name, factory)`

Register a custom model provider factory for the current project.

**Returns:** `void`

### `resolveModel(modelString)`

Resolve a "provider/model" string to a framework-compatible model runtime.

**Returns:** `ModelRuntime`

### `hasModelProvider(name)`

Check if a model provider is registered (project-scoped or shared).

**Returns:** `boolean`

### `getRegisteredModelProviders()`

Get list of registered model provider names (project-scoped + shared).

**Returns:** `string[]`

### `clearModelProviders()`

Clear all registered model providers (for testing).

**Returns:** `void`

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_VERYFRONT_CLOUD_MODEL_ID` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L16) |
| `VERYFRONT_CLOUD_CHAT_MODELS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L27) |
| `VERYFRONT_CLOUD_MODEL_PREFIX` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L17) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `clearModelProviders` | Clear all registered model providers (for testing). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L365) |
| `ensureModelReady` | Eagerly verify that the resolved model's runtime is available. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L353) |
| `findAvailableCloudModel` | Find the first cloud provider with a valid API key. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L234) |
| `findVeryfrontCloudModel` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L82) |
| `findVeryfrontCloudModelByModelId` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L92) |
| `getRegisteredModelProviders` | Get list of registered model provider names (project-scoped + shared). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L335) |
| `getVeryfrontCloudProviderFromModelId` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L99) |
| `groupVeryfrontCloudModelsByProvider` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L211) |
| `hasModelProvider` | Check if a model provider is registered (project-scoped or shared). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L327) |
| `normalizeVeryfrontCloudModelId` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L86) |
| `registerModelProvider` | Register a custom model provider factory for the current project. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L56) |
| `resolveModel` | Resolve a "provider/model" string to a framework-compatible model runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L261) |
| `resolveVeryfrontCloudGatewayModelId` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L140) |
| `resolveVeryfrontCloudModelId` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L120) |
| `resolveVeryfrontCloudModelThinking` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L158) |
| `resolveVeryfrontCloudThinkingProviderOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L176) |
| `runWithVeryfrontCloudContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L11) |
| `runWithVeryfrontCloudContextAsync` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L18) |
| `tryGetVeryfrontCloudProviderFromModelId` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L110) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ModelProviderFactory` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L41) |
| `ModelRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L19) |
| `VeryfrontCloudChatModel` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L7) |
| `VeryfrontCloudContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L2) |
| `VeryfrontCloudModelThinkingConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L2) |
| `VeryfrontCloudProviderId` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/shared.ts#L3) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `resolveHostedVeryfrontCloudModelId` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L223) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/provider/shared`

Shared plumbing consumed by the `@veryfront/ext-*` provider extensions. This barrel is the stable public surface: implementations currently live in `runtime-loader.ts` and `runtime-loader/` subdirectory. Future PRs (post ext-llm-anthropic / ext-llm-google extraction) may move the implementations into this directory; extensions keep importing from here unchanged.

```ts
import { buildProviderError, createAnthropicRequestInit, createGoogleRequestInit } from "veryfront/provider/shared";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `TOOL_INPUT_PENDING_THRESHOLD_MS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/tool-input-status.ts) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildProviderError` | Inspect a non-2xx response and build the most specific ProviderError subclass we can. Reads the response body as text (it's already dead on the wire by this point). Body classification handles the cases where HTTP status alone is ambiguous - notably OpenAI `insufficient_quota` vs `rate_limit_exceeded` both arriving as 429. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L67) |
| `createAnthropicRequestInit` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-request-init.ts#L63) |
| `createGoogleRequestInit` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-request-init.ts#L84) |
| `createOpenAIRequestInit` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-request-init.ts#L45) |
| `createWarningCollector` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L350) |
| `getAnthropicMessagesUrl` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L12) |
| `getGoogleEmbeddingUrl` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L44) |
| `getGoogleGenerateContentUrl` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L24) |
| `getGoogleStreamGenerateContentUrl` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L34) |
| `getOpenAIChatCompletionsUrl` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L16) |
| `getOpenAIEmbeddingUrl` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L8) |
| `getOpenAIResponsesUrl` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L20) |
| `isNumberArray` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-embedding-responses.ts#L2) |
| `mergeUsage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-usage.ts#L109) |
| `parseRetryAfterMs` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L46) |
| `parseSseChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-sse.ts) |
| `readProviderOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L489) |
| `readRecord` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-records.ts) |
| `readTextParts` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L370) |
| `requestJson` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L165) |
| `requestStream` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L182) |
| `stringifyJsonValue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L362) |
| `toOpenAICompatibleMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L404) |
| `toOpenAICompatibleTools` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L466) |
| `unwrapToolInputSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L509) |
| `withToolInputStatusTransitions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/tool-input-status.ts#L59) |

#### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ProviderError` | Base class for typed provider errors. The `retryable` flag is the primary signal for callers (or a retry wrapper) to decide whether to re-issue the request. `retryAfterMs` is set when the provider gave an explicit delay hint (Retry-After header, Retry-Info trailer). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L10) |
| `ProviderOverloadedError` | Provider reports it is overloaded (Anthropic 529, OpenAI/Google 503). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L35) |
| `ProviderQuotaError` | Provider account quota is exhausted - non-retryable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L41) |
| `ProviderRateLimitError` | Provider is rate limiting this API key (OpenAI/Google 429 with Retry-After). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L38) |
| `ProviderRequestError` | Non-retryable 4xx/5xx that doesn't fit another bucket. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L44) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `OpenAICompatibleChatMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L267) |
| `OpenAICompatibleChatRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L300) |
| `ProviderWarning` | Structured warning emitted when a provider runtime drops or rewrites a caller-provided option. Mirrors the AI ecosystem convention (Vercel AI SDK, LangChain) of returning `unsupported-setting` warnings on the runtime result so callers can discover silently-dropped fields without having to read the source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L333) |
| `RuntimePromptMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L34) |
| `RuntimeUsage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-usage.ts#L2) |

## Related

Reference modules:

- [`veryfront/agent`](./agent.md): Agents use providers for AI models

User guides:

- [providers](../../guides/providers.md): Register model providers

Architecture:

- [07-provider-runtime](../../architecture/07-provider-runtime.md): Provider and embedding runtime
