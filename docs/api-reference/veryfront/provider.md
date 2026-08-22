---
title: "veryfront/provider"
description: "Model provider registry and runtime resolution."
order: 25
---

## Import

```ts
import {
  clearModelProviders,
  ensureModelReady,
  getRegisteredModelProviders,
  hasModelProvider,
  registerModelProvider,
  resolveModel,
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

Register a custom model provider factory for the active project scope or application bootstrap.

**Returns:** `ModelProviderRegistrationDisposer`

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

Clear all registered model providers and reset lazy built-ins (for testing).

**Returns:** `void`

## Exports

### Components

| Name                               | Description                                                                                                                                                                                                      | Source                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `DEFAULT_VERYFRONT_CLOUD_MODEL_ID` | Default Veryfront Cloud model ID used when no model is configured. Update this when the current default is deprecated - otherwise the default path silently breaks for users who have not set an explicit model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L48)  |
| `VERYFRONT_CLOUD_CHAT_MODELS`      | Shared Veryfront Cloud chat models value.                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L265) |
| `VERYFRONT_CLOUD_MODEL_PREFIX`     | Shared Veryfront Cloud model prefix value.                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L50)  |

### Functions

| Name                                           | Description                                                                                     | Source                                                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `clearModelProviders`                          | Clear all registered model providers and reset lazy built-ins (for testing).                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L446)                |
| `ensureModelReady`                             | Eagerly verify that the resolved model's runtime is available.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L433)                |
| `findVeryfrontCloudModel`                      | Find Veryfront Cloud model.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L297) |
| `findVeryfrontCloudModelByModelId`             | Find Veryfront Cloud model by model ID.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L309) |
| `getCurrentVeryfrontCloudContext`              |                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L31)        |
| `getRegisteredModelProviders`                  | Get provider names available in the current scope.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L421)                |
| `getVeryfrontCloudBootstrap`                   |                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/cloud/resolver.ts#L121)                |
| `getVeryfrontCloudProviderFromModelId`         | Return Veryfront Cloud provider from model ID.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L317) |
| `groupVeryfrontCloudModelsByProvider`          | Group Veryfront Cloud models by provider.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L508) |
| `hasModelProvider`                             | Check whether a model provider is available in the current scope.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L407)                |
| `markCurrentVeryfrontCloudBillingGroupUsed`    |                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L35)        |
| `normalizeVeryfrontCloudModelId`               | Normalizes Veryfront Cloud model ID.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L302) |
| `registerModelProvider`                        | Register a custom model provider factory for the active project scope or application bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L120)                |
| `resolveModel`                                 | Resolve a "provider/model" string to a framework-compatible model runtime.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L348)                |
| `resolveVeryfrontCloudGatewayModelId`          | Resolves Veryfront Cloud gateway model ID.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L368) |
| `resolveVeryfrontCloudModelId`                 | Resolves Veryfront Cloud model ID.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L342) |
| `resolveVeryfrontCloudModelThinking`           | Resolves Veryfront Cloud model thinking.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L394) |
| `resolveVeryfrontCloudReasoningOption`         | Resolves provider-neutral runtime reasoning for a Veryfront Cloud model.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L414) |
| `resolveVeryfrontCloudThinkingProviderOptions` | Options accepted by resolve Veryfront Cloud thinking provider.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L448) |
| `runWithVeryfrontCloudContext`                 | Context for run with Veryfront Cloud.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L16)        |
| `runWithVeryfrontCloudContextAsync`            | Run with Veryfront Cloud context async.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L24)        |
| `tryGetVeryfrontCloudProviderFromModelId`      | Try to get Veryfront Cloud provider from model ID.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L331) |

### Types

| Name                                | Description                                           | Source                                                                                                            |
| ----------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ModelProviderFactory`              | Public API contract for model provider factory.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L34)                |
| `ModelProviderRegistrationDisposer` |                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L35)                |
| `ModelRuntime`                      | Public API contract for model runtime.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L221)                        |
| `VeryfrontCloudBootstrap`           |                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/cloud/resolver.ts#L49)                |
| `VeryfrontCloudChatModel`           | Public API contract for Veryfront Cloud chat model.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L19) |
| `VeryfrontCloudContext`             | Context for Veryfront Cloud.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L4)        |
| `VeryfrontCloudModelThinkingConfig` | Configuration used by Veryfront Cloud model thinking. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L12) |
| `VeryfrontCloudProviderId`          | Public API contract for Veryfront Cloud provider ID.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L4)  |

