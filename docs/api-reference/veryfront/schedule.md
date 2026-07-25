---
title: "veryfront/schedule"
description: "Source-defined schedules for Veryfront projects."
order: 28
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
  health: { maxStalenessSeconds: 1800 },
});
```

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `discoverSchedules` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/discovery.ts#L17) |
| `isScheduleDefinition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L52) |
| `schedule` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/factory.ts#L222) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ScheduleConcurrencyPolicy` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L2) |
| `ScheduleConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L46) |
| `ScheduleDefinition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L30) |
| `ScheduleDiscoveryOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/discovery.ts#L8) |
| `ScheduleDiscoveryResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/discovery.ts#L15) |
| `ScheduleHealth` | Marks a schedule unhealthy when it has not succeeded within the given budget. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L5) |
| `ScheduleIntegrationRequirement` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L18) |
| `ScheduleIntegrationRequirementConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L24) |
| `ScheduleIntegrationResource` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L14) |
| `ScheduleIntegrationResourceIdentity` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L9) |
