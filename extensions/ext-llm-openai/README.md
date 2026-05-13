# @veryfront/ext-llm-openai

> **Type:** LLM Provider | **Contract:** `LLMProvider:openai` | **Built-in**

Provides OpenAI models for Veryfront agents and chat, enabling `openai/*` models for chat, embeddings, and the Responses API via the `LLMProviderRegistry`.

## Installation

Add the extension to your project's `veryfront.config.ts`:

```ts
import extOpenAI from "@veryfront/ext-llm-openai";

export default defineConfig({
  extensions: [extOpenAI()],
});
```

## Environment Variables

| Variable          | Required | Description                                                                                                          |
| ----------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`  | Yes      | Your OpenAI API key.                                                                                                 |
| `OPENAI_BASE_URL` | No       | Override the API base URL (for Azure OpenAI, self-hosted gateways, or OpenAI-compatible providers like Moonshot AI). |

## Usage

Once installed, use `openai/*` model strings anywhere Veryfront expects a model identifier:

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

For models that support OpenAI's Responses API (structured output, native tools):

```ts
const response = await ai.responses("openai/gpt-4.1", {
  prompt: [{ role: "user", content: "What is 2+2?" }],
});
```

## Supported Models

Any model accessible through the OpenAI Chat Completions, Responses, or Embeddings API:

- **Flagship:** `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-4o`, `gpt-4o-mini`
- **Frontier:** `gpt-5`, `gpt-5-mini`, `gpt-5-nano`
- **Reasoning:** `o3`, `o4-mini`, `o1`, `o1-mini`, `o3-mini` (sampling parameters are automatically dropped with warnings)
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

### Reasoning Models (o3, o4-mini, o1)

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
