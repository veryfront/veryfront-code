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

| Name                   | Description                                                                    | Source                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `discoverSchedules`    | Discover and validate canonical schedule definitions from a project directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/discovery.ts#L19) |
| `isScheduleDefinition` | Return true only when every schedule field and nested invariant is valid.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L55)     |
| `schedule`             | Validate and normalize a source-defined schedule configuration.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/factory.ts#L10)   |

### Types

| Name                                   | Description                                                                   | Source                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `ScheduleConcurrencyPolicy`            |                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L4)      |
| `ScheduleConfig`                       |                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L48)     |
| `ScheduleDefinition`                   |                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L32)     |
| `ScheduleDiscoveryOptions`             |                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/discovery.ts#L9)  |
| `ScheduleDiscoveryResult`              |                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/discovery.ts#L16) |
| `ScheduleHealth`                       | Marks a schedule unhealthy when it has not succeeded within the given budget. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L7)      |
| `ScheduleIntegrationRequirement`       |                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L20)     |
| `ScheduleIntegrationRequirementConfig` |                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L26)     |
| `ScheduleIntegrationResource`          |                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L16)     |
| `ScheduleIntegrationResourceIdentity`  |                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L11)     |
