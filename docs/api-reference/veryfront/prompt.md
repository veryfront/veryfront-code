---
title: "veryfront/prompt"
description: "Declare and register prompts exposable over MCP."
order: 23
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

const content = await summarize.getContent({
  style: "technical",
  text: "The runtime loads tools before an agent step starts.",
});
```

## API

### `prompt(config)`

Create a typed prompt definition.

**Returns:** `Prompt`

## Exports

### Functions

| Name     | Description                       | Source                                                                                    |
| -------- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| `prompt` | Create a typed prompt definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/factory.ts#L24) |

### Types

| Name                  | Description                                               | Source                                                                                                  |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `Prompt`              | Public API contract for prompt.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/types.ts#L11)                 |
| `PromptArgument`      | Public MCP argument metadata for a prompt.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/schemas/prompt.schema.ts#L73) |
| `PromptConfig`        | Configuration used by prompt.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/schemas/prompt.schema.ts#L71) |
| `PromptGenerateFn`    | Generate prompt content from interpolation variables.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/schemas/prompt.schema.ts#L12) |
| `PromptMCPConfig`     | Public MCP exposure metadata for a prompt.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/schemas/prompt.schema.ts#L75) |
| `PromptRenderContext` | Cancellation and deadline controls for one prompt render. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/schemas/prompt.schema.ts#L4)  |

### Constants

| Name             | Description                                              | Source                                                                                     |
| ---------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `promptRegistry` | Application-facing project-scoped prompt registry value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/registry.ts#L61) |
