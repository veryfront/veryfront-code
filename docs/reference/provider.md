---
title: "veryfront/provider"
description: "AI SDK model provider registry with auto-initialization from environment variables."
order: 17
---

# veryfront/provider

AI SDK model provider registry. Maps "provider/model" strings to AI SDK LanguageModel instances.

## Import

```ts
import {
  registerModelProvider,
  resolveModel,
  hasModelProvider,
  getRegisteredModelProviders,
} from "veryfront/provider";
```

## Examples

### Auto-initialized (zero config)

```ts
// Set OPENAI_API_KEY in .env — no code needed
import { agent } from "veryfront/agent";

export default agent({
  model: "openai/gpt-4o",
  system: "You are helpful.",
});
```

### Register a custom provider

```ts
import { registerModelProvider } from "veryfront/provider";
import { createOpenAI } from "@ai-sdk/openai";

registerModelProvider("ollama", (id) =>
  createOpenAI({ apiKey: "ollama", baseURL: "http://localhost:11434/v1" })(id)
);
```

### Resolve a model directly

```ts
import { resolveModel } from "veryfront/provider";

const model = resolveModel("openai/gpt-4o");
```

## API

### `registerModelProvider(name, factory)`

Register a model provider factory for the current project.

**Returns:** `void`

### `resolveModel(modelString)`

Resolve a "provider/model" string to an AI SDK LanguageModel instance.

**Returns:** `LanguageModel`

### `hasModelProvider(name)`

Check if a model provider is registered (project-scoped or shared).

**Returns:** `boolean`

### `getRegisteredModelProviders()`

Get list of registered model provider names.

**Returns:** `string[]`

## Exports

### Functions

| Name | Description |
|------|-------------|
| `registerModelProvider` | Register a model provider factory |
| `resolveModel` | Resolve "provider/model" to LanguageModel |
| `hasModelProvider` | Check if provider is registered |
| `getRegisteredModelProviders` | List registered provider names |
| `clearModelProviders` | Clear all providers (for testing) |

### Types

| Name | Description |
|------|-------------|
| `ModelProviderFactory` | `(modelId: string) => LanguageModel` |

## Related

- [`veryfront/agent`](./agent.md) — Agents use providers for AI models
