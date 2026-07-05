/**
 * Source-defined tasks for Veryfront projects.
 *
 * @module task
 *
 * @example Define a task in tasks/sync-data.ts
 * ```ts
 * import type { TaskContext } from "veryfront/task";
 *
 * export default {
 *   name: "Sync external data",
 *   async run(ctx: TaskContext) {
 *     return { synced: 42 };
 *   },
 * };
 * ```
 */
export type { TaskContext, TaskDefinition } from "./types.ts";
export { isTaskDefinition } from "./types.ts";
export { deriveTaskId, discoverTasks, findTaskById } from "./discovery.ts";
export type { DiscoveredTask, TaskDiscoveryOptions, TaskDiscoveryResult } from "./discovery.ts";
export { runTask } from "./runner.ts";
export type { RunnableTask, RunTaskOptions, TaskRunResult } from "./runner.ts";
export {
  discoverProjectTaskRuntime,
  findProjectRuntimeTask,
  formatProjectRuntimeDiscoveryErrors,
  listProjectRuntimeTasks,
} from "./project-runtime.ts";
export type { ProjectTaskRuntimeOptions } from "./project-runtime.ts";
