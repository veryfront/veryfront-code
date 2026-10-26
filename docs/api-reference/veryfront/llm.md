---
title: "veryfront/llm"
description: "One-shot model calls."
order: 18
---

## Import

```ts
import { fileFromBytes, generate, planFileParts } from "veryfront/llm";
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

| Name            | Description                                                             | Source                                                                           |
| --------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `fileFromBytes` | Build a serializable message file part without uploading the file.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/llm/file.ts)  |
| `generate`      | Run a single model call without registering a reusable agent.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/llm/index.ts) |
| `planFileParts` | Select which local files fit a message, without throwing for file data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/llm/file.ts)  |

### Types

| Name                     | Description                                                              | Source                                                                           |
| ------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `FileBytesInput`         | Local file input. Read bytes with your runtime's filesystem or File API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/llm/file.ts)  |
| `FilePartOmissionReason` | Why `planFileParts` did not send a file.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/llm/file.ts)  |
| `FilePartsPlan`          | File parts to send and every file that was left out.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/llm/file.ts)  |
| `GenerateInput`          | Request accepted by `generate`.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/llm/index.ts) |
| `OmittedFilePart`        | A file that `planFileParts` did not send. File bytes are not included.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/llm/file.ts)  |
| `PlanFilePartsInput`     | Local files and optional raw-byte and count budgets for one message.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/llm/file.ts)  |
