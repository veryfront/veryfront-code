---
title: "Providers"
description: "Unified LLM interface for OpenAI, Anthropic, and Google."
order: 12
---

Providers are the bridge between your agents and LLM APIs. Veryfront has a unified interface — switch models by changing a string, not rewriting code.

## Setup

Initialize providers with API keys, typically in your app's entry point or a shared module:

```ts
import { initializeProviders } from "veryfront/provider";
import { getEnv } from "veryfront";

initializeProviders({
  openai: { apiKey: getEnv("OPENAI_API_KEY") },
  anthropic: { apiKey: getEnv("ANTHROPIC_API_KEY") },
  google: { apiKey: getEnv("GOOGLE_API_KEY") },
});
```

Only configure the providers you use.

## Model strings

Agents reference models as `"provider/model"`:

```ts
import { agent } from "veryfront/agent";

export default agent({
  model: "openai/gpt-4o",       // OpenAI
  // model: "anthropic/claude-sonnet-4-5-20250929", // Anthropic
  // model: "google/gemini-pro",  // Google
  system: "You are a helpful assistant.",
});
```

The framework resolves the provider from the model string, routes the request to the right API, and normalizes the response.

## Direct provider access

For cases outside the agent system:

```ts
import { getProviderFromModel } from "veryfront/provider";

const { provider, model } = getProviderFromModel("openai/gpt-4o");

const response = await provider.complete({
  model,
  messages: [{ role: "user", content: "Hello" }],
});
```

Or get a provider by name:

```ts
import { getProvider } from "veryfront/provider";

const openai = getProvider("openai");
const response = await openai.complete({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});
```

## Custom base URLs

Point a provider to a compatible API (Azure OpenAI, local models, proxies):

```ts
initializeProviders({
  openai: {
    apiKey: getEnv("AZURE_OPENAI_KEY"),
    baseUrl: "https://my-deployment.openai.azure.com/v1",
  },
});
```

## Provider configuration

### OpenAI

```ts
{
  apiKey: string;
  baseUrl?: string;  // Custom API endpoint
}
```

### Anthropic

```ts
{
  apiKey: string;
  baseUrl?: string;
}
```

### Google

```ts
{
  apiKey: string;
}
```

## Environment variables

The framework auto-detects API keys from standard environment variables if you don't call `initializeProviders()`:

| Variable | Provider |
|----------|----------|
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic |
| `GOOGLE_API_KEY` | Google |

## Next

- [Middleware](./middleware.md) — add CORS, rate limiting, and logging
- [Agents](./agents.md) — agents use providers for AI models

## Related

- [`veryfront/provider`](../reference/provider.md) — provider API reference
