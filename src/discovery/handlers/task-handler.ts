/**
 * Task Discovery Handler
 */

import type { TaskDefinition } from "#veryfront/task/types.ts";
import {
  captureTaskDefinition,
  isTaskDefinitionCandidate,
} from "#veryfront/task/definition-snapshot.ts";
import type { DiscoveryHandler, DiscoveryResult } from "../types.ts";

export const taskHandler: DiscoveryHandler<TaskDefinition, object> = {
  typeName: "task",
  // Registration performs the full metadata validation. Discovery only needs
  // to identify likely task exports so invalid definitions become diagnostics.
  validate: isTaskDefinitionCandidate,
  getId: (_task, file, dir) => {
    const normalizedFile = file.startsWith("file://") ? file.slice("file://".length) : file;
    const prefix = dir.endsWith("/") ? dir : `${dir}/`;
    const relative = normalizedFile.startsWith(prefix)
      ? normalizedFile.slice(prefix.length)
      : normalizedFile;
    return relative.replace(/\.(ts|tsx|js|jsx)$/, "");
  },
  register: (_id, task) => captureTaskDefinition(task),
  getResultMap: (result: DiscoveryResult) => result.tasks,
};
