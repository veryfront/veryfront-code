---
title: "Providers"
description: "AI SDK model provider registry with auto-initialization from environment variables."
order: 12
---

# Providers

AI SDK model provider registry. Maps "provider/model" strings to AI SDK LanguageModel instances.

## Environment variables (recommended)

Providers are auto-initialized from standard environment variables on first use:

| Variable | Provider |
|----------|----------|
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic |
| `GOOGLE_API_KEY` | Google |
| `OPENAI_BASE_URL` | Custom OpenAI-compatible endpoint |

No setup code is needed — just set env vars and use `agent()`:

```ts
import { agent } from "veryfront/agent";

export default agent({
  model: "openai/gpt-4o",       // OpenAI
  // model: "anthropic/claude-sonnet-4-20250514", // Anthropic
  // model: "google/gemini-2.0-flash",  // Google
  system: "You are a helpful assistant.",
});
```

## Zero-config local AI

Chat works **out of the box with no API keys**. When no cloud provider key is set, the framework automatically falls back through a three-tier inference chain:

```
Cloud provider (API key set)
    ↓ fallback (no key)
Server-local (SmolLM2-135M via ONNX Runtime)
    ↓ fallback (ONNX unavailable, e.g. compiled binary)
Browser Worker (transformers.js from CDN)
```

- **Server-local** — runs SmolLM2-135M with `@huggingface/transformers` and ONNX Runtime. The model is downloaded and cached on first use (~100MB).
- **Browser fallback** — when the server can't load ONNX (e.g. compiled binaries), the chat handler returns a `503` with `NO_AI_AVAILABLE`. The `useChat` hook detects this and loads the same model in a Web Worker via CDN.

The fallback is transparent — `useChat` exposes `inferenceMode` (`"cloud"`, `"server-local"`, or `"browser"`) so your UI can adapt.

To explicitly use a local model:

```ts
agent({ model: "local/smollm2-135m" })
// Also available: "local/smollm2-360m", "local/smollm2-1.7b"
```

To disable local AI (e.g. in tests or to force cloud-only):

```bash
VERYFRONT_DISABLE_LOCAL_AI=1
```

## Model strings

Agents reference models as `"provider/model"`. The framework splits on the first `/`, so nested model IDs work:

```ts
// Standard
agent({ model: "openai/gpt-4o" })

// Nested model ID (e.g. OpenRouter)
agent({ model: "openai/meta-llama/llama-3.1-405b" })
```

## OpenAI-compatible services

Override the base URL to route through OpenRouter, Azure OpenAI, Ollama, or any OpenAI-compatible API:

```bash
OPENAI_API_KEY=sk-or-v1-...
OPENAI_BASE_URL=https://openrouter.ai/api/v1
```

Both `apiKey` and `baseURL` are resolved per-request, so each project in a multi-tenant setup can have its own configuration.

## Custom provider registration

For providers not covered by env vars, use `registerModelProvider()`:

```ts
import { registerModelProvider } from "veryfront/provider";
import { createOpenAI } from "@ai-sdk/openai";

registerModelProvider("ollama", (id) =>
  createOpenAI({
    apiKey: "ollama",
    baseURL: "http://localhost:11434/v1",
  })(id)
);

// Then use it
agent({ model: "ollama/llama3.2" });
```

The factory receives the model ID and must return an AI SDK `LanguageModel` instance.

## Direct model resolution

For cases outside the agent system:

```ts
import { resolveModel } from "veryfront/provider";

const model = resolveModel("openai/gpt-4o");
```

## Next

- [Middleware](./middleware.md) — add CORS, rate limiting, and logging
- [Agents](./agents.md) — agents use providers for AI models

## Related

- [`veryfront/provider`](../reference/provider.md) — provider API reference
