---
title: "veryfront/provider"
description: "Model provider registry and runtime resolution."
order: 24
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
| `DEFAULT_VERYFRONT_CLOUD_MODEL_ID` | Default Veryfront Cloud model ID used when no model is configured. Update this when the current default is deprecated - otherwise the default path silently breaks for users who have not set an explicit model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L47)  |
| `VERYFRONT_CLOUD_CHAT_MODELS`      | Shared Veryfront Cloud chat models value.                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L264) |
| `VERYFRONT_CLOUD_MODEL_PREFIX`     | Shared Veryfront Cloud model prefix value.                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L49)  |

### Functions

| Name                                           | Description                                                                                     | Source                                                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `clearModelProviders`                          | Clear all registered model providers and reset lazy built-ins (for testing).                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L445)                |
| `ensureModelReady`                             | Eagerly verify that the resolved model's runtime is available.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L432)                |
| `findVeryfrontCloudModel`                      | Find Veryfront Cloud model.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L296) |
| `findVeryfrontCloudModelByModelId`             | Find Veryfront Cloud model by model ID.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L308) |
| `getCurrentVeryfrontCloudContext`              |                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L30)        |
| `getRegisteredModelProviders`                  | Get provider names available in the current scope.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L420)                |
| `getVeryfrontCloudBootstrap`                   |                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/cloud/resolver.ts#L120)                |
| `getVeryfrontCloudProviderFromModelId`         | Return Veryfront Cloud provider from model ID.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L316) |
| `groupVeryfrontCloudModelsByProvider`          | Group Veryfront Cloud models by provider.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L507) |
| `hasModelProvider`                             | Check whether a model provider is available in the current scope.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L406)                |
| `markCurrentVeryfrontCloudBillingGroupUsed`    |                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L34)        |
| `normalizeVeryfrontCloudModelId`               | Normalizes Veryfront Cloud model ID.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L301) |
| `registerModelProvider`                        | Register a custom model provider factory for the active project scope or application bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L119)                |
| `resolveModel`                                 | Resolve a "provider/model" string to a framework-compatible model runtime.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L347)                |
| `resolveVeryfrontCloudGatewayModelId`          | Resolves Veryfront Cloud gateway model ID.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L367) |
| `resolveVeryfrontCloudModelId`                 | Resolves Veryfront Cloud model ID.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L341) |
| `resolveVeryfrontCloudModelThinking`           | Resolves Veryfront Cloud model thinking.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L393) |
| `resolveVeryfrontCloudReasoningOption`         | Resolves provider-neutral runtime reasoning for a Veryfront Cloud model.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L413) |
| `resolveVeryfrontCloudThinkingProviderOptions` | Options accepted by resolve Veryfront Cloud thinking provider.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L447) |
| `runWithVeryfrontCloudContext`                 | Context for run with Veryfront Cloud.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L15)        |
| `runWithVeryfrontCloudContextAsync`            | Run with Veryfront Cloud context async.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L23)        |
| `tryGetVeryfrontCloudProviderFromModelId`      | Try to get Veryfront Cloud provider from model ID.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L330) |

### Types

