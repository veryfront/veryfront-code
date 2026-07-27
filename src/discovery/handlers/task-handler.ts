/**
 * Task Discovery Handler
 */

import type { TaskDefinition } from "#veryfront/task/types.ts";
import { isTaskDefinition } from "#veryfront/task/types.ts";
import { getRelativeDiscoveryPath } from "../discovery-utils.ts";
import type { DiscoveryHandler, DiscoveryResult } from "../types.ts";

export const taskHandler: DiscoveryHandler<TaskDefinition> = {
  typeName: "task",
  validate: (item): item is TaskDefinition => isTaskDefinition(item),
  getId: (_task, file, dir) =>
    getRelativeDiscoveryPath(file, dir).replace(/\.(ts|tsx|js|jsx)$/, ""),
  register: (_id, task) => task,
  getResultMap: (result: DiscoveryResult) => result.tasks,
};
