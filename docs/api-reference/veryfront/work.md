---
title: "veryfront/work"
description: "Declare source-backed Work definitions for business process observability."
order: 32
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
  expectations: [
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

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `id` | `string` | Stable project-local Work identifier. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L20) |
| `name?` | `string` | Human-readable display name. Defaults to the id when omitted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L22) |
| `outcome` | `string` | Business outcome the execution layer should make true. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L24) |
| `expectations?` | `WorkExpectation[]` | Expectations tracked as business process state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L26) |
| `acceptanceCriteria?` | `WorkExpectation[]` | Deprecated alias for expectations | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L28) |

**Returns:** `WorkDefinition`

## Type Reference

### `WorkExpectation`

One measurable expectation for a Work definition.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `id` | `string` | Stable identifier used by execution state and cloud persistence. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L3) |
| `description` | `string` | Human-readable condition that must be satisfied unless optional. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L5) |
| `optional?` | `true` | Optional expectations do not block Work execution completion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L7) |

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `work` | Create a typed Work definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/factory.ts#L4) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `WorkAcceptanceCriterion` | Deprecated alias for WorkExpectation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L15) |
| `WorkConfig` | Configuration used by work(). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L18) |
| `WorkDefinition` | Public API contract for Work definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L32) |
| `WorkExpectation` | One measurable expectation for a Work definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L1) |
| `WorkReference` | Agent-level reference to source-declared Work. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/types.ts#L42) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `workRegistry` | Shared Work registry value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/work/registry.ts#L29) |
