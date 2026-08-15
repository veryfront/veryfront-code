---
title: "veryfront/trigger"
description: "Shared source-trigger discovery and local execution primitives."
order: 39
---

## Import

```ts
import {
  conversationConflictDiagnostic,
  declarationConflictDiagnostic,
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

| Name                             | Description                                                                                   | Source                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `conversationConflictDiagnostic` | Describe a conversation pair that disagrees across two locations.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L170)       |
| `declarationConflictDiagnostic`  | Describe one value declared in two places with disagreeing content.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L151)       |
| `discoverSourceTriggers`         | Discover, validate, normalize, and deterministically de-duplicate source trigger definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L354)    |
| `isTriggerId`                    | Return true for a bounded canonical slash-separated trigger identifier.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/validation.ts#L8)     |
| `isTriggerTarget`                | Return true only for canonical targets stored in own data properties.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L304)       |
| `runTriggerTarget`               | Discover and execute one canonical task, workflow, or agent target.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/local-runner.ts#L367) |

### Types

| Name                              | Description                                                                         | Source                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `AgentConversationMode`           | Hosted conversation behavior for an agent trigger target.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L4)        |
| `AgentTriggerTarget`              | Trigger target addressing an agent definition and its hosted conversation.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L31)       |
| `ResolvedTriggerTarget`           | Validated target value that narrows conversation fields by `kind`.                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L58)       |
| `RunTriggerTargetOptions`         | Options for one local trigger target execution.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/local-runner.ts#L30) |
| `SourceTriggerDiscoveryError`     | Structured failure produced while discovering one source definition.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L34)    |
| `SourceTriggerDiscoveryErrorCode` | Stable failure categories emitted while discovering source triggers.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L25)    |
| `SourceTriggerDiscoveryOptions`   | Validation and normalization contract for source trigger discovery.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L95)    |
| `SourceTriggerDiscoveryResult`    | Deterministic source trigger discovery result.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L52)    |
| `SourceTriggerKind`               | Source definition families handled by shared trigger discovery.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L22)    |
| `TaskTriggerTarget`               | Trigger target addressing a task definition.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L7)        |
| `TriggerDefinitionWithId`         | Minimum contract required for source trigger de-duplication.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L89)    |
| `TriggerDiscoveryOptions`         | Shared filesystem, directory, and source-kind options for trigger discovery.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L73)    |
| `TriggerTarget`                   | Canonical reference to a runnable project definition.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L43)       |
| `TriggerTargetConfig`             | Author-facing target shape accepting stored base values and kind-specific literals. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L51)       |
| `TriggerTargetKind`               | Supported local trigger target kinds.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L64)       |
| `TriggerTargetRunResult`          | Successful local trigger target result.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/local-runner.ts#L56) |
| `WorkflowTriggerTarget`           | Trigger target addressing a workflow definition.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L19)       |
