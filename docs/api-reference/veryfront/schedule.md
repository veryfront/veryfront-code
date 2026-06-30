---
title: "veryfront/schedule"
description: "Source-defined schedules for Veryfront projects."
order: 27
---

## Import

```ts
import { discoverSchedules, isScheduleDefinition, schedule } from "veryfront/schedule";
```

## Examples

### Run a workflow every weekday morning

```ts
import { schedule } from "veryfront/schedule";

export default schedule({
  id: "daily-support-triage",
  schedule: "0 9 * * 1-5",
  timezone: "Europe/Stockholm",
  target: { kind: "workflow", id: "escalate-ticket" },
  input: { severity: "high" },
});
```

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `discoverSchedules` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/discovery.ts#L17) |
| `isScheduleDefinition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L23) |
| `schedule` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/factory.ts#L20) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ScheduleConcurrencyPolicy` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L2) |
| `ScheduleConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L18) |
| `ScheduleDefinition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L4) |
| `ScheduleDiscoveryOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/discovery.ts#L8) |
| `ScheduleDiscoveryResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/discovery.ts#L15) |
