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

## Enable OpenAI-hosted web search

Set an OpenAI model and explicitly allow the `web_search` provider tool:

```ts
// agents/researcher.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "researcher",
  model: "openai/gpt-4.1",
  system: "Search the web when current sources would improve the answer.",
  providerTools: ["web_search"],
});
```

Veryfront sends requests that use this tool to OpenAI's Responses endpoint.
Requests for the same non-reasoning model without `web_search` continue to use
Chat Completions. `veryfront-cloud/openai/*` models use the same agent
configuration.

Only OpenAI-hosted `web_search` is enabled through this agent surface. The
runtime rejects unsupported or duplicate OpenAI provider tools before sending
a request. An `OPENAI_BASE_URL` override must implement both the Responses API
and OpenAI's hosted web-search contract.

The agent runtime preserves the ordered OpenAI response output, encrypted
reasoning state, search source URLs, and citations across stateless
(`store: false`) turns. If a lower-level caller builds the next prompt itself,
it must carry the assistant message's `providerMetadata` forward unchanged.

## Preserve provider replay metadata

When a lower-level caller constructs a follow-up prompt, copy the assistant
message and its `providerMetadata` together. Treat the metadata as opaque:
do not rebuild, mutate, reorder, or merge its native parts.

The runtime stores provider-native replay as an owned, bounded JSON snapshot.
OpenAI retains at most 4,096 raw output items, Google retains at most 4,096 raw
assistant parts, and Anthropic retains at most six raw assistant messages and
4,096 total blocks. Each provider caps one replay snapshot at 8 MiB.

If the canonical assistant message still contains a tool call or
provider-executed result, the raw history must match its ID, name, semantic
input or result, multiplicity, and occurrence order. A duplicate, reorder, or
mismatch fails before the network request. If compaction intentionally removes
the complete canonical projection, structurally valid raw-only history can
still be replayed where the provider requires it. More generally, the runtime
can verify only that the corresponding canonical projection is absent; it
cannot authenticate why it is absent.

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

Custom runtimes sit on a validation boundary. Generation hooks receive
`ModelRuntimeCallOptions`, including an immutable prompt view and the caller's
`abortSignal`; implementations should stop transport and model work promptly
when that signal aborts. Direct responses and stream events must expose known
fields as own data properties. A stream must emit exactly one terminal
`finish` or `error` event and no events after it.

Structured tool input must be ordinary JSON-compatible data: finite numbers,
strings, booleans, null, arrays, and plain or null-prototype objects. Array
holes normalize to JSON `null`; populated elements must be own enumerable data
properties.
Accessors, symbol or non-enumerable properties, functions, `bigint`, class
instances, custom `toJSON`, cycles, and non-finite numbers fail closed. Raw
JSON strings retain their exact formatting. The bridge limits one request to
128 tool calls, 1 MiB per call, 8 MiB in aggregate, and 4,096 streamed deltas
per call. It also limits a direct response to 65,536 content parts and 8 MiB of
aggregate text, and limits the system prompt to 1,024 segments and 1,048,576
UTF-16 code units.

Return usage in the flat `RuntimeUsage` shape whenever possible. Compatibility
normalization also accepts AI SDK provider-v3 nested
`inputTokens.{total,cacheRead,cacheWrite}` and
`outputTokens.{total,reasoning}` fields, plus AI SDK v6
`inputTokenDetails.{cacheReadTokens,cacheWriteTokens}` and
`outputTokenDetails.reasoningTokens`. Only non-negative safe-integer token
counters from own data properties participate. Invalid counters and inherited
fields are omitted; a known accessor or failed reflection causes the untrusted
usage record to be discarded. Normalized usage is a data-only record and may
have a null prototype, so use `Object.hasOwn(usage, field)` instead of calling
Object instance methods on it. `cacheReadInputTokens` is the canonical
cache-read counter; `cachedInputTokens` remains a compatibility alias.
Normalization accepts either spelling and emits both with the same value. When
both are present in one snapshot, the canonical field wins.

Register application-wide defaults during bootstrap, outside a project request
or source context. The default is then visible in every project, while a
registration made inside a project context overrides it only for that project
source. Framework-provided providers remain available in either case.

Provider names must be non-empty and cannot contain `/`. Resolution rejects a
factory that does not return callable `doGenerate()` and `doStream()` methods,
so malformed plugins fail where the model is selected rather than during a
later generation step.

For scoped test cleanup, call `clearModelProviders()` in the same project
context where the test registered its override. Calling it outside a project
context clears bootstrap registrations only. It never deletes another
project's providers or the framework-provided built-ins.

## Direct model resolution

For cases outside the agent system:

```ts
import { resolveModel } from "veryfront/provider";

const model = resolveModel("openai/gpt-5.5");
const cloudModel = resolveModel("veryfront-cloud/openai/gpt-5.5");
```

## Failure and cancellation behavior

Provider HTTP response failures use typed errors with status and retryability
metadata. Only known transient upstream statuses are marked retryable.
Transport failures that happen before an HTTP response exists, such as DNS or
TLS errors, retain their native error. Cancellation retains the caller's abort
reason.

Successful JSON responses have a bounded body, a deadline, and strict UTF-8 and
JSON decoding. Malformed successful payloads, malformed SSE lifecycle events,
and invalid embedding vectors fail closed without including the upstream
payload in the public error. Invalid usage counters are omitted rather than
reported with imprecise or non-finite values.

Streaming requests bound header acquisition and link cancellation of the
returned stream to both the request signal and upstream response body. Pass the
agent or runtime abort signal through custom provider implementations so
canceled requests release their network and model resources.

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