### Constants

| Name                                 | Description                               | Source                                                                                                             |
| ------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `resolveHostedVeryfrontCloudModelId` | Resolves hosted Veryfront Cloud model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L523) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/provider/openai-reasoning`

```ts
import {
  getDefaultOpenAIReasoningEffort,
  isOpenAIReasoningModel,
  rejectsOpenAISamplingParams,
} from "veryfront/provider/openai-reasoning";
```

#### Functions

| Name                                  | Description | Source                                                                                                       |
| ------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| `getDefaultOpenAIReasoningEffort`     |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/shared/openai-reasoning.ts#L42)  |
| `isOpenAIReasoningModel`              |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/shared/openai-reasoning.ts#L106) |
| `rejectsOpenAISamplingParams`         |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/shared/openai-reasoning.ts#L110) |
| `resolveOpenAIReasoningConfig`        |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/shared/openai-reasoning.ts#L71)  |
| `shouldRequestOpenAIReasoningSummary` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/shared/openai-reasoning.ts#L97)  |
| `supportsDefaultReasoningParams`      |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/shared/openai-reasoning.ts#L16)  |

#### Types

| Name                            | Description | Source                                                                                                     |
| ------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| `OpenAIProviderReasoningEffort` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/shared/openai-reasoning.ts#L5) |
| `OpenAIProviderReasoningOption` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/shared/openai-reasoning.ts#L7) |
| `OpenAIReasoningEffort`         |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/shared/openai-reasoning.ts#L3) |
| `ResolvedOpenAIReasoning`       |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/shared/openai-reasoning.ts#L9) |

### `veryfront/provider/shared`

Shared plumbing consumed by the `@veryfront/ext-*` provider extensions. This barrel is the stable extension-facing surface. Implementations remain internal to `runtime-loader.ts` and `runtime-loader/`; their physical location may change without changing extension imports.

```ts
import {
  buildProviderError,
  createAnthropicRequestInit,
  createGoogleRequestInit,
} from "veryfront/provider/shared";
```

#### Components

| Name                                 | Description                                                       | Source                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `MAX_PROVIDER_SSE_BUFFER_CODE_UNITS` | Maximum decoded provider SSE data retained or parsed in one pass. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-sse.ts#L4)      |
| `TOOL_INPUT_PENDING_THRESHOLD_MS`    | Shared tool input pending threshold ms value.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/tool-input-status.ts#L4) |

#### Functions

| Name                                | Description                                                                                                                                                                                                                                                                                                                                   | Source                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `buildProviderError`                | Inspect a non-2xx response and build the most specific ProviderError subclass we can. Reads the response body as text (it's already dead on the wire by this point). Body classification handles the cases where HTTP status alone is ambiguous - notably OpenAI `insufficient_quota` vs `rate_limit_exceeded` both arriving as 429.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L203)              |
| `createAnthropicRequestInit`        | Create Anthropic request init.                                                                                                                                                                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-request-init.ts#L131)      |
| `createGoogleRequestInit`           | Create Google request init.                                                                                                                                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-request-init.ts#L155)      |
| `createOpenAIRequestInit`           | Create request init options for OpenAI-compatible providers.                                                                                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-request-init.ts#L111)      |
| `createWarningCollector`            | Create warning collector.                                                                                                                                                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L138)                            |
| `getAnthropicMessagesUrl`           | Return Anthropic messages URL.                                                                                                                                                                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L53)          |
| `getGoogleEmbeddingUrl`             | Return Google embedding URL.                                                                                                                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L90)          |
| `getGoogleGenerateContentUrl`       | Return Google generate content URL.                                                                                                                                                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L68)          |
| `getGoogleStreamGenerateContentUrl` | Return Google stream generate content URL.                                                                                                                                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L79)          |
| `getOpenAIChatCompletionsUrl`       | Return OpenAI chat completions URL.                                                                                                                                                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L58)          |
| `getOpenAIEmbeddingUrl`             | Return OpenAI embedding URL.                                                                                                                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L48)          |
| `getOpenAIResponsesUrl`             | Return OpenAI responses URL.                                                                                                                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L63)          |
| `isNumberArray`                     | Check whether a value is an array of numbers.                                                                                                                                                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-embedding-responses.ts#L2) |
| `isProxyWithoutHooks`               | Identify a Proxy without evaluating any trap on the proxied value.                                                                                                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/error-introspection.ts#L322)                |
| `jsonValuesEqual`                   | Compare JSON-compatible values independently of object key order.                                                                                                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/json-snapshot.ts#L711)              |
| `mergeUsage`                        | Merge provider usage counters.                                                                                                                                                                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-usage.ts#L120)             |
| `parseFinalSseChunk`                | Parse the final unterminated SSE block without making the synthetic frame delimiter count against the caller-visible retention boundary.                                                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-sse.ts#L38)                |
| `parseRetryAfterMs`                 | Parses retry after ms.                                                                                                                                                                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L142)              |
| `parseSseChunk`                     | Parse a bounded provider SSE buffer.                                                                                                                                                                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-sse.ts#L27)                |
| `readGatewayBillingMode`            | Read a trusted gateway billing mode from provider metadata.                                                                                                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-usage.ts#L107)                             |
| `readProviderOptions`               | Options accepted by read provider.                                                                                                                                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L338)                            |
| `readRecord`                        | Record shape for read.                                                                                                                                                                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-records.ts#L2)             |
| `readTextParts`                     | Read text content parts from provider messages.                                                                                                                                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L184)                            |
| `requestJson`                       | Request and parse a bounded JSON response.                                                                                                                                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L739)              |
| `requestStream`                     | Request a streaming response. When the request body is replayable, classified rate-limit responses are retried up to two times before provider output is exposed, with all retry waits and attempts bounded by the stream header deadline. ReadableStream request bodies are not retried because fetch can consume them on the first attempt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L817)              |
| `snapshotJsonValue`                 | Create a bounded, deeply owned, accessor-free snapshot of a JSON value.                                                                                                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/json-snapshot.ts#L650)              |
| `snapshotProviderJsonValue`         | Create the provider-boundary snapshot used by request builders.                                                                                                                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/json-snapshot.ts#L675)              |
| `stringifyJsonValue`                | Serialize a JSON-compatible value.                                                                                                                                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L151)                            |
| `stringifyToolArguments`            | Preserve provider-native argument text while serializing structured tool inputs.                                                                                                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L172)                            |
| `stringifyToolResultValue`          | Preserve text tool results while serializing structured tool results.                                                                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L177)                            |
| `toOpenAICompatibleMessages`        | Convert runtime prompt messages into OpenAI-compatible chat messages. Adjacent non-empty system layers become one ordered instruction so strict Chat Completions providers receive a compatible message sequence.                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L236)                            |
| `toOpenAICompatibleTools`           | Convert runtime tool definitions into OpenAI-compatible function tools.                                                                                                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L314)                            |
| `unwrapToolInputSchema`             | Zod schema for unwrap tool input.                                                                                                                                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L374)                            |
| `withToolInputStatusTransitions`    | Applies tool input status transitions.                                                                                                                                                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/tool-input-status.ts#L72)           |

#### Classes

| Name                      | Description                                                                                                                                                                                                                                                                | Source                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ProviderError`           | Base class for typed provider errors. The `retryable` flag is the primary signal for callers (or a retry wrapper) to decide whether to re-issue the request. `retryAfterMs` is set when the provider gave an explicit delay hint (Retry-After header, Retry-Info trailer). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L49) |
| `ProviderOverloadedError` | Provider reports it is overloaded (Anthropic 529, OpenAI/Google 503).                                                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L83) |
| `ProviderQuotaError`      | Provider account quota is exhausted - non-retryable.                                                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L89) |
| `ProviderRateLimitError`  | Provider is rate limiting this API key (OpenAI/Google 429 with Retry-After).                                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L86) |
| `ProviderRequestError`    | Non-retryable 4xx/5xx that doesn't fit another bucket.                                                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L92) |

