---
title: "Providers"
description: "Choose and configure model inference for a Veryfront project."
order: 17
---

Every agent needs one inference path. Choose it independently from where the app
is developed or deployed.

| Goal                              | Inference path             | Start here                                                 |
| --------------------------------- | -------------------------- | ---------------------------------------------------------- |
| Use managed model access          | Veryfront Cloud AI Gateway | [Cloud quickstart](../getting-started/cloud-quickstart.md) |
| Call a model vendor with your key | Direct provider            | [Direct providers](#direct-providers)                      |
| Use an OpenAI-compatible endpoint | Compatible service         | [OpenAI-compatible services](#openai-compatible-services)  |
| Run inference on the app server   | Built-in local AI          | [Explicit local AI](#explicit-local-ai)                    |

An agent's `model` is a `"provider/model"` string. Omit it to use the default
`openai/gpt-5.4-nano` model with the inference credentials available at runtime.

## Prerequisites

- At least one agent defined under `agents/` (see [Agents](./agents.md)).
- One configured inference path from the table above.

## Veryfront Cloud AI Gateway

The AI Gateway provides managed model access without a model-vendor API key.
Run `veryfront login`, then Push the project once to create its local project
link. `veryfront dev` and `veryfront eval` load the stored login and linked
project automatically.

Model selection follows these rules:

| Agent model                            | With Cloud context                                  | With a matching direct provider key                      |
| -------------------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| Omitted                                | Routes the default model through the AI Gateway     | Uses the direct provider                                 |
| `"auto"`                               | Prefers the AI Gateway                              | Uses the AI Gateway when Cloud context is also available |
| `"veryfront-cloud/<provider>/<model>"` | Uses the AI Gateway                                 | Uses the AI Gateway                                      |
| `"<provider>/<model>"`                 | Uses the AI Gateway when no direct key is available | Uses the direct provider                                 |

Use an explicit gateway model when the route must never switch to a direct
provider:

```ts
import { agent } from "veryfront/agent";

export default agent({
  model: "veryfront-cloud/openai/gpt-5.5",
  system: "You are a helpful assistant.",
});
```

With `model: "auto"`, `VERYFRONT_DEFAULT_MODEL` can select another gateway
default. It is optional.

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

The runtime resolves `model: "auto"` from Cloud context or direct provider
credentials. `VERYFRONT_DEFAULT_MODEL`, `VERYFRONT_DEFAULT_EMBEDDING_MODEL`, and
`VERYFRONT_RAG_BACKEND` are optional overrides.

## Direct providers

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

## Enable OpenAI-hosted web search

Declare `web_search` in the agent's provider tools. Veryfront routes the call
through OpenAI's Responses API, including for models that otherwise use Chat
Completions:

```ts
import { agent } from "veryfront/agent";

export default agent({
  model: "openai/gpt-4.1",
  providerTools: ["web_search"],
});
```

This tool requires an OpenAI endpoint that implements the Responses and hosted
web-search contracts. See the
[`ext-llm-openai` reference](https://github.com/veryfront/veryfront-code/blob/main/extensions/ext-llm-openai/README.md#hosted-web-search)
for supported identifiers, arguments, and replay limits.

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

Override the base URL to route through an OpenAI-compatible API. Public HTTPS
services such as OpenRouter work without changing the host network policy:

```bash
OPENAI_API_KEY=<API_KEY>
OPENAI_BASE_URL=https://openrouter.ai/api/v1
```

Both `apiKey` and `baseURL` are resolved per-request, so each project in a multi-tenant setup can have its own configuration.

Local OpenAI-compatible servers need an explicit host-network opt-in. Veryfront
blocks loopback and private destinations by default to prevent server-side
request forgery. Set `VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS` to the
exact provider origins that Veryfront can reach. Include the scheme, host, and
port, but do not include `/v1` or another path. Other internal destinations
remain blocked. Only the runtime operator can set this policy. A project
environment cannot grant itself access.

### Ollama

Start Ollama and download a model. This example uses a model with tool-use
support:

```bash
ollama pull qwen3:1.7b
```

Set the OpenAI-compatible endpoint in the terminal that starts Veryfront:

```bash
export OPENAI_API_KEY="<TOKEN>"
export OPENAI_BASE_URL="http://localhost:11434/v1"
export VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS="http://localhost:11434"
```

Use the Ollama model ID under the `openai` provider:

```ts
agent({ model: "openai/qwen3:1.7b" });
```

Ollama ignores the token by default, but Veryfront requires a non-empty value
for `OPENAI_API_KEY`. See
[Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility).

### LM Studio

Load a model in LM Studio, start its local server on port 1234, then list the
model IDs it exposes:

```bash
lms server start --port 1234
curl http://localhost:1234/v1/models
```

Set the endpoint in the terminal that starts Veryfront:

```bash
export OPENAI_API_KEY="<TOKEN>"
export OPENAI_BASE_URL="http://localhost:1234/v1"
export VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS="http://localhost:1234"
```

Use an ID returned by `/v1/models`. For example:

```ts
agent({ model: "openai/qwen2.5-7b-instruct" });
```

LM Studio does not require a token unless you enable authentication, but
Veryfront still requires a non-empty `OPENAI_API_KEY`. See
[LM Studio OpenAI compatibility](https://lmstudio.ai/docs/developer/openai-compat).

Model behavior varies in both runtimes. Select a model with native tool-use
support when the agent uses tools.

## Custom provider registration

For providers not covered by env vars, use `registerModelProvider()`:

```ts
import { registerModelProvider } from "veryfront/provider";

const unregisterOllama = registerModelProvider("ollama", (id) => {
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

Registration inside a project source context is isolated to that project.
Registration during application bootstrap, outside a project context, becomes
the default for every project unless a project registers an override. The
returned disposer removes only the registration created by that call.
Call `unregisterOllama()` during application teardown when the registration is
no longer needed.

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