| Name                                | Description                                           | Source                                                                                                            |
| ----------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ModelProviderFactory`              | Public API contract for model provider factory.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L33)                |
| `ModelProviderRegistrationDisposer` |                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/model-registry.ts#L34)                |
| `ModelRuntime`                      | Public API contract for model runtime.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L212)                        |
| `VeryfrontCloudBootstrap`           |                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/cloud/resolver.ts#L48)                |
| `VeryfrontCloudChatModel`           | Public API contract for Veryfront Cloud chat model.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L18) |
| `VeryfrontCloudContext`             | Context for Veryfront Cloud.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/context.ts#L3)        |
| `VeryfrontCloudModelThinkingConfig` | Configuration used by Veryfront Cloud model thinking. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L11) |
| `VeryfrontCloudProviderId`          | Public API contract for Veryfront Cloud provider ID.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L3)  |

### Constants

| Name                                 | Description                               | Source                                                                                                             |
| ------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `resolveHostedVeryfrontCloudModelId` | Resolves hosted Veryfront Cloud model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/veryfront-cloud/model-catalog.ts#L522) |

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
| `getDefaultOpenAIReasoningEffort`     |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/shared/openai-reasoning.ts#L41)  |
| `isOpenAIReasoningModel`              |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/shared/openai-reasoning.ts#L105) |
| `rejectsOpenAISamplingParams`         |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/shared/openai-reasoning.ts#L109) |
| `resolveOpenAIReasoningConfig`        |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/shared/openai-reasoning.ts#L70)  |
| `shouldRequestOpenAIReasoningSummary` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/shared/openai-reasoning.ts#L96)  |
| `supportsDefaultReasoningParams`      |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/shared/openai-reasoning.ts#L15)  |

#### Types

| Name                            | Description | Source                                                                                                     |
| ------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| `OpenAIProviderReasoningEffort` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/shared/openai-reasoning.ts#L4) |
| `OpenAIProviderReasoningOption` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/shared/openai-reasoning.ts#L6) |
| `OpenAIReasoningEffort`         |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/shared/openai-reasoning.ts#L2) |
| `ResolvedOpenAIReasoning`       |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/shared/openai-reasoning.ts#L8) |

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
| `MAX_PROVIDER_SSE_BUFFER_CODE_UNITS` | Maximum decoded provider SSE data retained or parsed in one pass. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-sse.ts#L3)      |
| `TOOL_INPUT_PENDING_THRESHOLD_MS`    | Shared tool input pending threshold ms value.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/tool-input-status.ts#L3) |

#### Functions

| Name                                | Description                                                                                                                                                                                                                                                                                                                                   | Source                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `buildProviderError`                | Inspect a non-2xx response and build the most specific ProviderError subclass we can. Reads the response body as text (it's already dead on the wire by this point). Body classification handles the cases where HTTP status alone is ambiguous - notably OpenAI `insufficient_quota` vs `rate_limit_exceeded` both arriving as 429.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L168)              |
| `createAnthropicRequestInit`        | Create Anthropic request init.                                                                                                                                                                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-request-init.ts#L130)      |
| `createGoogleRequestInit`           | Create Google request init.                                                                                                                                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-request-init.ts#L154)      |
| `createOpenAIRequestInit`           | Create request init options for OpenAI-compatible providers.                                                                                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-request-init.ts#L110)      |
| `createWarningCollector`            | Create warning collector.                                                                                                                                                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L137)                            |
| `getAnthropicMessagesUrl`           | Return Anthropic messages URL.                                                                                                                                                                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L52)          |
| `getGoogleEmbeddingUrl`             | Return Google embedding URL.                                                                                                                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L89)          |
| `getGoogleGenerateContentUrl`       | Return Google generate content URL.                                                                                                                                                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L67)          |
| `getGoogleStreamGenerateContentUrl` | Return Google stream generate content URL.                                                                                                                                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L78)          |
| `getOpenAIChatCompletionsUrl`       | Return OpenAI chat completions URL.                                                                                                                                                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L57)          |
| `getOpenAIEmbeddingUrl`             | Return OpenAI embedding URL.                                                                                                                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L47)          |
| `getOpenAIResponsesUrl`             | Return OpenAI responses URL.                                                                                                                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-endpoints.ts#L62)          |
| `isNumberArray`                     | Check whether a value is an array of numbers.                                                                                                                                                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-embedding-responses.ts#L1) |
| `isProxyWithoutHooks`               | Identify a Proxy without evaluating any trap on the proxied value.                                                                                                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/error-introspection.ts#L321)                |
| `jsonValuesEqual`                   | Compare JSON-compatible values independently of object key order.                                                                                                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/json-snapshot.ts#L710)              |
| `mergeUsage`                        | Merge provider usage counters.                                                                                                                                                                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-usage.ts#L119)             |
| `parseFinalSseChunk`                | Parse the final unterminated SSE block without making the synthetic frame delimiter count against the caller-visible retention boundary.                                                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-sse.ts#L37)                |
| `parseRetryAfterMs`                 | Parses retry after ms.                                                                                                                                                                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L107)              |
| `parseSseChunk`                     | Parse a bounded provider SSE buffer.                                                                                                                                                                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-sse.ts#L26)                |
| `readGatewayBillingMode`            | Read a trusted gateway billing mode from provider metadata.                                                                                                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-usage.ts#L106)                             |
| `readProviderOptions`               | Options accepted by read provider.                                                                                                                                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L324)                            |
| `readRecord`                        | Record shape for read.                                                                                                                                                                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-records.ts#L1)             |
| `readTextParts`                     | Read text content parts from provider messages.                                                                                                                                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L183)                            |
| `requestJson`                       | Request and parse a bounded JSON response.                                                                                                                                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L689)              |
| `requestStream`                     | Request a streaming response. When the request body is replayable, classified rate-limit responses are retried up to two times before provider output is exposed, with all retry waits and attempts bounded by the stream header deadline. ReadableStream request bodies are not retried because fetch can consume them on the first attempt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L763)              |
| `snapshotJsonValue`                 | Create a bounded, deeply owned, accessor-free snapshot of a JSON value.                                                                                                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/json-snapshot.ts#L649)              |
| `snapshotProviderJsonValue`         | Create the provider-boundary snapshot used by request builders.                                                                                                                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/json-snapshot.ts#L674)              |
| `stringifyJsonValue`                | Serialize a JSON-compatible value.                                                                                                                                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L150)                            |
| `stringifyToolArguments`            | Preserve provider-native argument text while serializing structured tool inputs.                                                                                                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L171)                            |
| `stringifyToolResultValue`          | Preserve text tool results while serializing structured tool results.                                                                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L176)                            |
| `toOpenAICompatibleMessages`        | Convert runtime prompt messages into OpenAI-compatible chat messages.                                                                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L231)                            |
| `toOpenAICompatibleTools`           | Convert runtime tool definitions into OpenAI-compatible function tools.                                                                                                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L300)                            |
| `unwrapToolInputSchema`             | Zod schema for unwrap tool input.                                                                                                                                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L360)                            |
| `withToolInputStatusTransitions`    | Applies tool input status transitions.                                                                                                                                                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/tool-input-status.ts#L71)           |

#### Classes

| Name                      | Description                                                                                                                                                                                                                                                                | Source                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ProviderError`           | Base class for typed provider errors. The `retryable` flag is the primary signal for callers (or a retry wrapper) to decide whether to re-issue the request. `retryAfterMs` is set when the provider gave an explicit delay hint (Retry-After header, Retry-Info trailer). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L48) |
| `ProviderOverloadedError` | Provider reports it is overloaded (Anthropic 529, OpenAI/Google 503).                                                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L82) |
| `ProviderQuotaError`      | Provider account quota is exhausted - non-retryable.                                                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L88) |
| `ProviderRateLimitError`  | Provider is rate limiting this API key (OpenAI/Google 429 with Retry-After).                                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L85) |
| `ProviderRequestError`    | Non-retryable 4xx/5xx that doesn't fit another bucket.                                                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/provider-http.ts#L91) |

