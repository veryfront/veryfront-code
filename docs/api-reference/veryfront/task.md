---
title: "veryfront/task"
description: "Source-defined tasks for Veryfront projects."
order: 31
---

## Import

```ts
import {
  deriveTaskId,
  discoverTasks,
  findTaskById,
  isTaskDefinition,
  runTask,
} from "veryfront/task";
```

## Examples

### Define a task in tasks/sync-data.ts

```ts
import type { TaskContext } from "veryfront/task";

export default {
  name: "Sync external data",
  async run(ctx: TaskContext) {
    return { synced: 42 };
  },
};
```

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `deriveTaskId` | Derive task ID from file path (e.g., "tasks/sync-data.ts" → "sync-data") | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L166) |
| `discoverTasks` | Discover all tasks in a project | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L180) |
| `findTaskById` | Find a specific task by ID, short-circuiting discovery once found. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L252) |
| `isTaskDefinition` | Type guard: checks if a value looks like a TaskDefinition | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/types.ts#L42) |
| `runTask` | Run a task with the given options | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts#L56) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `DiscoveredTask` | Discovered task info | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L45) |
| `RunTaskOptions` | Options for running a task | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts#L19) |
| `TaskContext` | Context passed to task run() function | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/types.ts#L12) |
| `TaskDefinition` | Task definition exported from a tasks/ file | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/types.ts#L24) |
| `TaskDiscoveryOptions` | Options for task discovery | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L65) |
| `TaskDiscoveryResult` | Result of task discovery | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L85) |
| `TaskRunResult` | Result of running a task | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts#L39) |
