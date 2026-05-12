# @veryfront/ext-llm-google

Veryfront extension that registers the Google Generative Language provider into the `AIProviderRegistry`, enabling `google/*` models for chat and embeddings (Gemini API).

## Installation

Add the extension to your project's `veryfront.config.ts`:

```ts
import extGoogle from "@veryfront/ext-llm-google";

export default defineConfig({
  extensions: [extGoogle()],
});
```

## Environment Variables

| Variable                       | Required | Description                                                                    |
| ------------------------------ | -------- | ------------------------------------------------------------------------------ |
| `GOOGLE_API_KEY`               | Yes      | Your Google AI API key (from [AI Studio](https://aistudio.google.com/apikey)). |
| `GOOGLE_GENERATIVE_AI_API_KEY` | No       | Alternative name for the API key (checked as fallback).                        |

## Usage

Once installed, use `google/*` model strings anywhere Veryfront expects a model identifier:

```ts
const response = await ai.chat("google/gemini-2.5-pro", {
  prompt: [{ role: "user", content: "Hello" }],
});
```

### Embeddings

```ts
const result = await ai.embed("google/text-embedding-005", {
  values: ["search query"],
});
```

## Supported Models

Any model accessible through the Google Generative Language API:

- **Flagship:** `gemini-2.5-pro`, `gemini-2.5-flash`
- **Stable:** `gemini-2.0-flash`, `gemini-1.5-pro`, `gemini-1.5-flash`
- **Embeddings:** `text-embedding-005`, `text-embedding-004`

## Configuration

The extension accepts configuration through `AIProviderConfig` when creating runtimes:

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

When thinking is enabled, Gemini returns `thought` parts that the runtime emits as `reasoning-start` / `reasoning-delta` / `reasoning-end` stream events.

## Prompt Caching

Gemini uses a separate cached-content resource model. Create a cache via the Gemini REST API or SDK, then pass the resource name on each request:

```ts
const response = await ai.chat("google/gemini-2.5-pro", {
  prompt: messages,
  googleCachedContent: "cachedContents/abc123",
});
```

When a cached content resource is attached, the response `usageMetadata.cachedContentTokenCount` is surfaced as `cacheReadInputTokens` on the result.

## Provider Tools

Gemini supports provider-native tools alongside function declarations. Use the `provider` tool type with a `google.*` id:

### Code Execution

```ts
tools: [
  { type: "provider", name: "code_execution", id: "google.code_execution", args: {} },
];
```

### Google Search

```ts
tools: [
  { type: "provider", name: "google_search", id: "google.google_search", args: {} },
];
```

Provider tools can be combined with regular function tools in the same request. When Google Search is used, the response includes `groundingMetadata` with web search queries, grounding chunks, and citation indices.

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

| Error Class               | Trigger                       | Retryable |
| ------------------------- | ----------------------------- | --------- |
| `ProviderOverloadedError` | HTTP 503                      | Yes       |
| `ProviderQuotaError`      | HTTP 429 `RESOURCE_EXHAUSTED` | No        |
| `ProviderRateLimitError`  | HTTP 429 with `Retry-After`   | Yes       |
| `ProviderRequestError`    | Other HTTP errors             | No        |

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
deno test --no-check --allow-all extensions/ext-google/

# Or from the extension directory
cd extensions/ext-google
deno task test
```

The test suite covers:

- Generate and stream request/response mapping
- Extended thinking (thinkingConfig budget mapping, thought-part streaming)
- Embedding runtime (single and batch)
- Error classification (503, 429 RESOURCE_EXHAUSTED)
- Unsupported-setting warnings (presencePenalty, frequencyPenalty)
- User ID and request label forwarding
- Tool choice normalization (auto, any, none, single-tool, multi-tool)
- Grounding metadata pass-through (google_search)
- Provider tools (code_execution, google_search)
- Safety settings and cached content