#### Types

| Name                          | Description                                                                                                                                                                                                                                                                                                        | Source                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `JsonSnapshotOptions`         | Resource limits applied while taking a provider-boundary JSON snapshot.                                                                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/json-snapshot.ts#L90) |
| `JsonSnapshotValue`           | A deeply owned JSON value returned by `snapshotJsonValue`.                                                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader/json-snapshot.ts#L81) |
| `ModelRuntimeCallOptions`     | Canonical request contract passed to `ModelRuntime` generation hooks.                                                                                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L175)                       |
| `ModelRuntimePromptMessage`   | Immutable prompt view accepted by model-runtime calls.                                                                                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L118)                       |
| `ModelRuntimeToolDefinition`  | Canonical tool definition sent to a model runtime.                                                                                                                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L143)                       |
| `OpenAICompatibleChatMessage` | Message shape for OpenAI-compatible chat requests.                                                                                                                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L49)               |
| `OpenAICompatibleChatRequest` | Request payload for OpenAI-compatible chat completion providers.                                                                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L86)               |
| `ProviderWarning`             | Structured warning emitted when a provider runtime drops or rewrites a caller-provided option. Mirrors the AI ecosystem convention (Vercel AI SDK, LangChain) of returning `unsupported-setting` warnings on the runtime result so callers can discover silently-dropped fields without having to read the source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-loader.ts#L119)              |
| `RuntimeAssistantContentPart` | Canonical assistant content accepted when invoking a model runtime.                                                                                                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L34)                        |
| `RuntimePromptMessage`        | Historical mutable provider-facing prompt contract retained for source compatibility.                                                                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L63)                        |
| `RuntimeReasoningOption`      | Provider-neutral reasoning controls accepted by model runtimes.                                                                                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L136)                       |
| `RuntimeResponseFormat`       | Provider-neutral structured-output request.                                                                                                                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L158)                       |
| `RuntimeUsage`                | Canonical provider-neutral usage reported by text-generation runtimes.                                                                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/runtime-usage.ts#L20)                |

#### Constants

| Name                           | Description                                                                                                                                                                                                                | Source                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `canIdentifyProxyWithoutHooks` | Whether this runtime can distinguish Proxy values without evaluating a trap. Callers that need a fail-closed guarantee must not treat a `false` result from `isProxyWithoutHooks` as proof when this capability is absent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/error-introspection.ts#L63) |

### `veryfront/provider/types`

```ts
import type {
  EmbeddingRuntime,
  ModelRuntime,
  ModelRuntimeCallOptions,
} from "veryfront/provider/types";
```

#### Types

| Name                          | Description                                                                           | Source                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `EmbeddingRuntime`            |                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L234) |
| `ModelRuntime`                | Public API contract for model runtime.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L212) |
| `ModelRuntimeCallOptions`     | Canonical request contract passed to `ModelRuntime` generation hooks.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L175) |
| `ModelRuntimeCapabilities`    | Explicit behavioral support advertised by a model runtime.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L201) |
| `ModelRuntimeGenerateResult`  |                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L122) |
| `ModelRuntimePromptMessage`   | Immutable prompt view accepted by model-runtime calls.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L118) |
| `ModelRuntimeStreamResult`    |                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L130) |
| `ModelRuntimeToolDefinition`  | Canonical tool definition sent to a model runtime.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L143) |
| `RuntimeAssistantContentPart` | Canonical assistant content accepted when invoking a model runtime.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L34)  |
| `RuntimeMetadata`             |                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts)      |
| `RuntimePromptMessage`        | Historical mutable provider-facing prompt contract retained for source compatibility. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L63)  |
| `RuntimeReasoningOption`      | Provider-neutral reasoning controls accepted by model runtimes.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L136) |
| `RuntimeResponseFormat`       | Provider-neutral structured-output request.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/provider/types.ts#L158) |
