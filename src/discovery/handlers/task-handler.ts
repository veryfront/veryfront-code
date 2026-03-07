/**
 * Task Discovery Handler
 */

import type { TaskDefinition } from "#veryfront/task/types.ts";
import { isTaskDefinition } from "#veryfront/task/types.ts";
import type { DiscoveryHandler, DiscoveryResult } from "../types.ts";

export const taskHandler: DiscoveryHandler<TaskDefinition> = {
  typeName: "task",
  validate: (item): item is TaskDefinition => isTaskDefinition(item),
  getId: (_task, file, dir) => {
    const prefix = dir.endsWith("/") ? dir : `${dir}/`;
    const relative = file.startsWith(prefix) ? file.slice(prefix.length) : file;
    return relative.replace(/\.(ts|tsx|js|jsx)$/, "");
  },
  register: (_id, task) => task,
  getResultMap: (result: DiscoveryResult) => result.tasks,
};
