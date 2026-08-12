---
title: "veryfront/trigger"
description: "Shared source-trigger discovery and local execution primitives."
order: 39
---

## Import

```ts
import {
  discoverSourceTriggers,
  isTriggerId,
  isTriggerTarget,
  runTriggerTarget,
} from "veryfront/trigger";
```

## Examples

### Discover and run a source-defined trigger target

```ts
import { discoverSchedules } from "veryfront/schedule";
import { runTriggerTarget } from "veryfront/trigger";

const { items } = await discoverSchedules({ projectDir, adapter });
const dailyTriage = items.find((item) => item.id === "daily-support-triage");

if (dailyTriage) {
  await runTriggerTarget({
    projectDir,
    adapter,
    target: dailyTriage.target,
    input: dailyTriage.input,
  });
}
```

## Exports

### Functions

| Name                     | Description                                                                                   | Source                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `discoverSourceTriggers` | Discover, validate, normalize, and deterministically de-duplicate source trigger definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L354)    |
| `isTriggerId`            | Return true for a bounded canonical slash-separated trigger identifier.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/validation.ts#L8)     |
| `isTriggerTarget`        | Return true only for canonical targets stored in own data properties.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L41)        |
| `runTriggerTarget`       | Discover and execute one canonical task, workflow, or agent target.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/local-runner.ts#L362) |

### Types

| Name                              | Description                                                                  | Source                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `RunTriggerTargetOptions`         | Options for one local trigger target execution.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/local-runner.ts#L25) |
| `SourceTriggerDiscoveryError`     | Structured failure produced while discovering one source definition.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L34)    |
| `SourceTriggerDiscoveryErrorCode` | Stable failure categories emitted while discovering source triggers.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L25)    |
| `SourceTriggerDiscoveryOptions`   | Validation and normalization contract for source trigger discovery.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L95)    |
| `SourceTriggerDiscoveryResult`    | Deterministic source trigger discovery result.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L52)    |
| `SourceTriggerKind`               | Source definition families handled by shared trigger discovery.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L22)    |
| `TriggerDefinitionWithId`         | Minimum contract required for source trigger de-duplication.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L89)    |
| `TriggerDiscoveryOptions`         | Shared filesystem, directory, and source-kind options for trigger discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L73)    |
| `TriggerTarget`                   | Canonical reference to a runnable project definition.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L7)        |
| `TriggerTargetKind`               | Supported local trigger target kinds.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L4)        |
| `TriggerTargetRunResult`          | Successful local trigger target result.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/local-runner.ts#L51) |
