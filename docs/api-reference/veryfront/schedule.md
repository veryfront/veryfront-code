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
});
```

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `discoverSchedules` | Discover, validate, and detach source-defined project schedules. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/discovery.ts#L50) |
| `isScheduleDefinition` | Return whether a value satisfies the complete schedule definition contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L80) |
| `schedule` | Create a validated, detached source-defined schedule. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/factory.ts#L5) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ScheduleConcurrencyPolicy` | Policy applied when a scheduled run overlaps an active run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L5) |
| `ScheduleConfig` | Author input accepted by the schedule factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L70) |
| `ScheduleDefinition` | Canonical source-defined schedule returned by validation and discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L42) |
| `ScheduleDiscoveryOptions` | Options for discovering source-defined schedules. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/discovery.ts#L12) |
| `ScheduleDiscoveryResult` | Valid schedules and contained source-file failures. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/discovery.ts#L26) |
| `ScheduleIntegrationRequirement` | Canonical integration access required when a schedule runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L22) |
| `ScheduleIntegrationRequirementConfig` | Author input for one schedule integration requirement. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L32) |
| `ScheduleIntegrationResource` | Integration resource, optionally scoped under a parent resource. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L16) |
| `ScheduleIntegrationResourceIdentity` | Stable identity for an integration resource required by a schedule. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L8) |
| `SourceTriggerDiscoveryError` | Sanitized failure reported while discovering one source-defined trigger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L36) |
| `SourceTriggerDiscoveryErrorCode` | Stable classification for a source-trigger discovery failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L26) |
| `SourceTriggerDiscoveryResult` | Definitions and contained failures returned by source-trigger discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L54) |
| `SourceTriggerKind` | Source-defined trigger categories supported by discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L23) |
| `TriggerTarget` | Identifies the runtime primitive that a trigger starts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L7) |
| `TriggerTargetKind` | Trigger target categories supported by source-defined schedules and webhooks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L4) |
