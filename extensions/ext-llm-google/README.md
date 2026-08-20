# @veryfront/ext-llm-google

> **Category:** LLM | **Contract:** `LLMProvider` | **Built-in**

Provides Google Gemini models for Veryfront agents and chat, enabling `google/*` models for chat and embeddings via the `LLMProviderRegistry`.

## Registration

This extension is auto-enabled by core bootstrap. Add it to `veryfront.config.ts` only when you need to override the built-in registration:

```ts
import extGoogle from "@veryfront/ext-llm-google";

export default defineConfig({
  extensions: [extGoogle()],
});
```

## Environment Variables

| Variable                       | Required | Description                                                                                                                                     |
| ------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_API_KEY`               | Yes      | Your Google AI API key (from [AI Studio](https://aistudio.google.com/apikey)).                                                                  |
| `GOOGLE_GEMINI_BASE_URL`       | No       | Custom Gemini endpoint (proxy or regional). Include the API version segment, e.g. `https://example.com/v1beta`. Applies to chat and embeddings. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | No       | Alternative name for the API key (checked as fallback).                                                                                         |

## Usage

Once credentials are configured, use `google/*` model strings anywhere Veryfront expects a model identifier:

```ts
const response = await ai.chat("google/gemini-2.5-pro", {
  prompt: [{ role: "user", content: "Hello" }],
});
```

### Embeddings

```ts
const result = await ai.embed("google/gemini-embedding-2", {
  values: ["search query"],
});
```

## Supported Models

Any model accessible through the Google Generative Language API:

- **Flagship:** `gemini-2.5-pro`, `gemini-2.5-flash`
- **Stable:** `gemini-2.0-flash`, `gemini-1.5-pro`, `gemini-1.5-flash`
- **Embeddings:** `gemini-embedding-2`

## Configuration

The extension accepts configuration through `LLMProviderConfig` when creating runtimes:

| Option       | Type           | Default                                            | Description                            |
| ------------ | -------------- | -------------------------------------------------- | -------------------------------------- |
| `credential` | `string`       | —                                                  | API key (typically from env var).      |
| `baseURL`    | `string`       | `https://generativelanguage.googleapis.com/v1beta` | API base URL override.                 |
| `name`       | `string`       | `"google"`                                         | Display name for errors and telemetry. |
| `fetch`      | `typeof fetch` | `globalThis.fetch`                                 | Custom fetch implementation.           |

## Model Defaults

Gemini models use the Google `generateContent` / `streamGenerateContent` endpoints. Request mapping:

- `maxOutputTokens` → `generationConfig.maxOutputTokens`
- `temperature` → `generationConfig.temperature`
- `topP` → `generationConfig.topP`
- `topK` → `generationConfig.topK`
- `stopSequences` → `generationConfig.stopSequences`
- `seed` → `generationConfig.seed`
- System messages → `systemInstruction.parts`

## Extended Thinking

Gemini 2.5+ models support extended thinking via the unified `reasoning` option:

```ts
const response = await ai.chat("google/gemini-2.5-pro", {
  prompt: messages,
  reasoning: { enabled: true, effort: "high" },
});
```

Effort levels map to Gemini `thinkingConfig.thinkingBudget`:

| Effort   | Budget Tokens |
| -------- | ------------- |
| `low`    | 512           |
| `medium` | 2048          |
| `high`   | 8192          |
| `max`    | -1 (dynamic)  |

Set `budgetTokens` directly to override the effort mapping:

```ts
reasoning: { enabled: true, budgetTokens: 4096 }
```

Explicit budgets must be non-negative safe integers. The `-1` dynamic-budget
sentinel is reserved for `effort: "max"` and is rejected when supplied through
`budgetTokens`.

When thinking is enabled, Gemini returns `thought` parts that the runtime emits as `reasoning-start` / `reasoning-delta` / `reasoning-end` stream events.

Gemini `thoughtSignature` fields are retained with the exact assistant parts that produced them and replayed automatically on later turns, including parallel function-call responses.
Streaming and replay share one deterministic raw-position tool-ID registry.
Exact replay retains at most 4,096 raw assistant parts and 8 MiB; surviving
canonical calls and results must match the raw history in occurrence order.

## Prompt Caching

Gemini uses a separate cached-content resource model. Create a cache via the Gemini REST API or SDK, then pass the resource name on each request:

```ts
const response = await ai.chat("google/gemini-2.5-pro", {
  prompt: messages,
  googleCachedContent: "cachedContents/abc123",
});
```

When a cached content resource is attached, the response
`usageMetadata.cachedContentTokenCount` is surfaced as the canonical
`cacheReadInputTokens` field and the compatible `cachedInputTokens` alias on
the result.

## Provider Tools

Gemini supports provider-native tools alongside function declarations. Use the `provider` tool type with a `google.*` id:

The extension intentionally supports only the provider tools whose request and
response contracts are normalized end to end:

- `google.code_execution` with name `code_execution`
- `google.google_search` with name `google_search`

Unknown or duplicate provider-tool IDs, tools for another provider, mismatched
names, and unsupported argument fields throw before the HTTP request is sent.

### Code Execution

```ts
tools: [
  { type: "provider", name: "code_execution", id: "google.code_execution", args: {} },
];
```

Google `executableCode` / `codeExecutionResult` parts are exposed as correlated
`code_execution` tool calls and results with `providerExecuted: true`. Failed
and deadline-exceeded outcomes are marked as tool errors. The original ordered
Google parts, including provider IDs and thought signatures, are retained for
exact replay on subsequent turns.