#### Types

| Name                          | Description                                                                                                                                                                                                                                                                                                        | Source                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `JsonSnapshotOptions`         | Resource limits applied while taking a provider-boundary JSON snapshot.                                                                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/json-snapshot.ts#L91) |
| `JsonSnapshotValue`           | A deeply owned JSON value returned by `snapshotJsonValue`.                                                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/json-snapshot.ts#L82) |
| `ModelRuntimeCallOptions`     | Canonical request contract passed to `ModelRuntime` generation hooks.                                                                                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L178)                       |
| `ModelRuntimePromptMessage`   | Immutable prompt view accepted by model-runtime calls.                                                                                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L119)                       |
| `ModelRuntimeToolDefinition`  | Canonical tool definition sent to a model runtime.                                                                                                                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L144)                       |
| `OpenAICompatibleChatMessage` | Message shape for OpenAI-compatible chat requests.                                                                                                                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L50)               |
| `OpenAICompatibleChatRequest` | Request payload for OpenAI-compatible chat completion providers.                                                                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L87)               |
| `ProviderWarning`             | Structured warning emitted when a provider runtime drops or rewrites a caller-provided option. Mirrors the AI ecosystem convention (Vercel AI SDK, LangChain) of returning `unsupported-setting` warnings on the runtime result so callers can discover silently-dropped fields without having to read the source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L120)              |
| `RuntimeAssistantContentPart` | Canonical assistant content accepted when invoking a model runtime.                                                                                                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L35)                        |
| `RuntimePromptMessage`        | Historical mutable provider-facing prompt contract retained for source compatibility.                                                                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L64)                        |
| `RuntimeReasoningOption`      | Provider-neutral reasoning controls accepted by model runtimes.                                                                                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L137)                       |
| `RuntimeResponseFormat`       | Provider-neutral structured-output request.                                                                                                                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L159)                       |
| `RuntimeUsage`                | Canonical provider-neutral usage reported by text-generation runtimes.                                                                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-usage.ts#L21)                |

