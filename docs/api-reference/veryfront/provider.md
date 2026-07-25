---
title: "veryfront/provider"
description: "Model provider registry and runtime resolution."
order: 22
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

Register a custom model provider factory.

**Returns:** `void`

### `resolveModel(modelString)`

Resolve a "provider/model" string to a framework-compatible model runtime.

**Returns:** `ModelRuntime`

### `hasModelProvider(name)`

Check whether a model provider is available in the current scope.

**Returns:** `boolean`

### `getRegisteredModelProviders()`

Get provider names available in the current scope.

**Returns:** `string[]`

### `clearModelProviders()`

Clear model providers registered in the current project source scope.

**Returns:** `void`

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_VERYFRONT_CLOUD_CHAT_MODEL` | Catalog-backed default model descriptor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L241) |
| `DEFAULT_VERYFRONT_CLOUD_MODEL_ID` | Default Veryfront Cloud model ID used when no model is configured. Update this when the current default is deprecated - otherwise the default path silently breaks for users who have not set an explicit model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L48) |
| `DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID` | Canonical direct provider/model ID for the default chat model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L243) |
| `DEFAULT_VERYFRONT_CLOUD_RUNTIME_MODEL_ID` | Canonical hosted runtime ID for the default chat model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L245) |
| `VERYFRONT_CLOUD_CHAT_MODELS` | Shared Veryfront Cloud chat models value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L217) |
| `VERYFRONT_CLOUD_MODEL_PREFIX` | Shared Veryfront Cloud model prefix value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L50) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `clearModelProviders` | Clear model providers registered in the current project source scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L381) |
| `ensureModelReady` | Eagerly verify that the resolved model's runtime is available. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L366) |
| `findVeryfrontCloudModel` | Find Veryfront Cloud model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L249) |
| `findVeryfrontCloudModelByModelId` | Find Veryfront Cloud model by model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L261) |
| `getCurrentVeryfrontCloudContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L31) |
| `getRegisteredModelProviders` | Get provider names available in the current scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L348) |
| `getVeryfrontCloudBootstrap` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/cloud/resolver.ts#L124) |
| `getVeryfrontCloudProviderFromModelId` | Return Veryfront Cloud provider from model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L269) |
| `groupVeryfrontCloudModelsByProvider` | Group Veryfront Cloud models by provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L455) |
| `hasModelProvider` | Check whether a model provider is available in the current scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L334) |
| `markCurrentVeryfrontCloudBillingGroupUsed` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L35) |
| `normalizeVeryfrontCloudModelId` | Normalizes Veryfront Cloud model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L254) |
| `registerModelProvider` | Register a custom model provider factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L111) |
| `resolveModel` | Resolve a "provider/model" string to a framework-compatible model runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L277) |
| `resolveVeryfrontCloudGatewayModelId` | Resolves Veryfront Cloud gateway model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L320) |
| `resolveVeryfrontCloudModelId` | Resolves Veryfront Cloud model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L294) |
| `resolveVeryfrontCloudModelThinking` | Resolves Veryfront Cloud model thinking. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L346) |
| `resolveVeryfrontCloudReasoningOption` | Resolves provider-neutral runtime reasoning for a Veryfront Cloud model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L366) |
| `resolveVeryfrontCloudThinkingProviderOptions` | Options accepted by resolve Veryfront Cloud thinking provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L395) |
| `runWithVeryfrontCloudContext` | Context for run with Veryfront Cloud. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L16) |
| `runWithVeryfrontCloudContextAsync` | Run with Veryfront Cloud context async. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L24) |
| `tryGetVeryfrontCloudProviderFromModelId` | Try to get Veryfront Cloud provider from model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L283) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ModelProviderFactory` | Public API contract for model provider factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L33) |
| `ModelRuntime` | Public API contract for model runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L196) |
| `ModelRuntimeCallOptions` | Canonical request contract passed to `ModelRuntime` generation hooks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L170) |
| `ModelRuntimePromptMessage` | Immutable prompt view accepted by model-runtime calls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L113) |
| `ModelRuntimeToolDefinition` | Canonical tool definition sent to a model runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L138) |
| `RuntimeAssistantContentPart` | Canonical assistant content accepted when invoking a model runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L33) |
| `RuntimePromptMessage` | Historical mutable provider-facing prompt contract retained for source compatibility. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L62) |
| `RuntimeReasoningOption` | Provider-neutral reasoning controls accepted by model runtimes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L131) |
| `RuntimeResponseFormat` | Provider-neutral structured-output request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L153) |
| `VeryfrontCloudBootstrap` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/cloud/resolver.ts#L52) |
| `VeryfrontCloudChatModel` | Public API contract for Veryfront Cloud chat model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L19) |
| `VeryfrontCloudContext` | Context for Veryfront Cloud. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L4) |
| `VeryfrontCloudModelThinkingConfig` | Configuration used by Veryfront Cloud model thinking. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L12) |
| `VeryfrontCloudProviderId` | Public API contract for Veryfront Cloud provider ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L4) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `resolveHostedVeryfrontCloudModelId` | Resolves hosted Veryfront Cloud model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L470) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/provider/shared`

