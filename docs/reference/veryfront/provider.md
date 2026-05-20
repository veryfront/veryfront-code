---
title: "veryfront/provider"
description: "Provider registry. Maps \"provider/model\" strings to framework-compatible model runtimes. Auto-initializes built-in providers from environment variables on first use."
order: 20
---

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
| `DEFAULT_VERYFRONT_CLOUD_MODEL_ID` | Default value for Veryfront Cloud model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L20) |
| `VERYFRONT_CLOUD_CHAT_MODELS` | Shared Veryfront Cloud chat models value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L33) |
| `VERYFRONT_CLOUD_MODEL_PREFIX` | Shared Veryfront Cloud model prefix value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L22) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `clearModelProviders` | Clear all registered model providers (for testing). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L367) |
| `ensureModelReady` | Eagerly verify that the resolved model's runtime is available. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L355) |
| `findAvailableCloudModel` | Find the first cloud provider with a valid API key. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L236) |
| `findVeryfrontCloudModel` | Find Veryfront Cloud model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L89) |
| `findVeryfrontCloudModelByModelId` | Find Veryfront Cloud model by model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L101) |
| `getRegisteredModelProviders` | Get list of registered model provider names (project-scoped + shared). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L337) |
| `getVeryfrontCloudProviderFromModelId` | Return Veryfront Cloud provider from model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L109) |
| `groupVeryfrontCloudModelsByProvider` | Group Veryfront Cloud models by provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L227) |
| `hasModelProvider` | Check if a model provider is registered (project-scoped or shared). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L329) |
| `normalizeVeryfrontCloudModelId` | Normalizes Veryfront Cloud model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L94) |
| `registerModelProvider` | Register a custom model provider factory for the current project. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L58) |
| `resolveModel` | Resolve a "provider/model" string to a framework-compatible model runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L263) |
| `resolveVeryfrontCloudGatewayModelId` | Resolves Veryfront Cloud gateway model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L153) |
| `resolveVeryfrontCloudModelId` | Resolves Veryfront Cloud model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L132) |
| `resolveVeryfrontCloudModelThinking` | Resolves Veryfront Cloud model thinking. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L172) |
| `resolveVeryfrontCloudThinkingProviderOptions` | Options accepted by resolve Veryfront Cloud thinking provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L191) |
| `runWithVeryfrontCloudContext` | Context for run with Veryfront Cloud. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L14) |
| `runWithVeryfrontCloudContextAsync` | Run with Veryfront Cloud context async. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L22) |
| `tryGetVeryfrontCloudProviderFromModelId` | Try to get Veryfront Cloud provider from model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L121) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ModelProviderFactory` | Public API contract for model provider factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L43) |
| `ModelRuntime` | Public API contract for model runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L21) |
| `VeryfrontCloudChatModel` | Public API contract for Veryfront Cloud chat model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L10) |
| `VeryfrontCloudContext` | Context for Veryfront Cloud. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L4) |
| `VeryfrontCloudModelThinkingConfig` | Configuration used by Veryfront Cloud model thinking. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L4) |
| `VeryfrontCloudProviderId` | Public API contract for Veryfront Cloud provider ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/shared.ts#L5) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `resolveHostedVeryfrontCloudModelId` | Resolves hosted Veryfront Cloud model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L240) |

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
| `TOOL_INPUT_PENDING_THRESHOLD_MS` | Shared tool input pending threshold ms value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/tool-input-status.ts#L2) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildProviderError` | Inspect a non-2xx response and build the most specific ProviderError subclass we can. Reads the response body as text (it's already dead on the wire by this point). Body classification handles the cases where HTTP status alone is ambiguous - notably OpenAI `insufficient_quota` vs `rate_limit_exceeded` both arriving as 429. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L69) |
| `createAnthropicRequestInit` | Create Anthropic request init. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-request-init.ts#L66) |
| `createGoogleRequestInit` | Create Google request init. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-request-init.ts#L88) |
| `createOpenAIRequestInit` | Create request init options for OpenAI-compatible providers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-request-init.ts#L47) |
| `createWarningCollector` | Create warning collector. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L355) |
| `getAnthropicMessagesUrl` | Return Anthropic messages URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L15) |
| `getGoogleEmbeddingUrl` | Return Google embedding URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L52) |
| `getGoogleGenerateContentUrl` | Return Google generate content URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L30) |
| `getGoogleStreamGenerateContentUrl` | Return Google stream generate content URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L41) |
| `getOpenAIChatCompletionsUrl` | Return OpenAI chat completions URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L20) |
| `getOpenAIEmbeddingUrl` | Return OpenAI embedding URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L10) |
| `getOpenAIResponsesUrl` | Return OpenAI responses URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L25) |
| `isNumberArray` | Check whether a value is an array of numbers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-embedding-responses.ts#L4) |
| `mergeUsage` | Merge provider usage counters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-usage.ts#L112) |
| `parseRetryAfterMs` | Parses retry after ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L48) |
| `parseSseChunk` | Parses sse chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-sse.ts#L2) |
| `readProviderOptions` | Options accepted by read provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L499) |
| `readRecord` | Record shape for read. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-records.ts#L2) |
| `readTextParts` | Read text content parts from provider messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L377) |
| `requestJson` | Request and parse a JSON response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L168) |
| `requestStream` | Request a streaming response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L186) |
| `stringifyJsonValue` | Serialize a JSON-compatible value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L368) |
| `toOpenAICompatibleMessages` | Convert runtime prompt messages into OpenAI-compatible chat messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L412) |
| `toOpenAICompatibleTools` | Convert runtime tool definitions into OpenAI-compatible function tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L475) |
| `unwrapToolInputSchema` | Zod schema for unwrap tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L520) |
| `withToolInputStatusTransitions` | Applies tool input status transitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/tool-input-status.ts#L62) |

#### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ProviderError` | Base class for typed provider errors. The `retryable` flag is the primary signal for callers (or a retry wrapper) to decide whether to re-issue the request. `retryAfterMs` is set when the provider gave an explicit delay hint (Retry-After header, Retry-Info trailer). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L11) |
| `ProviderOverloadedError` | Provider reports it is overloaded (Anthropic 529, OpenAI/Google 503). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L36) |
| `ProviderQuotaError` | Provider account quota is exhausted - non-retryable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L42) |
| `ProviderRateLimitError` | Provider is rate limiting this API key (OpenAI/Google 429 with Retry-After). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L39) |
| `ProviderRequestError` | Non-retryable 4xx/5xx that doesn't fit another bucket. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L45) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `OpenAICompatibleChatMessage` | Message shape for OpenAI-compatible chat requests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L270) |
| `OpenAICompatibleChatRequest` | Request payload for OpenAI-compatible chat completion providers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L304) |
| `ProviderWarning` | Structured warning emitted when a provider runtime drops or rewrites a caller-provided option. Mirrors the AI ecosystem convention (Vercel AI SDK, LangChain) of returning `unsupported-setting` warnings on the runtime result so callers can discover silently-dropped fields without having to read the source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L337) |
| `RuntimePromptMessage` | Message shape for runtime prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L36) |
| `RuntimeUsage` | Public API contract for runtime usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-usage.ts#L4) |

## Related

Reference modules:

- [`veryfront/agent`](./agent.md): Agents use providers for AI models

User guides:

- [providers](../../guides/providers.md): Register model providers

Architecture:

- [07-provider-runtime](../../architecture/07-provider-runtime.md): Provider and embedding runtime
