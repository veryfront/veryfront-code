---
title: "veryfront/task"
description: "Source-defined tasks for Veryfront projects."
order: 31
---

## Import

```ts
import {
  deriveTaskId,
  discoverProjectTaskRuntime,
  discoverTasks,
  findProjectRuntimeTask,
  findTaskById,
  formatProjectRuntimeDiscoveryErrors,
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
| `deriveTaskId` | Derive task ID from file path (e.g., "tasks/sync-data.ts" -> "sync-data"). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L177) |
| `discoverProjectTaskRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L32) |
| `discoverTasks` | Discover all tasks in a project with the legacy file-based path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L193) |
| `findProjectRuntimeTask` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L57) |
| `findTaskById` | Find a specific task by ID through the legacy file-based path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L268) |
| `formatProjectRuntimeDiscoveryErrors` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L26) |
| `isTaskDefinition` | Type guard: checks if a value looks like a TaskDefinition | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/types.ts#L44) |
| `listProjectRuntimeTasks` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L71) |
| `runTask` | Run a task with the given options | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts#L70) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `DiscoveredTask` | Discovered task info. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L49) |
| `ProjectTaskRuntimeOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L12) |
| `RunnableTask` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts#L16) |
| `RunTaskOptions` | Options for running a task | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts#L30) |
| `TaskContext` | Context passed to task run() function | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/types.ts#L12) |
| `TaskDefinition` | Task definition exported from a tasks/ file | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/types.ts#L26) |
| `TaskDiscoveryOptions` | Options for file-based task discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L71) |
| `TaskDiscoveryResult` | Result of file-based task discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L93) |
| `TaskRunResult` | Result of running a task | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts#L53) |
