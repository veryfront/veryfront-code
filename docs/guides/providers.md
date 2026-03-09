---
title: "Providers"
description: "AI SDK model provider registry with runtime conventions and explicit overrides."
order: 12
---

# Providers

AI SDK model provider registry. Maps "provider/model" strings to AI SDK `LanguageModel` instances.

## Runtime conventions (recommended)

For most projects, omit `model` entirely and let runtime defaults choose the
right backend:

```ts
import { agent } from "veryfront/agent";

export default agent({
  system: "You are a helpful assistant.",
});
```

By convention:

- local development without cloud bootstrap uses local inference or explicit
  provider env vars
- Veryfront Cloud is selected automatically when `VERYFRONT_API_TOKEN` and
  project context such as `VERYFRONT_PROJECT_SLUG` are available
- `VERYFRONT_DEFAULT_MODEL`, `VERYFRONT_DEFAULT_EMBEDDING_MODEL`, and
  `VERYFRONT_RAG_BACKEND` are escape hatches, not required config

## Explicit provider environment variables

| Variable | Provider |
|----------|----------|
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic |
| `GOOGLE_API_KEY` | Google |
| `OPENAI_BASE_URL` | Custom OpenAI-compatible endpoint |

Explicit provider env vars still work when you want to pin a provider directly:

```ts
import { agent } from "veryfront/agent";

export default agent({
  model: "openai/gpt-5.2",       // OpenAI
  // model: "anthropic/claude-sonnet-4-6", // Anthropic
  // model: "google/gemini-2.5-flash",     // Google
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

To disable server-side local AI (e.g. in tests):

```bash
VERYFRONT_DISABLE_LOCAL_AI=1
```

## Model strings

Agents reference models as `"provider/model"`. The framework splits on the first `/`, so nested model IDs work:

```ts
// Veryfront Cloud explicit override
agent({ model: "veryfront-cloud/openai/gpt-5.2" })

// Direct provider override
agent({ model: "openai/gpt-5.2" })

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

const model = resolveModel("openai/gpt-5.2");
const cloudModel = resolveModel("veryfront-cloud/openai/gpt-5.2");
```

## Next

- [Middleware](./middleware.md) — add CORS, rate limiting, and logging
- [Agents](./agents.md) — agents use providers for AI models

## Related

- [`veryfront/provider`](../reference/provider.md) — provider API reference
