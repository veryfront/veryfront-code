---
title: "Providers"
description: "Provider registry with runtime conventions and explicit overrides."
order: 17
---

An agent's `model` is a `"provider/model"` string.

The provider registry resolves each string to one runtime:

- Veryfront Cloud
- a direct vendor such as OpenAI, Anthropic, or Google
- an OpenAI-compatible service such as OpenRouter
- a local model

Omit `model` in most agents to use `openai/gpt-5.4-nano`.

## Prerequisites

- At least one agent defined under `agents/` (see [Agents](./agents.md)).
- One of the following:
  - A Veryfront Cloud token (`VERYFRONT_API_TOKEN` plus
    `VERYFRONT_PROJECT_SLUG`),
  - An API key for a direct provider (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
    or `GOOGLE_API_KEY`), or
  - A local inference target if you want to run without external providers.

## Runtime conventions (recommended)

For most projects, omit `model` entirely to use `openai/gpt-5.4-nano`. Set
`model: "auto"` only when you want runtime conventions to choose the backend:

```ts
import { agent } from "veryfront/agent";

export default agent({
  system: "You are a helpful assistant.",
});
```

Verify provider resolution through any AG-UI route that uses this agent:

```bash
curl -N http://localhost:3000/api/ag-ui \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Reply with the active inference mode if available."}]}]}'
```

In a client UI, `useChat()` also exposes `inferenceMode` so you can confirm
whether the response used cloud or server-local inference.

For `model: "auto"`, runtime conventions are:

- local development without cloud bootstrap uses explicit provider env vars or
  an explicit `local/*` model
- Veryfront Cloud is selected automatically when `VERYFRONT_API_TOKEN` and
  project context such as `VERYFRONT_PROJECT_SLUG` are available
- `VERYFRONT_DEFAULT_MODEL`, `VERYFRONT_DEFAULT_EMBEDDING_MODEL`, and
  `VERYFRONT_RAG_BACKEND` are escape hatches, not required config

## Set provider environment variables

Set only the variables for the provider you use:

- `OPENAI_API_KEY` for OpenAI.
- `ANTHROPIC_API_KEY` for Anthropic.
- `GOOGLE_API_KEY` for Google.
- `MISTRAL_API_KEY` for direct Mistral requests. Without this key, hosted Mistral models route through Veryfront Cloud when cloud bootstrap is available.
- `OPENAI_BASE_URL` for OpenAI-compatible services.

Explicit provider env vars still work when you want to pin a provider directly:

```ts
import { agent } from "veryfront/agent";

export default agent({
  model: "openai/gpt-5.5", // OpenAI
  // model: "anthropic/claude-sonnet-4-6", // Anthropic
  // model: "google/gemini-3.5-flash",     // Google
  // model: "veryfront-cloud/mistral/mistral-large-2512", // Mistral through AI Gateway
  system: "You are a helpful assistant.",
});
```

## Explicit local AI

Local inference is explicit. Use a `local/*` model when you want the server to
run a curated ONNX model through `@huggingface/transformers`.

```ts
agent({ model: "local/qwen3.5-0.8b" });
// Also available: "local/gemma4-e2b-it", "local/gemma4-e4b-it"
```

The model is downloaded and cached on first use. If the local runtime cannot
load ONNX, the chat handler returns a `503` setup error. The browser never
starts a local model automatically.

Local AI uses CPU by default. To request WebGPU for local inference, use:

```bash
VERYFRONT_LOCAL_AI_DEVICE=webgpu
```

If WebGPU is requested but unavailable, Veryfront returns a setup error instead
of retrying on CPU.

To smoke-test WebGPU local inference in this package, use:

```bash
VERYFRONT_LOCAL_AI_DEVICE=webgpu deno run -A src/provider/local/_smoke-test.ts
```

To smoke-test Gemma4 local inference, use:

```bash
VERYFRONT_LOCAL_AI_MODEL=gemma4-e2b-it deno run -A src/provider/local/_smoke-test.ts
```

To enable Gemma4 thinking in the local prompt template, use:

```bash
VERYFRONT_LOCAL_AI_THINKING=1
```

Thinking is disabled by default. To smoke-test Gemma4 E4B with thinking enabled,
use:

```bash
VERYFRONT_LOCAL_AI_MODEL=gemma4-e4b-it VERYFRONT_LOCAL_AI_THINKING=1 deno run -A src/provider/local/_smoke-test.ts
```

To disable server-side local AI, use:

```bash
VERYFRONT_DISABLE_LOCAL_AI=1
```

## Model strings

Agents reference models as `"provider/model"`. The framework splits on the first `/`, so nested model IDs work:

```ts
// Veryfront Cloud explicit override
agent({ model: "veryfront-cloud/openai/gpt-5.5" });
agent({ model: "veryfront-cloud/mistral/mistral-large-2512" });

// Direct provider override
agent({ model: "openai/gpt-5.5" });

// Nested model ID (e.g. OpenRouter)
agent({ model: "openai/meta-llama/llama-3.1-405b" });
```

## OpenAI-compatible services

Override the base URL to route through OpenRouter, Azure OpenAI, Ollama, or any OpenAI-compatible API:

```bash
OPENAI_API_KEY=<API_KEY>
OPENAI_BASE_URL=https://openrouter.ai/api/v1
```

Both `apiKey` and `baseURL` are resolved per-request, so each project in a multi-tenant setup can have its own configuration.

## Custom provider registration

For providers not covered by env vars, use `registerModelProvider()`:

```ts
import { registerModelProvider } from "veryfront/provider";

registerModelProvider("ollama", (id) => {
  // Return a framework-compatible model runtime for this model ID.
  // Prefer built-in providers when possible; custom registration is an
  // advanced interop surface for non-standard backends. The runtime must
  // implement the framework's generation hooks, including doGenerate()
  // and doStream().
  return createOllamaRuntime(id);
});

// Then use it
agent({ model: "ollama/llama3.2" });
```

The factory receives the model ID and must return a framework-compatible model
runtime with the generation surface the framework expects, including
`doGenerate()` and `doStream()`.

## Direct model resolution

For cases outside the agent system:

```ts
import { resolveModel } from "veryfront/provider";

const model = resolveModel("openai/gpt-5.5");
const cloudModel = resolveModel("veryfront-cloud/openai/gpt-5.5");
```

## Verify it worked

Call your agent's AG-UI route once provider env vars are set:

```bash
curl -N http://localhost:3000/api/ag-ui \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Reply with the active inference mode if available."}]}]}'
```

A token stream that ends without an authentication error means the provider
resolved. In a chat UI, the `inferenceMode` field on `useChat` reports
whether the call used cloud, server-local, or browser inference.
