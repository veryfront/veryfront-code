# @veryfront/ext-llm-anthropic

> **Category:** LLM | **Contract:** `LLMProvider` | **Built-in**

Provides Anthropic Claude models for Veryfront agents and chat. Once loaded, any model string prefixed with `anthropic/` (e.g. `anthropic/claude-sonnet-4-6`) is routed through this provider via the `LLMProviderRegistry`.

## Configuration

The extension is configured through the standard `LLMProviderConfig` interface:

| Field        | Required | Description                                                                         |
| ------------ | -------- | ----------------------------------------------------------------------------------- |
| `credential` | Yes      | Anthropic API key (maps to `x-api-key` header)                                      |
| `baseURL`    | No       | Override the messages endpoint base (default: `https://api.anthropic.com/v1`)       |
| `authToken`  | No       | Bearer token for proxied deployments (Veryfront Cloud, Bedrock-compatible gateways) |
| `name`       | No       | Display name for errors and telemetry (default: `"anthropic"`)                      |
| `fetch`      | No       | Custom fetch implementation (used by veryfront-cloud for injecting project auth)    |

### Example

```ts
import extAnthropic from "@veryfront/ext-llm-anthropic";

const ext = extAnthropic();
ext.setup({
  require: (name) => registry, // LLMProviderRegistry
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
| Claude Opus 4.8/4.7/4.6      | 128,000            |
| Claude Sonnet 4.6            | 64,000             |
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

### Exact Replay

Thinking, redacted thinking, ordinary `tool_use`, server-tool calls, and
server-tool results are retained in assistant provider metadata for later
turns. Manual callers must carry that metadata forward with the canonical
assistant message.

Raw replay is limited to six assistant messages, 4,096 total content blocks,
and 8 MiB. When canonical calls or provider-executed results survive, their
IDs, names, semantic inputs or results, multiplicity, and interleaving must
match the raw blocks before transport. Structurally valid raw-only history is
accepted only when the corresponding canonical projection is absent, for
example after compaction.

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

Pass Anthropic-native MCP server connection details via `mcpServers`. The runtime validates
that every server has a unique name and an absolute HTTPS URL, emits the current
`mcp_servers` wire shape, and adds the required
`mcp-client-2025-11-20` beta without dropping unrelated caller betas.

Every server is paired with exactly one `mcp_toolset`. When no toolset is supplied, the
runtime generates one that enables all tools:

```ts
runtime.doGenerate({
  prompt: [...],
  mcpServers: [{
    type: "url",
    url: "https://example.com/mcp",
    name: "my-server",
    authorizationToken: "opaque-access-token",
  }],
});
```

For current per-tool configuration, add a provider tool whose `name` exactly matches the
MCP server name. Camel-case arguments are converted recursively to Anthropic's wire names:

```ts
runtime.doGenerate({
  prompt: [...],
  mcpServers: [{
    type: "url",
    url: "https://example.com/mcp",
    name: "my-server",
    authorizationToken: "opaque-access-token",
  }],
  tools: [{
    type: "provider",
    id: "anthropic.mcp_toolset",
    name: "my-server",
    args: {
      defaultConfig: {
        enabled: false,
        deferLoading: true,
      },
      configs: {
        search: {
          enabled: true,
          deferLoading: false,
        },
      },
    },
  }],
});
```

The previously documented convenience form remains supported and is translated to the
current MCPToolset allowlist contract:

```ts
mcpServers: [{
  type: "url",
  url: "https://example.com/mcp",
  name: "my-server",
  toolConfiguration: {
    enabled: true,
    allowedTools: ["search"],
  },
}];
```

Do not configure the same server or toolset through both `mcpServers` and raw
`providerOptions`. Ambiguous definitions, duplicate names/toolsets, dangling toolsets,
unknown MCP fields, non-HTTPS URLs, and malformed tool configuration fail before a network
request is made. If raw `mcp_servers` and `tools` are supplied through `providerOptions`,
they must already use Anthropic's current wire contract:

```ts
providerOptions: {
  anthropic: {
    mcp_servers: [{
      type: "url",
      url: "https://example.com/mcp",
      name: "my-server",
    }],
    tools: [{
      type: "mcp_toolset",
      mcp_server_name: "my-server",
    }],
  },
}
```

### Structured Outputs

A `json_schema` response format maps to Anthropic `output_config`:

```json
{
  "output_config": {
    "format": {
      "type": "json_schema",
      "schema": { "type": "object", "properties": {}, "additionalProperties": false }
    }
  }
}
```

Anthropic rejects an object-typed schema that does not explicitly set
`additionalProperties: false`, independently of the framework's own `strict`
flag:

```text
output_config.format.schema: For 'object' type, 'additionalProperties'
must be explicitly set to false
```

The builder satisfies that itself, filling in `additionalProperties: false` on
every object subschema that left it unset -- including nested properties, array
items, and `anyOf`/`oneOf`/`allOf` branches -- so a plain
`defineSchema((v) => v.object({ ... }))()` works without `.strict()`.

An `additionalProperties` you declare yourself is left as declared. A schema
that genuinely allows extra properties, such as one built with `v.record()`,
is still rejected by Anthropic, which has no way to express an open object in
structured output.

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
- `responseFormat` with `type: "json"` (Anthropic `output_config` requires a schema)
- `stopSequences` beyond 4 entries (extras truncated)

## Running Tests

```sh
deno task test
```
