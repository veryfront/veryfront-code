---
title: "veryfront/task"
description: "Source-defined tasks for Veryfront projects."
order: 37
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

| Name                                  | Description                                                                                                           | Source                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `deriveTaskId`                        | Derive task ID from file path (e.g., "tasks/sync-data.ts" -&gt; "sync-data").                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L260)      |
| `discoverProjectTaskRuntime`          | Discover project tasks and the colocated runtime primitives they may use.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L46) |
| `discoverTasks`                       | Discover all tasks in a project with the legacy file-based path.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L275)      |
| `findProjectRuntimeTask`              | Find one task by its stable project-runtime ID.                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L83) |
| `findTaskById`                        | Find a specific task by ID through the legacy file-based path.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L355)      |
| `formatProjectRuntimeDiscoveryErrors` | Format project-runtime discovery failures for CLI and operator diagnostics.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L39) |
| `isTaskDefinition`                    | Return true only when the runnable and every declared task metadata field match the public `TaskDefinition` contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/types.ts#L51)           |
| `listProjectRuntimeTasks`             | List project-runtime tasks in deterministic ID order.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L98) |
| `runTask`                             | Run a task with the given options                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts#L99)          |

### Types

| Name                          | Description                                                                 | Source                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `DiscoveredTask`              | Discovered task info.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L58)       |
| `ProjectTaskRuntimeDiscovery` | Project runtime discovery result used by task lookup and execution helpers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L12) |
| `ProjectTaskRuntimeOptions`   | Options for discovering tasks through the unified project runtime.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts#L15) |
| `RunnableTask`                |                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts#L17)          |
| `RunTaskOptions`              | Options for running a task                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts#L31)          |
| `TaskContext`                 | Context passed to task run() function                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/types.ts#L14)           |
| `TaskDefinition`              | Task definition exported from a tasks/ file                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/types.ts#L30)           |
| `TaskDiscoveryOptions`        | Options for file-based task discovery.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L80)       |
| `TaskDiscoveryResult`         | Result of file-based task discovery.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts#L105)      |
| `TaskRunResult`               | Result of running a task                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts#L57)          |
