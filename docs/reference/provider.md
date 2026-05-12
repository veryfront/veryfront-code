---
title: "veryfront/provider"
description: "Provider registry for resolving \"provider/model\" strings to local, Veryfront Cloud, and direct provider runtimes."
order: 17
---

# veryfront/provider

Provider registry. Maps "provider/model" strings to local, Veryfront Cloud, and direct provider runtimes.

Most apps do not need this directly. Omit `model` on `agent()` to follow
runtime defaults, or use `resolveModel()` and `registerModelProvider()` when
you need an explicit provider path.

Use `agent({ resolveModelTransport })` when the missing piece is
request-aware transport behavior such as per-request headers or provider
options. `registerModelProvider()` is still the right tool for static model
runtime registration.

## Import

```ts
import {
  clearModelProviders,
  ensureModelReady,
  getRegisteredModelProviders,
  groupVeryfrontCloudModelsByProvider,
  hasModelProvider,
  registerModelProvider,
  resolveHostedVeryfrontCloudModelId,
  resolveModel,
  resolveVeryfrontCloudGatewayModelId,
  resolveVeryfrontCloudModelId,
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

This is an advanced interop hook. Prefer built-in providers and `resolveModel()`
unless you need to bridge a custom model runtime. Custom runtimes must expose
the framework generation surface, including `doGenerate()` and `doStream()`.

**Returns:** `void`

### `resolveModel(modelString)`

Resolve a "provider/model" string to a framework-compatible model runtime.

**Returns:** model runtime object

### `hasModelProvider(name)`

Check if a model provider is registered (project-scoped or shared).

**Returns:** `boolean`

### `getRegisteredModelProviders()`

Get list of registered model provider names (project-scoped + shared).

**Returns:** `string[]`

### `clearModelProviders()`

Clear all registered model providers (for testing).

**Returns:** `void`

### Veryfront Cloud model catalog

Use the Veryfront Cloud model catalog when an agent service needs stable aliases, provider grouping, gateway model normalization, or Anthropic thinking provider options.

```ts
import {
  groupVeryfrontCloudModelsByProvider,
  resolveHostedVeryfrontCloudModelId,
  resolveVeryfrontCloudGatewayModelId,
  resolveVeryfrontCloudModelId,
} from "veryfront/provider";

const modelId = resolveVeryfrontCloudModelId("opus");
const gatewayModelId = resolveVeryfrontCloudGatewayModelId(modelId);
const groupedModels = groupVeryfrontCloudModelsByProvider();
```

## Exports

### Functions

| Name                                           | Description                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| `clearModelProviders`                          | Clear all registered model providers (for testing).                        |
| `ensureModelReady`                             | Eagerly verify that the resolved model's runtime is available.             |
| `findVeryfrontCloudModel`                      | Find a hosted catalog model by alias.                                      |
| `findVeryfrontCloudModelByModelId`             | Find a hosted catalog model by direct or hosted model ID.                  |
| `getRegisteredModelProviders`                  | Get list of registered model provider names (project-scoped + shared).     |
| `getVeryfrontCloudProviderFromModelId`         | Resolve the hosted language provider for a direct or hosted model ID.      |
| `groupVeryfrontCloudModelsByProvider`          | Group hosted catalog models by provider in display order.                  |
| `hasModelProvider`                             | Check if a model provider is registered (project-scoped or shared).        |
| `normalizeVeryfrontCloudModelId`               | Remove the `veryfront-cloud/` prefix from a hosted model ID.               |
| `registerModelProvider`                        | Register a custom model provider factory for the current project.          |
| `resolveVeryfrontCloudGatewayModelId`          | Prefix direct provider model IDs for the Veryfront Cloud gateway.          |
| `resolveHostedVeryfrontCloudModelId`           | Compatibility alias for `resolveVeryfrontCloudGatewayModelId()`.           |
| `resolveModel`                                 | Resolve a "provider/model" string to a framework-compatible model runtime. |
| `resolveVeryfrontCloudModelId`                 | Resolve a hosted catalog alias to a direct provider model ID.              |
| `resolveVeryfrontCloudModelThinking`           | Resolve default thinking configuration for a hosted catalog model.         |
| `resolveVeryfrontCloudThinkingProviderOptions` | Resolve Anthropic provider options for hosted thinking configuration.      |
| `tryGetVeryfrontCloudProviderFromModelId`      | Resolve a hosted language provider without throwing on unknown prefixes.   |

### Constants

| Name                               | Description                                  |
| ---------------------------------- | -------------------------------------------- |
| `DEFAULT_VERYFRONT_CLOUD_MODEL_ID` | Default hosted catalog alias.                |
| `VERYFRONT_CLOUD_CHAT_MODELS`      | Hosted language model catalog.               |
| `VERYFRONT_CLOUD_MODEL_PREFIX`     | Prefix for hosted Veryfront Cloud model IDs. |

### Types

| Name                                | Description                          |
| ----------------------------------- | ------------------------------------ |
| `ModelProviderFactory`              | `(modelId: string) => model runtime` |
| `VeryfrontCloudChatModel`           | Hosted language model catalog entry. |
| `VeryfrontCloudModelThinkingConfig` | Hosted model thinking configuration. |
| `VeryfrontCloudProviderId`          | Hosted language provider identifier. |

## Related

- [`veryfront/agent`](./agent.md) — Agents use providers for AI models
