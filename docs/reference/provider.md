---
title: "veryfront/provider"
description: "AI SDK model provider registry. Maps \"provider/model\" strings to AI SDK LanguageModel instances. Auto-initializes providers from environment variables on first use."
order: 17
---

# veryfront/provider

AI SDK model provider registry. Maps "provider/model" strings to AI SDK `LanguageModel` instances.

Most apps do not need this directly. Omit `model` on `agent()` to follow
runtime defaults, or use `resolveModel()` and `registerModelProvider()` when
you need an explicit provider path.

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

### Register and resolve a model

```ts
import { registerModelProvider, resolveModel } from "veryfront/provider";
import { createOpenAI } from "@ai-sdk/openai";

registerModelProvider("openai", (id) => createOpenAI({ apiKey })(id));
const model = resolveModel("veryfront-cloud/openai/gpt-5.2");
```

## API

### `registerModelProvider(name, factory)`

Register an AI SDK model provider factory for the current project.

**Returns:** `void`

### `resolveModel(modelString)`

Resolve a "provider/model" string to an AI SDK LanguageModel instance.

**Returns:** `LanguageModel`

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

### Functions

| Name | Description |
|------|-------------|
| `clearModelProviders` | Clear all registered model providers (for testing). |
| `ensureModelReady` | Eagerly verify that the resolved model's runtime is available. |
| `getRegisteredModelProviders` | Get list of registered model provider names (project-scoped + shared). |
| `hasModelProvider` | Check if a model provider is registered (project-scoped or shared). |
| `registerModelProvider` | Register an AI SDK model provider factory for the current project. |
| `resolveModel` | Resolve a "provider/model" string to an AI SDK LanguageModel instance. |

### Types

| Name | Description |
|------|-------------|
| `ModelProviderFactory` | (modelId: string) => LanguageModel |

## Related

- [`veryfront/agent`](./agent.md) — Agents use providers for AI models
