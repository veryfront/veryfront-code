---
title: "veryfront/schedule"
description: "Source-defined recurring schedules for Veryfront projects."
order: 32
---

## Import

```ts
import {
  discoverSchedules,
  isScheduleDefinition,
  legacyScheduleTargetDiagnostic,
  schedule,
} from "veryfront/schedule";
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

| Name                             | Description                                                                            | Source                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `discoverSchedules`              | Discover and validate canonical schedule definitions from a project directory.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/discovery.ts#L28)   |
| `isScheduleDefinition`           | Return true only when every schedule field and nested invariant is valid.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L120)      |
| `legacyScheduleTargetDiagnostic` | Describe why the legacy `input._schedule_target` channel is invalid, or return `null`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/validation.ts#L448) |
| `schedule`                       | Validate and normalize a source-defined schedule configuration.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/factory.ts#L14)     |

### Types

| Name                                   | Description                                                                   | Source                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `AgentScheduleConfig`                  | Configures an agent schedule with an optional prompt.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L112)    |
| `ScheduleAgentMessage`                 | Contains the prompt that a schedule sends to an agent target.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L51)     |
| `ScheduleConcurrencyPolicy`            | Behavior when a scheduled occurrence overlaps an active run.                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L8)      |
| `ScheduleConfig`                       | Author-facing recurring schedule configuration.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L106)    |
| `ScheduleDefinition`                   | Validated, canonical source definition for one recurring schedule.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L57)     |
| `ScheduleDiscoveryOptions`             | Inputs for deterministic source schedule discovery.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/discovery.ts#L11) |
| `ScheduleDiscoveryResult`              | Valid schedules and bounded per-file discovery diagnostics.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/discovery.ts#L25) |
| `ScheduleHealth`                       | Marks a schedule unhealthy when it has not succeeded within the given budget. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L11)     |
| `ScheduleIntegrationRequirement`       | Canonical integration access required before a scheduled run can start.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L31)     |
| `ScheduleIntegrationRequirementConfig` | Author-facing integration requirement; omitted collections default to empty.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L41)     |
| `ScheduleIntegrationResource`          | Integration resource optionally scoped beneath a parent resource.             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L25)     |
| `ScheduleIntegrationResourceIdentity`  | Stable integration resource key used for source-owned access requirements.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schedule/types.ts#L17)     |
