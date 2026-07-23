---
title: "veryfront/trigger"
description: "Shared source-trigger discovery and local execution primitives."
order: 35
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
| `discoverSourceTriggers` | Discover validated source-trigger definitions from one project directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L354) |
| `runTriggerTarget` | Run a validated task or workflow target through project runtime discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/local-runner.ts#L260) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `RunTriggerTargetOptions` | Options for running one discovered trigger target in the local runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/local-runner.ts#L23) |
| `SourceTriggerDiscoveryError` | Sanitized failure reported while discovering one source-defined trigger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L36) |
| `SourceTriggerDiscoveryErrorCode` | Stable classification for a source-trigger discovery failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L26) |
| `SourceTriggerDiscoveryResult` | Definitions and contained failures returned by source-trigger discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L54) |
| `SourceTriggerKind` | Source-defined trigger categories supported by discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L23) |
| `TriggerDefinitionWithId` | Minimum contract required from a discovered trigger definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L78) |
| `TriggerDiscoveryOptions` | Shared options for discovering source-defined schedules or webhooks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L62) |
| `TriggerTarget` | Identifies the runtime primitive that a trigger starts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L7) |
| `TriggerTargetKind` | Trigger target categories supported by source-defined schedules and webhooks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L4) |
| `TriggerTargetRunResult` | Result returned after a local task or workflow target completes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/local-runner.ts#L43) |
