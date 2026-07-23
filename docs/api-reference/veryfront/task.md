---
title: "veryfront/task"
description: "Source-defined tasks for Veryfront projects."
order: 32
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
| `deriveTaskId` | Derive task ID from file path (e.g., "tasks/sync-data.ts" -> "sync-data"). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L401) |
| `discoverProjectTaskRuntime` | Discover tasks and related runtime primitives from one project source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L338) |
| `discoverTasks` | Discover all tasks in a project with the legacy file-based path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L418) |
| `findProjectRuntimeTask` | Find and detach one canonical task from project runtime discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L365) |
| `findTaskById` | Find a specific task by ID through the legacy file-based path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L507) |
| `formatProjectRuntimeDiscoveryErrors` | Format project discovery failures as bounded project-relative lines. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L289) |
| `isTaskDefinition` | Return whether a value satisfies the complete task definition contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/types.ts#L40) |
| `listProjectRuntimeTasks` | List detached canonical project tasks in stable ID order. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L390) |
| `runTask` | Validate the invocation and run a task with an isolated context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts#L309) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `DiscoveredTask` | Discovered task info. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L50) |
| `ProjectTaskCollection` | Project task definitions required by task lookup and listing helpers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L47) |
| `ProjectTaskDiscoveryError` | A contained source failure returned by project runtime discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L53) |
| `ProjectTaskRuntimeOptions` | Options for discovering tasks through the complete project runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L29) |
| `RunnableTask` | A validated task selected for execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts#L25) |
| `RunTaskOptions` | Options for running one task invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts#L37) |
| `TaskContext` | Context passed to a task's `run` function. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/types.ts#L12) |
| `TaskDefinition` | Task definition exported from a file under `tasks/`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/types.ts#L24) |
| `TaskDiscoveryError` | A contained failure encountered during legacy task discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L93) |
| `TaskDiscoveryOptions` | Options for file-based task discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L72) |
| `TaskDiscoveryResult` | Result of file-based task discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L105) |
| `TaskRunResult` | Result returned after task execution settles. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts#L58) |
