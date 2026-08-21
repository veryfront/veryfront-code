---
title: "veryfront/llm"
description: "One-shot model calls."
order: 16
---

## Import

```ts
import { generate } from "veryfront/llm";
```

## Examples

### Text

```ts
import { generate } from "veryfront/llm";

const { text } = await generate({ input: "Name three colours." });
```

### Structured output

```ts
import { generate } from "veryfront/llm";
import { defineSchema } from "veryfront/schemas";

const { object } = await generate({
  input: "Berlin is 12 degrees today.",
  outputSchema: defineSchema((v) => v.object({ city: v.string(), tempC: v.number() }))(),
});

object.city; // string
```

### Choosing a model

```ts
import { generate } from "veryfront/llm";

const { text } = await generate({
  input: "Summarise this in one line.",
  system: "You are terse.",
  model: "anthropic/claude-haiku-4-5-20251001",
});
```

## Exports

### Functions

| Name       | Description                                                   | Source                                                                               |
| ---------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `generate` | Run a single model call without registering a reusable agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/llm/index.ts#L71) |

### Types

| Name            | Description                     | Source                                                                               |
| --------------- | ------------------------------- | ------------------------------------------------------------------------------------ |
| `GenerateInput` | Request accepted by `generate`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/llm/index.ts#L50) |
