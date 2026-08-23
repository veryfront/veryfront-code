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
import { defineSchema, lazySchema } from "veryfront/schemas";

const { object } = await generate({
  input: "The checkout button does nothing on mobile Safari.",
  system: "Classify the support ticket.",
  outputSchema: lazySchema(defineSchema((v) =>
    v.object({
      category: v.enum(["bug", "billing", "feature"]),
      reasoning: v.string(),
      confidence: v.number().min(0).max(100),
    })
  )),
});

object.category; // "bug" | "billing" | "feature"
object.confidence; // number, 0-100
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
| `generate` | Run a single model call without registering a reusable agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/llm/index.ts#L76) |

### Types

| Name            | Description                     | Source                                                                               |
| --------------- | ------------------------------- | ------------------------------------------------------------------------------------ |
| `GenerateInput` | Request accepted by `generate`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/llm/index.ts#L55) |
