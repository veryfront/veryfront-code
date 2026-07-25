---
title: "veryfront/trigger"
description: "Shared source-trigger discovery and local execution primitives."
order: 34
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
| `discoverSourceTriggers` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L113) |
| `runTriggerTarget` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/local-runner.ts#L179) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `RunTriggerTargetOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/local-runner.ts#L19) |
| `SourceTriggerDiscoveryError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L26) |
| `SourceTriggerDiscoveryErrorCode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L18) |
| `SourceTriggerDiscoveryResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L36) |
| `SourceTriggerKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L16) |
| `TriggerDefinitionWithId` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L49) |
| `TriggerDiscoveryOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L41) |
| `TriggerTarget` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L3) |
| `TriggerTargetRunResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/local-runner.ts#L32) |
