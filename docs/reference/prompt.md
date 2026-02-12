---
title: "veryfront/prompt"
description: "Declare and register prompts exposable over MCP."
order: 12
---

## Import

```ts
import { prompt, promptRegistry } from "veryfront/prompt";
```

## Examples

```ts
import { prompt } from "veryfront/prompt";

const summarize = prompt({
  id: "summarize",
  description: "Summarize text in a chosen style",
  content: "Summarize the following text in {style} style:\n\n{text}",
});
```

## API

### `prompt(config)`

Create MCP-discoverable prompt

**Returns:** `Prompt`

## Exports

### Functions

| Name | Description |
|------|-------------|
| `prompt` | Create MCP-discoverable prompt |

### Types

| Name | Description |
|------|-------------|
| `Prompt` | `prompt()` return type |
| `PromptConfig` | `prompt()` config |

### Constants

| Name | Description |
|------|-------------|
| `promptRegistry` | Global prompt registry |

## Related

- [`veryfront/mcp`](./mcp.md) — Expose prompts via MCP
- [`veryfront/agent`](./agent.md) — Use prompts in agents
