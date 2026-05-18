---
title: "veryfront/prompt"
description: "Declare and register prompts exposable over MCP."
order: 12
---

# veryfront/prompt

Declare and register prompts exposable over MCP.

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

const content = await summarize.getContent({
  style: "technical",
  text: "The runtime loads tools before an agent step starts.",
});
```

## API

### `prompt(config)`

Create MCP-discoverable prompt

**Returns:** `Prompt`

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `prompt` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/factory.ts#L8) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `Prompt` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/types.ts#L2) |
| `PromptConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/schemas/prompt.schema.ts#L14) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `promptRegistry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/registry.ts#L28) |

## Related

Reference modules:

- [`veryfront/mcp`](./mcp.md): Expose prompts via MCP
- [`veryfront/agent`](./agent.md): Use prompts in agents

User guides:

- [mcp-server](../../guides/mcp-server.md): Expose prompts over MCP

Architecture:

- [05-agent-runtime](../../architecture/05-agent-runtime.md): Prompts as AI primitives
