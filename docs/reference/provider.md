---
title: "veryfront/provider"
description: "Unified LLM interface for Anthropic, Google, and OpenAI."
order: 17
---

# veryfront/provider

Unified LLM interface for Anthropic, Google, and OpenAI.

## Import

```ts
import {
  initializeProviders,
  getProvider,
  getProviderFromModel,
  OpenAIProvider,
  AnthropicProvider,
  BaseProvider,
} from "veryfront/provider";
```

## Examples

### Initialize providers

```ts
import { initializeProviders } from "veryfront/provider";

initializeProviders({
  openai: { apiKey: getEnv("OPENAI_API_KEY") },
});
```

### Route to model

```ts
import { initializeProviders, getProviderFromModel } from "veryfront/provider";

initializeProviders({
  openai: { apiKey: getEnv("OPENAI_API_KEY") },
  anthropic: { apiKey: getEnv("ANTHROPIC_API_KEY") },
});

const { provider, model } = getProviderFromModel("openai/gpt-4o");
const response = await provider.complete({
  model,
  messages: [{ role: "user", content: "Hello" }],
});
```

## API

### `initializeProviders(config)`

Set up providers with API keys

**Returns:** `void`

## Exports

### Functions

| Name | Description |
|------|-------------|
| `getProvider` | Get provider by name |
| `getProviderFromModel` | Resolve `provider/model` string |
| `initializeProviders` | Set up providers with API keys |

### Classes

| Name | Description |
|------|-------------|
| `AnthropicProvider` | Anthropic implementation |
| `BaseProvider` | Abstract provider base class |
| `GoogleProvider` | Google AI implementation |
| `OpenAIProvider` | OpenAI implementation |

### Types

| Name | Description |
|------|-------------|
| `AnthropicConfig` | Anthropic config |
| `CompletionRequest` | Normalized completion request |
| `CompletionResponse` | Normalized completion response |
| `GoogleConfig` | Google AI config |
| `OpenAIConfig` | OpenAI config |
| `Provider` | Provider interface |
| `ProviderConfig` | Single provider config |
| `ProvidersConfig` | All providers config map |

## Related

- [`veryfront/agent`](./agent.md) — Agents use providers for AI models
