---
title: "veryfront/prompt"
description: "Declare and register bounded prompt templates exposed through MCP."
order: 22
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

Prompt variables are inserted verbatim after type and size validation. Keep
untrusted values clearly separated from instructions in the template.

## API

### `prompt(config)`

Create a validated, immutable prompt definition.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `id?` | `string` | Optional stable identifier. A random identifier is generated when omitted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/schemas/prompt.schema.ts#L43) |
| `description` | `string` | Human-readable description shown to prompt clients. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/schemas/prompt.schema.ts#L45) |
| `content?` | `string` | Static prompt template. Define either content or generate. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/schemas/prompt.schema.ts#L47) |
| `generate?` | `PromptGenerate` | Dynamic prompt renderer. Define either generate or content. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/schemas/prompt.schema.ts#L49) |
| `arguments?` | `PromptArgument[]` | Argument metadata advertised to MCP clients. Static templates derive this when omitted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/schemas/prompt.schema.ts#L51) |
| `suggestion?` | `string` | Example message text to use as a chat suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/schemas/prompt.schema.ts#L53) |

**Returns:** `Prompt`

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `prompt` | Create a validated, immutable prompt definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/factory.ts#L117) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `Prompt` | Public API contract for prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/types.ts#L11) |
| `PromptArgument` | One argument advertised to MCP clients for a prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/schemas/prompt.schema.ts#L31) |
| `PromptConfig` | Configuration used to create a prompt definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/schemas/prompt.schema.ts#L41) |
| `PromptGenerate` | Callback used to render dynamic prompt content. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/schemas/prompt.schema.ts#L25) |
| `PromptRenderContext` | Cancellation and lifecycle values available while rendering a prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/schemas/prompt.schema.ts#L19) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `promptRegistry` | Shared project-scoped prompt registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/prompt/registry.ts#L53) |
