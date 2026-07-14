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
  integrationRequirements: [
    {
      integration: "slack",
      requiredScopes: ["chat:write"],
      resources: [
        { kind: "channel", id: "C012345", parent: { kind: "workspace", id: "T012345" } },
      ],
    },
  ],
});
```

## Exports

### Functions

| Name                   | Description | Source                                                                                        |
| ---------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `discoverSchedules`    |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/discovery.ts#L17) |
| `isScheduleDefinition` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L37)     |
| `schedule`             |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/factory.ts#L109)  |

### Types

| Name                                   | Description | Source                                                                                        |
| -------------------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `ScheduleConcurrencyPolicy`            |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L3)      |
| `ScheduleConfig`                       |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L32)     |
| `ScheduleDefinition`                   |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L17)     |
| `ScheduleDiscoveryOptions`             |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/discovery.ts#L8)  |
| `ScheduleDiscoveryResult`              |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/discovery.ts#L15) |
| `ScheduleIntegrationRequirement`       |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L11)     |
| `ScheduleIntegrationRequirementConfig` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L17)     |
| `ScheduleIntegrationResource`          |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L10)     |
| `ScheduleIntegrationResourceIdentity`  |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L5)      |
