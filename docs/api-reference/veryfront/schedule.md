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
  health: { maxStalenessSeconds: 1800 },
});
```

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `discoverSchedules` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/discovery.ts#L18) |
| `isScheduleDefinition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L53) |
| `schedule` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/factory.ts#L223) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ScheduleConcurrencyPolicy` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L3) |
| `ScheduleConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L47) |
| `ScheduleDefinition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L31) |
| `ScheduleDiscoveryOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/discovery.ts#L9) |
| `ScheduleDiscoveryResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/discovery.ts#L16) |
| `ScheduleHealth` | Marks a schedule unhealthy when it has not succeeded within the given budget. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L6) |
| `ScheduleIntegrationRequirement` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L19) |
| `ScheduleIntegrationRequirementConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L25) |
| `ScheduleIntegrationResource` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L15) |
| `ScheduleIntegrationResourceIdentity` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L10) |
