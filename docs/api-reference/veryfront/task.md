---
title: "veryfront/task"
description: "Source-defined tasks for Veryfront projects."
order: 34
---

## Import

```ts
import {
  discoverProjectTaskRuntime,
  findProjectRuntimeTask,
  formatProjectRuntimeDiscoveryErrors,
  isTaskDefinition,
  listProjectRuntimeTasks,
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
| `deriveTaskId` | **Deprecated:** Use project runtime task IDs from `discoverProjectTaskRuntime` instead. Derive task ID from file path (e.g., "tasks/sync-data.ts" -&gt; "sync-data"). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L224) |
| `discoverProjectTaskRuntime` | Discover project tasks and the colocated runtime primitives they may use. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L45) |
| `discoverTasks` | **Deprecated:** Use `discoverProjectTaskRuntime` instead. Discover all tasks in a project with the legacy file-based path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L239) |
| `findProjectRuntimeTask` | Find one task by its stable project-runtime ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L81) |
| `findTaskById` | **Deprecated:** Use `discoverProjectTaskRuntime` and `findProjectRuntimeTask` instead. Find a specific task by ID through the legacy file-based path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L313) |
| `formatProjectRuntimeDiscoveryErrors` | Format project-runtime discovery failures for CLI and operator diagnostics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L38) |
| `isTaskDefinition` | Return true only when the runnable and every declared task metadata field match the public `TaskDefinition` contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/types.ts#L61) |
| `listProjectRuntimeTasks` | List project-runtime tasks in deterministic ID order. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L96) |
| `runTask` | Run a task with the given options | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts#L77) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `DiscoveredTask` | **Deprecated:** Use project runtime discovery helpers from `veryfront/task` instead. Runtime discovery keeps tasks, tools, agents, and cloud runs on the same project discovery path. Discovered task info. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L50) |
| `ProjectTaskRuntimeDiscovery` | Project runtime discovery result used by task lookup and execution helpers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L13) |
| `ProjectTaskRuntimeOptions` | Options for discovering tasks through the unified project runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L16) |
| `RunnableTask` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts#L16) |
| `RunTaskOptions` | Options for running a task | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts#L30) |
| `TaskContext` | Context passed to task run() function | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/types.ts#L12) |
| `TaskDefinition` | Task definition exported from a tasks/ file | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/types.ts#L28) |
| `TaskDiscoveryOptions` | **Deprecated:** Use `discoverProjectTaskRuntime` instead. Options for file-based task discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L72) |
| `TaskDiscoveryResult` | **Deprecated:** Use `DiscoveryResult` from project runtime discovery instead. Result of file-based task discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L94) |
| `TaskRunResult` | Result of running a task | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts#L56) |
