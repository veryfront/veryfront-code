# @veryfront/ext-anthropic

Veryfront extension that registers the **Anthropic** provider into the core `AIProviderRegistry`. Once loaded, any model string prefixed with `anthropic/` (e.g. `anthropic/claude-sonnet-4-6`) is routed through this provider.

## Configuration

The extension is configured through the standard `AIProviderConfig` interface:

| Field        | Required | Description                                                                         |
| ------------ | -------- | ----------------------------------------------------------------------------------- |
| `credential` | Yes      | Anthropic API key (maps to `x-api-key` header)                                      |
| `baseURL`    | No       | Override the messages endpoint base (default: `https://api.anthropic.com/v1`)       |
| `authToken`  | No       | Bearer token for proxied deployments (Veryfront Cloud, Bedrock-compatible gateways) |
| `name`       | No       | Display name for errors and telemetry (default: `"anthropic"`)                      |
| `fetch`      | No       | Custom fetch implementation (used by veryfront-cloud for injecting project auth)    |

### Example

```ts
import extAnthropic from "@veryfront/ext-anthropic";

const ext = extAnthropic();
ext.setup({
  require: (name) => registry, // AIProviderRegistry
  // ...
});

// Then use via the registry:
const provider = registry.require("anthropic");
const runtime = provider.createModel("claude-sonnet-4-6", {
  credential: process.env.ANTHROPIC_API_KEY!,
  baseURL: "https://api.anthropic.com/v1",
});
```

## Supported Features

### Models

Automatic `max_tokens` defaults based on model family:

| Model                        | Default max_tokens |
| ---------------------------- | ------------------ |
| Claude Opus/Sonnet 4.6       | 128,000            |
| Claude Opus/Sonnet/Haiku 4.5 | 64,000             |
| Claude Opus 4.1              | 32,000             |
| Claude 3 Haiku               | 4,096              |
| Unknown models               | 4,096              |

Caller-provided `maxOutputTokens` is clamped at the model ceiling for known models.

### Extended Thinking

Enable reasoning via the `reasoning` option:

```ts
runtime.doGenerate({
  prompt: [...],
  reasoning: {
    enabled: true,
    effort: "high",    // "low" | "medium" | "high" | "max"
    budgetTokens: 8192 // optional explicit override
  },
});
```

Effort-to-budget mapping: `low` = 1024, `medium` = 4096, `high` = 16384, `max` = 32768.

When thinking is enabled, `temperature` and `topP` are automatically dropped (Anthropic rejects the combo).

### Prompt Caching

Control cache breakpoints via `cacheControl`:

```ts
runtime.doGenerate({
  prompt: [...],
  tools: [...],
  cacheControl: {
    system: true,   // or "5m" | "1h" | false
    tools: "1h",    // breakpoint on the last tool entry
  },
});
```

### Provider Tools

Anthropic-native tools are supported via `type: "provider"` tool definitions:

| Short ID                                        | Resolved Type             |
| ----------------------------------------------- | ------------------------- |
| `anthropic.code_execution`                      | `code_execution_20260120` |
| `anthropic.computer_use` / `anthropic.computer` | `computer_20250124`       |
| `anthropic.text_editor`                         | `text_editor_20250728`    |
| `anthropic.bash`                                | `bash_20250124`           |
| `anthropic.memory`                              | `memory_20250818`         |
| `anthropic.web_search`                          | `web_search_20250305`     |
| `anthropic.web_fetch`                           | `web_fetch_20250910`      |

Already-versioned IDs (e.g. `anthropic.code_execution_20250522`) pass through verbatim.

### MCP Servers

Pass Anthropic-native MCP servers via `mcpServers`. Keys are automatically converted from camelCase to snake_case:

```ts
runtime.doGenerate({
  prompt: [...],
  mcpServers: [{
    type: "url",
    url: "https://example.com/mcp",
    name: "my-server",
    authorizationToken: "Bearer ...",
    toolConfiguration: {
      enabled: true,
      allowedTools: ["search"],
    },
  }],
});
```

### Container

Pass `anthropicContainer` to attach a container context to the request (for computer-use sessions).

### Provider Options

Arbitrary Anthropic-specific fields can be merged into the request body via `providerOptions`:

```ts
runtime.doGenerate({
  prompt: [...],
  providerOptions: {
    anthropic: { top_k: 3 },
    "my-custom-name": { metadata: { trace: "yes" } },
  },
});
```

Both the `"anthropic"` key and the provider's custom `name` are merged.

## Unsupported Options (emits warnings)

The following unified options have no Anthropic equivalent and are silently dropped with a warning:

- `presencePenalty`
- `frequencyPenalty`
- `seed`
- `topK`
- `responseFormat` (non-text; use tool schemas instead)
- `stopSequences` beyond 4 entries (extras truncated)

## Running Tests

```sh
deno task test
```
