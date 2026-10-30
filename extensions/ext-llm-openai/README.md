# @veryfront/ext-llm-openai

> **Category:** LLM | **Contract:** `LLMProvider` | **Built-in**

Provides OpenAI models for Veryfront agents and chat, enabling `openai/*` models for chat, embeddings, the Responses API, and OpenAI-hosted web search via the `LLMProviderRegistry`.

## Registration

This extension is auto-enabled by core bootstrap. Add it to `veryfront.config.ts` only when you need to override the built-in registration:

```ts
import extOpenAI from "@veryfront/ext-llm-openai";

export default defineConfig({
  extensions: [extOpenAI()],
});
```

## Environment Variables

| Variable                                           | Required | Description                                                                                                          |
| -------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`                                   | Yes      | Your OpenAI API key.                                                                                                 |
| `OPENAI_BASE_URL`                                  | No       | Override the API base URL (for Azure OpenAI, self-hosted gateways, or OpenAI-compatible providers like Moonshot AI). |
| `VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS` | Local    | Exact internal provider origins the host permits, without API paths.                                                 |

## Usage

Once credentials are configured, use `openai/*` model strings anywhere Veryfront expects a model identifier:

```ts
const response = await ai.chat("openai/gpt-4.1", {
  prompt: [{ role: "user", content: "Hello" }],
});
```

### Embeddings

```ts
const result = await ai.embed("openai/text-embedding-3-small", {
  values: ["search query"],
});
```

### Responses API

For models that support OpenAI's Responses API (structured output, function
tools, and supported hosted tools):

```ts
const response = await ai.responses("openai/gpt-4.1", {
  prompt: [{ role: "user", content: "What is 2+2?" }],
});
```

### Decisions API

For classification and scoring, use a typed decision runtime. This is separate
from chat and Responses: answers are predicates, choices, scores, or explicit
refusals, without generated text or tool execution.

```ts
import { OpenAIProvider } from "@veryfront/ext-llm-openai";

const decisions = new OpenAIProvider().createDecisions("gpt-6-luna", {
  credential: "<API_KEY>",
});
const result = await decisions.decide({
  input: "The export button fails after selecting a date range.",
  questions: [{
    name: "category",
    type: "choice",
    instructions: "Select the best category for this report.",
    choices: [{ value: "bug" }, { value: "question" }],
  }],
  abortSignal: AbortSignal.timeout(10_000),
});
const answer = result.answers[0];
if (answer.type === "choice") {
  console.log(answer.choice, answer.confidence, answer.probabilities);
} else if (answer.type === "refusal") {
  console.log("Review this report manually.");
}
```

Supply the application's OpenAI key as `credential`. The runtime also accepts
the provider's `baseURL` and `fetch` settings and uses the normal guarded provider
HTTP transport. This is direct-provider support; `ai.chat`, agent model strings,
and Veryfront Cloud gateway routing do not invoke Decisions.

`input` and question `instructions` accept text or an array of `{ type: "text",
text }`, `{ type: "image", url }`, and `{ type: "json", data }` parts. JSON data
must be an object or an array of objects. This initial surface does not accept
conversation history, files, audio, explicit cache breakpoints, or tool calls.
`promptCacheKey` partitions automatic shared-input caching. Results retain
input, output, total, cached-input and cache-write token counts.

Within the runtime limits below, use 1-400 uniquely named questions. Choices accept 2-255 distinct string or
boolean values; scores accept 2-10 ordered `{ label, description? }` levels and
return a score on their zero-based index scale. Answers retain request order.
Always handle `type: "refusal"` independently from a false predicate or low score.
Malformed responses reject the call, and HTTP failures are not automatically
retried. Set `timeoutMs` or `abortSignal` to bound a call.

This adapter supports a bounded subset of the endpoint's payload sizes. All
limits apply together; the per-field maxima do not guarantee that their largest
combinations fit in one call. Split large question sets into separate calls and
use an HTTP(S) image URL when inline image data exceeds the input budget.

| Scope                                 | Runtime limit                                                    |
| ------------------------------------- | ---------------------------------------------------------------- |
| Shared `input` snapshot               | 64 MiB of canonical JSON UTF-8, 65,536 JSON values, depth 64     |
| Entire `questions` snapshot           | 512 MiB of canonical JSON UTF-8, 1,000,000 JSON values, depth 64 |
| Each JSON part's `data`               | 256 KiB of canonical JSON UTF-8, 10,000 JSON values, depth 32    |
| Shared string input or each text part | 10,485,760 Unicode code points                                   |
| String question instructions          | 1,048,576 Unicode code points                                    |
| Content array                         | At most 16,384 parts; question instructions require at least one |
| `promptCacheKey`                      | 64 Unicode code points                                           |
| Response body                         | 256 MiB                                                          |

Snapshot byte counts include JSON quotes and escapes. JSON value counts include
containers and primitive values, with the root at depth zero. Oversized requests
reject with `TypeError` before dispatch; oversized responses reject with
`ProviderRequestError`. These memory bounds intentionally exclude some payloads
accepted by the upstream endpoint, including very large inline images.

OpenAI currently supports `gpt-6-luna` on this endpoint. The capability is
available as optional `LLMProvider.createDecisions`, returning `DecisionRuntime`
from `veryfront/provider/types`. OpenAI Decisions and TypeSafe's Jev System One
API require separate adapters: their endpoints, input fields, question maps,
and predicate representations differ.

Sources: [OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions),
[OpenAI request/response reference](https://developers.openai.com/api/reference/resources/decisions/methods/create),
[TypeSafe System One reference](https://docs.typesafe.ai/api/system-one).

### Hosted Web Search

The agent-facing tool name is `web_search`. It resolves to the current
`openai.web_search` provider tool and routes that request through the Responses
API, including for models that otherwise use Chat Completions:

```ts
import { agent } from "veryfront/agent";

export default agent({
  model: "openai/gpt-4.1",
  providerTools: ["web_search"],
});
```

| Contract                    | Supported value                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| Agent tool name             | `web_search`                                                                                        |
| Current provider id         | `openai.web_search`                                                                                 |
| Low-level compatibility ids | `openai.web_search_2025_08_26`, `openai.web_search_preview`, `openai.web_search_preview_2025_03_11` |
| Optional argument           | `searchContextSize`: `"low"` \| `"medium"` \| `"high"`                                              |
| Per-request limit           | One OpenAI web-search provider tool                                                                 |

Other OpenAI-hosted tool types are not normalized by this extension and fail
before the provider request. OpenAI-compatible base URLs can use this path only
when the endpoint implements OpenAI's Responses and hosted web-search
contracts.

Responses requests are stateless (`store: false`). The runtime retains the
complete ordered response output in provider metadata and replays it on the
next turn. Reasoning requests explicitly include encrypted reasoning content,
and web-search requests include source URLs, so manual callers must preserve
assistant-message provider metadata between turns. Raw replay is limited to
4,096 output items and 8 MiB. Whenever canonical calls or results survive,
their IDs, names, semantic values, multiplicity, and order must match the raw
output before transport.

Provider-executed Responses calls and results cannot be converted into Chat
Completions history. Switching a conversation containing those parts to a
Chat Completions-only route fails as a configuration error before transport;
keep that conversation on a Responses-capable route or begin a new compacted
history that no longer contains the provider-executed parts.

See [Providers: Enable OpenAI-hosted web search](../../docs/guides/providers.md#enable-openai-hosted-web-search)
for the agent setup.

## Supported Models

Any model accessible through the OpenAI Chat Completions, Responses, or Embeddings API:

- **Flagship:** `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-4o`, `gpt-4o-mini`
- **Frontier:** `gpt-5`, `gpt-5-mini`, `gpt-5-nano`
- **Reasoning:** `gpt-5.4-nano`, current `gpt-5`/`gpt-5.x` reasoning models, `o3`, `o4-mini`, `o1`, `o3-mini` (sampling parameters are automatically dropped with warnings)
- **Embeddings:** `text-embedding-3-small`, `text-embedding-3-large`
- **OpenAI-compatible:** Any third-party model reachable via an OpenAI-compatible endpoint (set `OPENAI_BASE_URL`)

## Configuration Options

The extension accepts configuration through `LLMProviderConfig` when creating runtimes:

| Option       | Type           | Default                     | Description                                |
| ------------ | -------------- | --------------------------- | ------------------------------------------ |
| `credential` | `string`       | —                           | API key (typically from `OPENAI_API_KEY`). |
| `baseURL`    | `string`       | `https://api.openai.com/v1` | API base URL override.                     |
| `name`       | `string`       | `"openai"`                  | Display name for errors and telemetry.     |
| `fetch`      | `typeof fetch` | `globalThis.fetch`          | Custom fetch implementation.               |

## Model-Specific Behavior

### Reasoning Models (GPT-5.x, o3, o4-mini, o1)

Default reasoning params are applied only for native `openai` and `veryfront-cloud` providers.
OpenAI-compatible providers require explicit `reasoning` options. `gpt-5-chat-latest`,
`gpt-5.1`, `o1-mini`, and `o1-preview` are left unmodified by default.

Reasoning models automatically:

- Drop `temperature`, `top_p`, `presence_penalty`, `frequency_penalty` (emit warnings)
- Use `reasoning_effort` (`low` / `medium` / `high`) instead of sampling parameters
- Use `max_completion_tokens` instead of `max_tokens`

### Fixed-Sampling Models (Kimi K2.5)

Models like `kimi-k2.5` have fixed sampling parameters. The extension drops `temperature`, `top_p`, `presence_penalty`, and `frequency_penalty` with warnings.

### Native vs Compatible Models

Native OpenAI models (`gpt-*`, `o*`, `chatgpt-*`) use `max_completion_tokens`. Third-party OpenAI-compatible models use `max_tokens`.

## Provider Options

Pass provider-specific options through `providerOptions`:

```ts
const response = await ai.chat("openai/gpt-4.1", {
  prompt: messages,
  providerOptions: {
    openai: {
      service_tier: "flex",
      parallel_tool_calls: true,
    },
  },
});
```

Available provider options include:

- `service_tier` — `"auto"` | `"default"` | `"flex"` | `"scale"`
- `parallel_tool_calls` — enable/disable parallel tool execution
- `reasoning_effort` — `"low"` | `"medium"` | `"high"` (for reasoning models)
- `response_format` — structured output format (JSON mode or JSON schema)
- `seed` — deterministic sampling seed
- `user` — end-user identifier for abuse monitoring

## Error Handling

The extension surfaces typed provider errors:

- `ProviderRateLimitError` — 429 responses with retry-after
- `ProviderQuotaError` — quota exceeded
- `ProviderOverloadedError` — 503 / overloaded
- `ProviderRequestError` — other HTTP errors

If the extension is not installed and an `openai/*` model is requested, the error message is:

> OpenAI provider not installed. Add @veryfront/ext-llm-openai to use openai/* models.