### Google Search

```ts
tools: [
  {
    type: "provider",
    name: "google_search",
    id: "google.google_search",
    args: {
      searchTypes: { webSearch: {}, imageSearch: {} },
      timeRangeFilter: {
        startTime: "2026-01-01T00:00:00Z",
        endTime: "2026-07-01T00:00:00Z",
      },
    },
  },
];
```

Both Google Search argument groups are optional; `{}` keeps Google's default web
search behavior. A time range requires both RFC 3339 timestamps. The nested
`webSearch` and `imageSearch` configurations are currently empty objects, as
defined by Google's API.

Provider tools can be combined with regular function tools in the same request.
Google Search does not produce a client-executed tool call. Instead, Google
returns a candidate-level `groundingMetadata` object containing queries,
grounding chunks, and citation indices. The direct adapter result retains the
legacy top-level `groundingMetadata` property, and direct and streaming results
also expose the same opaque object at
`providerMetadata.google.groundingMetadata`, which survives runtime
normalization. The object envelope and stable citation list fields
(`groundingChunks`, `groundingSupports`, `webSearchQueries`, and
`imageSearchQueries`) are validated for shape. Other nested fields remain
Google-owned so new metadata can pass through without an extension release.

## Safety Settings

Configure per-request safety filters via `googleSafetySettings`:

```ts
const response = await ai.chat("google/gemini-2.5-pro", {
  prompt: messages,
  googleSafetySettings: [
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  ],
});
```

See [Gemini safety settings](https://ai.google.dev/gemini-api/docs/safety-settings) for available categories and thresholds.

## Provider Options

Pass Gemini-specific options through `providerOptions`:

```ts
const response = await ai.chat("google/gemini-2.5-pro", {
  prompt: messages,
  providerOptions: {
    google: {
      generationConfig: { responseMimeType: "application/json" },
    },
  },
});
```

Provider options are merged into the request body after the standard fields, allowing access to any Gemini API feature not covered by the unified interface.

## User Identification and Labels

Gemini supports per-request `labels` for tracking and attribution:

```ts
const response = await ai.chat("google/gemini-2.5-pro", {
  prompt: messages,
  userId: "user_42", // maps to labels.user_id
  requestLabels: { // explicit labels (wins over userId)
    team: "search",
    experiment: "v2",
  },
});
```

When `requestLabels` is set, it takes precedence. Otherwise, `userId` is sent as `labels.user_id`.

## Unsupported Settings

The following settings emit `unsupported-setting` warnings and are silently dropped:

| Setting            | Reason                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `presencePenalty`  | Gemini `generateContent` does not accept presence penalty.                                          |
| `frequencyPenalty` | Gemini `generateContent` does not accept frequency penalty.                                         |
| `responseFormat`   | Gemini uses `generationConfig.responseMimeType` + `responseSchema` instead (use `providerOptions`). |

## Error Handling

The extension surfaces typed provider errors:

| Error Class               | Trigger                                       | Retryable |
| ------------------------- | --------------------------------------------- | --------- |
| `ProviderOverloadedError` | HTTP 503                                      | Yes       |
| `ProviderQuotaError`      | HTTP 429 `RESOURCE_EXHAUSTED`, no retry delay | No        |
| `ProviderRateLimitError`  | HTTP 429 with `Retry-After` or `RetryInfo`    | Yes       |
| `ProviderRequestError`    | Other HTTP errors                             | No        |

Google returns `RESOURCE_EXHAUSTED` for both the daily quota and short-window
per-minute limits. A retry delay — the `Retry-After` header or a
`google.rpc.RetryInfo` entry in `error.details` — separates them: with one the
error is a retryable rate limit carrying the delay, without one it is a hard
quota error that cannot succeed again until the daily window resets.

If the extension is not installed and a `google/*` model is requested:

> Google provider not installed. Add @veryfront/ext-llm-google to use google/* models.

## Tool Choice

The unified `toolChoice` option maps to Gemini's `functionCallingConfig`:

| Input                                  | Gemini Mode | Effect                               |
| -------------------------------------- | ----------- | ------------------------------------ |
| `"auto"`                               | `AUTO`      | Model decides whether to call tools. |
| `"any"` / `"required"`                 | `ANY`       | Model must call at least one tool.   |
| `"none"`                               | `NONE`      | Model must not call tools.           |
| `{ type: "tool", name: "fn" }`         | `ANY`       | Pinned to one function.              |
| `{ type: "tools", names: ["a", "b"] }` | `ANY`       | Restricted to named subset.          |

## Running Tests

```bash
# From the repository root
deno test --no-check --allow-all extensions/ext-llm-google/src/

# Or from the extension directory
cd extensions/ext-llm-google
deno task test
```

The test suite covers:

- Generate and stream request/response mapping
- Extended thinking (validated thinkingConfig budgets, thought-part streaming)
- Embedding runtime (single and batch)
- Error classification (503, 429 RESOURCE_EXHAUSTED)
- Unsupported-setting warnings (presencePenalty, frequencyPenalty)
- User ID and request label forwarding
- Tool choice normalization (auto, any, none, single-tool, multi-tool)
- Grounding metadata pass-through (google_search)
- Provider tools (correlated code_execution calls/results and google_search)
- Safety settings and cached content
