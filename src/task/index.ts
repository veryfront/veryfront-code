/**
 * Task system public exports.
 * @module
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
