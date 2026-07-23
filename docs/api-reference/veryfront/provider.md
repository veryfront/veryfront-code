---
title: "veryfront/provider"
description: "Model provider registry and runtime resolution."
order: 23
---

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

const model = resolveModel("veryfront-cloud/openai/gpt-5.4-nano");
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
| `DEFAULT_VERYFRONT_CLOUD_MODEL_ID` | Default Veryfront Cloud model ID used when no model is configured. Update this when the current default is deprecated. Otherwise, users without an explicit model cannot resolve the default. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L35) |
| `VERYFRONT_CLOUD_CHAT_MODELS` | Immutable catalog of chat models exposed through Veryfront Cloud. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L81) |
| `VERYFRONT_CLOUD_MODEL_PREFIX` | Shared Veryfront Cloud model prefix value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L37) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `clearModelProviders` | Clear all registered model providers (for testing). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L345) |
| `ensureModelReady` | Eagerly verify that the resolved model's runtime is available. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L329) |
| `findVeryfrontCloudModel` | Find Veryfront Cloud model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L210) |
| `findVeryfrontCloudModelByModelId` | Find Veryfront Cloud model by model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L225) |
| `getCurrentVeryfrontCloudContext` | Return the Veryfront Cloud context for the current asynchronous scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L51) |
| `getRegisteredModelProviders` | Get list of registered model provider names (project-scoped + shared). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L311) |
| `getVeryfrontCloudBootstrap` | Resolves the current Veryfront Cloud bootstrap configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/cloud/resolver.ts#L167) |
| `getVeryfrontCloudProviderFromModelId` | Return Veryfront Cloud provider from model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L233) |
| `groupVeryfrontCloudModelsByProvider` | Group Veryfront Cloud models by provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L444) |
| `hasModelProvider` | Check if a model provider is registered (project-scoped or shared). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L302) |
| `markCurrentVeryfrontCloudBillingGroupUsed` | Mark the current billing group as used by a gateway request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L57) |
| `normalizeVeryfrontCloudModelId` | Normalizes Veryfront Cloud model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L215) |
| `registerModelProvider` | Register a custom model provider factory for the current project. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L128) |
| `resolveModel` | Resolve a "provider/model" string to a framework-compatible model runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L285) |
| `resolveVeryfrontCloudGatewayModelId` | Resolves Veryfront Cloud gateway model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L293) |
| `resolveVeryfrontCloudModelId` | Resolves Veryfront Cloud model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L266) |
| `resolveVeryfrontCloudModelThinking` | Resolves Veryfront Cloud model thinking. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L320) |
| `resolveVeryfrontCloudReasoningOption` | Resolves provider-neutral runtime reasoning for a Veryfront Cloud model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L343) |
| `resolveVeryfrontCloudThinkingProviderOptions` | Options accepted by resolve Veryfront Cloud thinking provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L381) |
| `runWithVeryfrontCloudContext` | Context for run with Veryfront Cloud. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L33) |
| `runWithVeryfrontCloudContextAsync` | Run with Veryfront Cloud context async. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L42) |
| `tryGetVeryfrontCloudProviderFromModelId` | Try to get Veryfront Cloud provider from model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L255) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `EmbeddingRuntime` | Public API contract for an embedding runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L46) |
| `ModelProviderFactory` | Public API contract for model provider factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L33) |
| `ModelRuntime` | Public API contract for model runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L34) |
| `ModelRuntimeGenerateResult` | Result returned by non-streaming model generation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L14) |
| `ModelRuntimeStreamResult` | Result returned when model streaming starts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L26) |
| `RuntimeMetadata` | Metadata exposed by a model or embedding runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L2) |
| `VeryfrontCloudBootstrap` | Resolved credentials and request context for Veryfront Cloud operations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/cloud/resolver.ts#L51) |
| `VeryfrontCloudChatModel` | Public API contract for Veryfront Cloud chat model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L20) |
| `VeryfrontCloudContext` | Context for Veryfront Cloud. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L5) |
| `VeryfrontCloudModelThinkingConfig` | Configuration used by Veryfront Cloud model thinking. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L13) |
| `VeryfrontCloudProviderId` | Public API contract for Veryfront Cloud provider ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L5) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `resolveHostedVeryfrontCloudModelId` | Resolves a hosted model ID to the gateway provider/model representation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L457) |

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
| `TOOL_INPUT_PENDING_THRESHOLD_MS` | Shared tool input pending threshold ms value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/tool-input-status.ts#L4) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildProviderError` | Inspect a non-2xx response and build the most specific ProviderError subclass we can. Reads the response body as text (it's already dead on the wire by this point). Body classification handles the cases where HTTP status alone is ambiguous - notably OpenAI `insufficient_quota` vs `rate_limit_exceeded` both arriving as 429. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L96) |
| `createAnthropicRequestInit` | Create Anthropic request init. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-request-init.ts#L95) |
| `createGoogleRequestInit` | Create Google request init. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-request-init.ts#L117) |
| `createOpenAIRequestInit` | Create request init options for OpenAI-compatible providers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-request-init.ts#L74) |
| `createWarningCollector` | Create warning collector. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L390) |
| `extractAnthropicUsage` | Extract normalized token and gateway usage from an Anthropic response payload. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-usage.ts#L132) |
| `extractGoogleEmbedding` | Extract one validated embedding vector from a Google response payload. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-embedding-responses.ts#L54) |
| `extractGoogleUsage` | Extract normalized token and gateway usage from a Google response payload. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-usage.ts#L157) |
| `extractGoogleUsageTokens` | Extract a validated prompt-token count from a Google embedding response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-embedding-responses.ts#L78) |
| `extractOpenAIEmbeddings` | Extract validated embedding vectors from an OpenAI response payload. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-embedding-responses.ts#L11) |
| `extractOpenAIResponsesUsage` | The Responses API uses `input_tokens` / `output_tokens` field names instead of Chat Completions' `prompt_tokens` / `completion_tokens`. It also nests cached input tokens under `input_tokens_details` and exposes reasoning tokens via `output_tokens_details.reasoning_tokens`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-usage.ts#L214) |
| `extractOpenAIUsage` | Extract normalized token and gateway usage from an OpenAI chat response payload. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-usage.ts#L183) |
| `extractOpenAIUsageTokens` | Extract a validated total-token count from an OpenAI embedding response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-embedding-responses.ts#L44) |
| `getAnthropicMessagesUrl` | Return Anthropic messages URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L46) |
| `getGoogleEmbeddingUrl` | Return Google embedding URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L85) |
| `getGoogleGenerateContentUrl` | Return Google generate content URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L61) |
| `getGoogleStreamGenerateContentUrl` | Return Google stream generate content URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L73) |
| `getOpenAIChatCompletionsUrl` | Return OpenAI chat completions URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L51) |
| `getOpenAIEmbeddingUrl` | Return OpenAI embedding URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L41) |
| `getOpenAIResponsesUrl` | Return OpenAI responses URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L56) |
| `isNumberArray` | Check whether a value is an array of numbers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-embedding-responses.ts#L5) |
| `mergeUsage` | Merge provider usage counters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-usage.ts#L244) |
| `normalizeRuntimeUsage` | Validate and snapshot provider usage metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-usage.ts#L64) |
| `parseRetryAfterMs` | Parses retry after ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L65) |
| `parseSseChunk` | Parses complete JSON data events from an SSE text buffer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-sse.ts#L12) |
| `readGatewayBillingMode` | Read a trusted gateway billing mode from provider metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-usage.ts#L7) |
| `readProviderOptions` | Options accepted by read provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L730) |
| `readRecord` | Record shape for read. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-records.ts#L2) |
| `readTextParts` | Read text content parts from provider messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L427) |
| `requestJson` | Request and parse a JSON response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L321) |
| `requestStream` | Request a streaming response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L367) |
| `stringifyJsonValue` | Serialize a JSON-compatible value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L406) |
| `toOpenAICompatibleMessages` | Convert runtime prompt messages into OpenAI-compatible chat messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L545) |
| `toOpenAICompatibleTools` | Convert runtime tool definitions into OpenAI-compatible function tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L688) |
| `unwrapToolInputSchema` | Zod schema for unwrap tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L761) |
| `withToolInputStatusTransitions` | Applies tool input status transitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/tool-input-status.ts#L78) |

#### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ProviderError` | Base class for typed provider errors. The `retryable` flag is the primary signal for callers (or a retry wrapper) to decide whether to re-issue the request. `retryAfterMs` is set when the provider gave an explicit delay hint (Retry-After header, Retry-Info trailer). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L23) |
| `ProviderOverloadedError` | Provider reports it is overloaded (Anthropic 529, OpenAI/Google 503). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L53) |
| `ProviderQuotaError` | Provider account quota is exhausted - non-retryable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L59) |
| `ProviderRateLimitError` | Provider is rate limiting this API key (OpenAI/Google 429 with Retry-After). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L56) |
| `ProviderRequestError` | Non-retryable 4xx/5xx that doesn't fit another bucket. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L62) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `GatewayBillingMode` | Gateway billing mode attached by Veryfront Cloud usage envelopes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-usage.ts#L4) |
| `OpenAICompatibleChatMessage` | Message shape for OpenAI-compatible chat requests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L304) |
| `OpenAICompatibleChatRequest` | Request payload for OpenAI-compatible chat completion providers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L338) |
| `ParseSseChunkOptions` | Controls how malformed JSON data events are handled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-sse.ts#L6) |
| `ProviderKind` | Which provider runtime a request is being sent to. `mistral` and `moonshotai` use the OpenAI-compatible wire format and are therefore treated as "openai" for error classification purposes; they are listed here so call sites can pass accurate labels without a cast. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L10) |
| `ProviderWarning` | Structured warning emitted when a provider runtime drops or rewrites a caller-provided option. Mirrors the AI ecosystem convention (Vercel AI SDK, LangChain) of returning `unsupported-setting` warnings on the runtime result so callers can discover silently-dropped fields without having to read the source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L371) |
| `RuntimePromptMessage` | Message shape for runtime prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L69) |
| `RuntimeToolDefinition` | Tool definition accepted by the shared provider request builders. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L113) |
| `RuntimeUsage` | Public API contract for runtime usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-usage.ts#L12) |
| `WarningCollector` | Bounded collector for warnings produced while translating a request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L384) |

### `veryfront/provider/types`

Metadata exposed by a model or embedding runtime.

```ts
import "veryfront/provider/types";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `EmbeddingRuntime` | Public API contract for an embedding runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L46) |
| `ModelRuntime` | Public API contract for model runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L34) |
| `ModelRuntimeGenerateResult` | Result returned by non-streaming model generation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L14) |
| `ModelRuntimeStreamResult` | Result returned when model streaming starts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L26) |
| `RuntimeMetadata` | Metadata exposed by a model or embedding runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L2) |
