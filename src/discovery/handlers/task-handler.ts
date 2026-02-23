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
    // Derive ID from file path relative to tasks dir
    let relative = file;
    const prefix = dir.endsWith("/") ? dir : `${dir}/`;
    if (relative.startsWith(prefix)) {
      relative = relative.slice(prefix.length);
    }
    return relative.replace(/\.(ts|tsx|js|jsx)$/, "");
  },
  register: (_id, task) => task,
  getResultMap: (result: DiscoveryResult) => result.tasks,
};