Shared plumbing consumed by the `@veryfront/ext-*` provider extensions. This barrel is the stable extension-facing surface. Implementations remain internal to `runtime-loader.ts` and `runtime-loader/`; their physical location may change without changing extension imports.

```ts
import { buildProviderError, createAnthropicRequestInit, createGoogleRequestInit } from "veryfront/provider/shared";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `MAX_PROVIDER_SSE_BUFFER_CODE_UNITS` | Maximum decoded provider SSE data retained or parsed in one pass. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-sse.ts#L4) |
| `TOOL_INPUT_PENDING_THRESHOLD_MS` | Shared tool input pending threshold ms value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/tool-input-status.ts#L4) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildProviderError` | Inspect a non-2xx response and build the most specific ProviderError subclass we can. Reads the response body as text (it's already dead on the wire by this point). Body classification handles the cases where HTTP status alone is ambiguous - notably OpenAI `insufficient_quota` vs `rate_limit_exceeded` both arriving as 429. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L127) |
| `createAnthropicRequestInit` | Create Anthropic request init. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-request-init.ts#L131) |
| `createGoogleRequestInit` | Create Google request init. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-request-init.ts#L155) |
| `createOpenAIRequestInit` | Create request init options for OpenAI-compatible providers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-request-init.ts#L111) |
| `createWarningCollector` | Create warning collector. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L133) |
| `getAnthropicMessagesUrl` | Return Anthropic messages URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L53) |
| `getGoogleEmbeddingUrl` | Return Google embedding URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L90) |
| `getGoogleGenerateContentUrl` | Return Google generate content URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L68) |
| `getGoogleStreamGenerateContentUrl` | Return Google stream generate content URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L79) |
| `getOpenAIChatCompletionsUrl` | Return OpenAI chat completions URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L58) |
| `getOpenAIEmbeddingUrl` | Return OpenAI embedding URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L48) |
| `getOpenAIResponsesUrl` | Return OpenAI responses URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L63) |
| `isNumberArray` | Check whether a value is an array of numbers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-embedding-responses.ts#L2) |
| `jsonValuesEqual` | Compare JSON-compatible values independently of object key order. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/json-snapshot.ts#L500) |
| `mergeUsage` | Merge provider usage counters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-usage.ts#L120) |
| `parseFinalSseChunk` | Parse the final unterminated SSE block without making the synthetic frame delimiter count against the caller-visible retention boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-sse.ts#L38) |
| `parseRetryAfterMs` | Parses retry after ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L95) |
| `parseSseChunk` | Parse a bounded provider SSE buffer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-sse.ts#L27) |
| `readGatewayBillingMode` | Read a trusted gateway billing mode from provider metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-usage.ts#L107) |
| `readProviderOptions` | Options accepted by read provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L300) |
| `readRecord` | Record shape for read. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-records.ts#L2) |
| `readTextParts` | Read text content parts from provider messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L162) |
| `requestJson` | Request and parse a bounded JSON response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L603) |
| `requestStream` | Request a streaming response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L673) |
| `snapshotJsonValue` | Create a bounded, deeply owned, accessor-free snapshot of a JSON value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/json-snapshot.ts#L479) |
| `stringifyJsonValue` | Serialize a JSON-compatible value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L146) |
| `toOpenAICompatibleMessages` | Convert runtime prompt messages into OpenAI-compatible chat messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L207) |
| `toOpenAICompatibleTools` | Convert runtime tool definitions into OpenAI-compatible function tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L276) |
| `unwrapToolInputSchema` | Zod schema for unwrap tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L336) |
| `withToolInputStatusTransitions` | Applies tool input status transitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/tool-input-status.ts#L72) |

#### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ProviderError` | Base class for typed provider errors. The `retryable` flag is the primary signal for callers (or a retry wrapper) to decide whether to re-issue the request. `retryAfterMs` is set when the provider gave an explicit delay hint (Retry-After header, Retry-Info trailer). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L40) |
| `ProviderOverloadedError` | Provider reports it is overloaded (Anthropic 529, OpenAI/Google 503). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L70) |
| `ProviderQuotaError` | Provider account quota is exhausted - non-retryable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L76) |
| `ProviderRateLimitError` | Provider is rate limiting this API key (OpenAI/Google 429 with Retry-After). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L73) |
| `ProviderRequestError` | Non-retryable 4xx/5xx that doesn't fit another bucket. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L79) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `JsonSnapshotOptions` | Resource limits applied while taking a provider-boundary JSON snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/json-snapshot.ts#L22) |
| `JsonSnapshotValue` | A deeply owned JSON value returned by `snapshotJsonValue`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/json-snapshot.ts#L13) |
| `ModelRuntimeCallOptions` | Canonical request contract passed to `ModelRuntime` generation hooks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L170) |
| `ModelRuntimePromptMessage` | Immutable prompt view accepted by model-runtime calls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L113) |
| `ModelRuntimeToolDefinition` | Canonical tool definition sent to a model runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L138) |
| `OpenAICompatibleChatMessage` | Message shape for OpenAI-compatible chat requests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L45) |
| `OpenAICompatibleChatRequest` | Request payload for OpenAI-compatible chat completion providers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L82) |
| `ProviderWarning` | Structured warning emitted when a provider runtime drops or rewrites a caller-provided option. Mirrors the AI ecosystem convention (Vercel AI SDK, LangChain) of returning `unsupported-setting` warnings on the runtime result so callers can discover silently-dropped fields without having to read the source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L115) |
| `RuntimeAssistantContentPart` | Canonical assistant content accepted when invoking a model runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L33) |
| `RuntimePromptMessage` | Historical mutable provider-facing prompt contract retained for source compatibility. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L62) |
| `RuntimeReasoningOption` | Provider-neutral reasoning controls accepted by model runtimes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L131) |
| `RuntimeResponseFormat` | Provider-neutral structured-output request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L153) |
| `RuntimeUsage` | Canonical provider-neutral usage reported by text-generation runtimes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-usage.ts#L21) |

### `veryfront/provider/types`

```ts
import "veryfront/provider/types";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `EmbeddingRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L206) |
| `ModelRuntime` | Public API contract for model runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L196) |
| `ModelRuntimeCallOptions` | Canonical request contract passed to `ModelRuntime` generation hooks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L170) |
| `ModelRuntimeGenerateResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L117) |
| `ModelRuntimePromptMessage` | Immutable prompt view accepted by model-runtime calls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L113) |
| `ModelRuntimeStreamResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L125) |
| `ModelRuntimeToolDefinition` | Canonical tool definition sent to a model runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L138) |
| `RuntimeAssistantContentPart` | Canonical assistant content accepted when invoking a model runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L33) |
| `RuntimeMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L1) |
| `RuntimePromptMessage` | Historical mutable provider-facing prompt contract retained for source compatibility. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L62) |
| `RuntimeReasoningOption` | Provider-neutral reasoning controls accepted by model runtimes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L131) |
| `RuntimeResponseFormat` | Provider-neutral structured-output request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L153) |
