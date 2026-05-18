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

| Name | Description |
|------|-------------|
| `DEFAULT_VERYFRONT_CLOUD_MODEL_ID` |  |
| `VERYFRONT_CLOUD_CHAT_MODELS` |  |
| `VERYFRONT_CLOUD_MODEL_PREFIX` |  |

### Functions

| Name | Description |
|------|-------------|
| `clearModelProviders` | Clear all registered model providers (for testing). |
| `ensureModelReady` | Eagerly verify that the resolved model's runtime is available. |
| `findAvailableCloudModel` | Find the first cloud provider with a valid API key. |
| `findVeryfrontCloudModel` |  |
| `findVeryfrontCloudModelByModelId` |  |
| `getRegisteredModelProviders` | Get list of registered model provider names (project-scoped + shared). |
| `getVeryfrontCloudProviderFromModelId` |  |
| `groupVeryfrontCloudModelsByProvider` |  |
| `hasModelProvider` | Check if a model provider is registered (project-scoped or shared). |
| `normalizeVeryfrontCloudModelId` |  |
| `registerModelProvider` | Register a custom model provider factory for the current project. |
| `resolveModel` | Resolve a "provider/model" string to a framework-compatible model runtime. |
| `resolveVeryfrontCloudGatewayModelId` |  |
| `resolveVeryfrontCloudModelId` |  |
| `resolveVeryfrontCloudModelThinking` |  |
| `resolveVeryfrontCloudThinkingProviderOptions` |  |
| `runWithVeryfrontCloudContext` |  |
| `runWithVeryfrontCloudContextAsync` |  |
| `tryGetVeryfrontCloudProviderFromModelId` |  |

### Types

| Name | Description |
|------|-------------|
| `ModelProviderFactory` | (modelId: string) => LanguageModel |
| `ModelRuntime` |  |
| `VeryfrontCloudChatModel` |  |
| `VeryfrontCloudContext` |  |
| `VeryfrontCloudModelThinkingConfig` |  |
| `VeryfrontCloudProviderId` |  |

### Constants

| Name | Description |
|------|-------------|
| `resolveHostedVeryfrontCloudModelId` |  |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/provider/shared`

Shared plumbing consumed by the `@veryfront/ext-*` provider extensions. This barrel is the stable public surface: implementations currently live in `runtime-loader.ts` and `runtime-loader/` subdirectory. Future PRs (post ext-llm-anthropic / ext-llm-google extraction) may move the implementations into this directory; extensions keep importing from here unchanged.

```ts
import { buildProviderError, createAnthropicRequestInit, createGoogleRequestInit } from "veryfront/provider/shared";
```

#### Components

| Name | Description |
|------|-------------|
| `TOOL_INPUT_PENDING_THRESHOLD_MS` |  |

#### Functions

| Name | Description |
|------|-------------|
| `buildProviderError` | Inspect a non-2xx response and build the most specific ProviderError |
| `createAnthropicRequestInit` |  |
| `createGoogleRequestInit` |  |
| `createOpenAIRequestInit` |  |
| `createWarningCollector` |  |
| `getAnthropicMessagesUrl` |  |
| `getGoogleEmbeddingUrl` |  |
| `getGoogleGenerateContentUrl` |  |
| `getGoogleStreamGenerateContentUrl` |  |
| `getOpenAIChatCompletionsUrl` |  |
| `getOpenAIEmbeddingUrl` |  |
| `getOpenAIResponsesUrl` |  |
| `isNumberArray` |  |
| `mergeUsage` |  |
| `parseRetryAfterMs` |  |
| `parseSseChunk` |  |
| `readProviderOptions` |  |
| `readRecord` |  |
| `readTextParts` |  |
| `requestJson` |  |
| `requestStream` |  |
| `stringifyJsonValue` |  |
| `toOpenAICompatibleMessages` |  |
| `toOpenAICompatibleTools` |  |
| `unwrapToolInputSchema` |  |
| `withToolInputStatusTransitions` |  |

#### Classes

| Name | Description |
|------|-------------|
| `ProviderError` | Base class for typed provider errors. The `retryable` flag is the |
| `ProviderOverloadedError` | Provider reports it is overloaded (Anthropic 529, OpenAI/Google 503). |
| `ProviderQuotaError` | Provider account quota is exhausted — non-retryable. |
| `ProviderRateLimitError` | Provider is rate limiting this API key (OpenAI/Google 429 with Retry-After). |
| `ProviderRequestError` | Non-retryable 4xx/5xx that doesn't fit another bucket. |

#### Types

| Name | Description |
|------|-------------|
| `OpenAICompatibleChatMessage` |  |
| `OpenAICompatibleChatRequest` |  |
| `ProviderWarning` | Structured warning emitted when a provider runtime drops or rewrites a |
| `RuntimePromptMessage` |  |
| `RuntimeUsage` |  |

## Related

Reference modules:

- [`veryfront/agent`](./agent.md): Agents use providers for AI models

User guides:

- [providers](../../guides/providers.md): Register model providers

Architecture:

- [04-provider-runtime](../../architecture/04-provider-runtime.md): Provider runtime architecture
