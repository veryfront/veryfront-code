---
title: "veryfront/trigger"
description: "Shared source-trigger discovery and local execution primitives."
order: 33
---

## Import

```ts
import { discoverSourceTriggers, runTriggerTarget } from "veryfront/trigger";
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

| Name | Description | Source |
|------|-------------|--------|
| `discoverSourceTriggers` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L112) |
| `runTriggerTarget` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/local-runner.ts#L114) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `RunTriggerTargetOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/local-runner.ts#L10) |
| `SourceTriggerDiscoveryError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L25) |
| `SourceTriggerDiscoveryErrorCode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L17) |
| `SourceTriggerDiscoveryResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L35) |
| `SourceTriggerKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L15) |
| `TriggerDefinitionWithId` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L48) |
| `TriggerDiscoveryOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L40) |
| `TriggerTarget` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L2) |
| `TriggerTargetRunResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/local-runner.ts#L20) |
