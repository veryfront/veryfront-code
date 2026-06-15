---
title: "veryfront/work"
description: "Declare source-backed Work definitions for business process observability."
order: 29
---

## Import

```ts
import { work, workRegistry } from "veryfront/work";
```

## Examples

```ts
import { work } from "veryfront/work";

export default work({
  id: "supplier-invoice-processing",
  name: "Supplier invoice processing",
  outcome: "Resolve all open supplier invoices.",
  acceptanceCriteria: [
    {
      id: "invoices_discovered",
      description: "Open supplier invoices have been discovered.",
    },
  ],
});
```

## API

### `work(config)`

Create a typed Work definition.

| Property             | Type                        | Description                                                   | Source                                                                                |
| -------------------- | --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `id`                 | `string`                    | Stable project-local Work identifier.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L14) |
| `name?`              | `string`                    | Human-readable display name. Defaults to the id when omitted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L16) |
| `outcome`            | `string`                    | Business outcome the execution layer should make true.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L18) |
| `acceptanceCriteria` | `WorkAcceptanceCriterion[]` | Outcome criteria tracked as business process state.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L20) |

**Returns:** `WorkDefinition`

## Type Reference

### `WorkAcceptanceCriterion`

One measurable outcome condition for a Work definition.

| Property      | Type     | Description                                                      | Source                                                                               |
| ------------- | -------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `id`          | `string` | Stable identifier used by execution state and cloud persistence. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L4) |
| `description` | `string` | Human-readable condition that must be satisfied unless optional. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L6) |
| `optional?`   | `true`   | Optional criteria do not block Work execution completion.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L8) |

## Exports

### Functions

| Name   | Description                     | Source                                                                                 |
| ------ | ------------------------------- | -------------------------------------------------------------------------------------- |
| `work` | Create a typed Work definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/factory.ts#L5) |

### Types

| Name                      | Description                                             | Source                                                                                |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `WorkAcceptanceCriterion` | One measurable outcome condition for a Work definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L2)  |
| `WorkConfig`              | Configuration used by work().                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L12) |
| `WorkDefinition`          | Public API contract for Work definitions.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L24) |
| `WorkReference`           | Agent-level reference to source-declared Work.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L32) |

### Constants

| Name           | Description                 | Source                                                                                   |
| -------------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| `workRegistry` | Shared Work registry value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/registry.ts#L30) |