#### Constants

| Name                           | Description                                                                                                                                                                                                                | Source                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `canIdentifyProxyWithoutHooks` | Whether this runtime can distinguish Proxy values without evaluating a trap. Callers that need a fail-closed guarantee must not treat a `false` result from `isProxyWithoutHooks` as proof when this capability is absent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/error-introspection.ts#L64) |

### `veryfront/provider/types`

```ts
import type {
  EmbeddingRuntime,
  ModelRuntime,
  ModelRuntimeCallOptions,
} from "veryfront/provider/types";
```

#### Types

| Name                             | Description                                                                           | Source                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `EmbeddingRuntime`               |                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L243) |
| `ModelRuntime`                   | Public API contract for model runtime.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L221) |
| `ModelRuntimeCallOptions`        | Canonical request contract passed to `ModelRuntime` generation hooks.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L178) |
| `ModelRuntimeCapabilities`       | Explicit behavioral support advertised by a model runtime.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L204) |
| `ModelRuntimeGenerateResult`     |                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L123) |
| `ModelRuntimePromptMessage`      | Immutable prompt view accepted by model-runtime calls.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L119) |
| `ModelRuntimeStreamResult`       |                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L131) |
| `ModelRuntimeToolDefinition`     | Canonical tool definition sent to a model runtime.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L144) |
| `RuntimeAssistantContentPart`    | Canonical assistant content accepted when invoking a model runtime.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L35)  |
| `RuntimeMetadata`                |                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L1)   |
| `RuntimePromptMessage`           | Historical mutable provider-facing prompt contract retained for source compatibility. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L64)  |
| `RuntimeReasoningOption`         | Provider-neutral reasoning controls accepted by model runtimes.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L137) |
| `RuntimeResponseFormat`          | Provider-neutral structured-output request.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L159) |
| `RuntimeStructuredOutputVariant` |                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L170) |
