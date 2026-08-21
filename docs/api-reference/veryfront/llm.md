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

```ts
import { generate } from "veryfront/llm";

const { text } = await generate({ input: "Name three colours." });
```

## Exports

### Functions

| Name       | Description                                                   | Source                                                                               |
| ---------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `generate` | Run a single model call without registering a reusable agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/llm/index.ts#L45) |

### Types

| Name            | Description                     | Source                                                                               |
| --------------- | ------------------------------- | ------------------------------------------------------------------------------------ |
| `GenerateInput` | Request accepted by `generate`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/llm/index.ts#L24) |
