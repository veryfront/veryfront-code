---
title: "veryfront/task"
description: "Source-defined tasks for Veryfront projects."
order: 38
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

| Name                                  | Description                                                                                                           | Source                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `deriveTaskId`                        | Derive task ID from file path (e.g., "tasks/sync-data.ts" -&gt; "sync-data").                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts)       |
| `discoverProjectTaskRuntime`          | Discover project tasks and the colocated runtime primitives they may use.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts) |
| `discoverTasks`                       | Discover all tasks in a project with the legacy file-based path.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts)       |
| `findProjectRuntimeTask`              | Find one task by its stable project-runtime ID.                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts) |
| `findTaskById`                        | Find a specific task by ID through the legacy file-based path.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts)       |
| `formatProjectRuntimeDiscoveryErrors` | Format project-runtime discovery failures for CLI and operator diagnostics.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts) |
| `isTaskDefinition`                    | Return true only when the runnable and every declared task metadata field match the public `TaskDefinition` contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/types.ts)           |
| `listProjectRuntimeTasks`             | List project-runtime tasks in deterministic ID order.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts) |
| `runTask`                             | Run a task with the given options                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts)          |

### Types

| Name                          | Description                                                                 | Source                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `DiscoveredTask`              | Discovered task info.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts)       |
| `ProjectTaskRuntimeDiscovery` | Project runtime discovery result used by task lookup and execution helpers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts) |
| `ProjectTaskRuntimeOptions`   | Options for discovering tasks through the unified project runtime.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/project-runtime.ts) |
| `RunnableTask`                |                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts)          |
| `RunTaskOptions`              | Options for running a task                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts)          |
| `TaskContext`                 | Context passed to task run() function                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/types.ts)           |
| `TaskDefinition`              | Task definition exported from a tasks/ file                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/types.ts)           |
| `TaskDiscoveryOptions`        | Options for file-based task discovery.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts)       |
| `TaskDiscoveryResult`         | Result of file-based task discovery.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/discovery.ts)       |
| `TaskRunResult`               | Result of running a task                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/task/runner.ts)          |
