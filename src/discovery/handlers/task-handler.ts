/**
 * Task Discovery Handler
 */

import type { TaskDefinition } from "#veryfront/task/types.ts";
import {
  captureTaskDefinition,
  isTaskDefinitionCandidate,
} from "#veryfront/task/definition-snapshot.ts";
import type { DiscoveryHandler, DiscoveryResult } from "../types.ts";

export const taskHandler: DiscoveryHandler<TaskDefinition, object, TaskDefinition> = {
  typeName: "task",
  // Validate before ID fallback selection so malformed siblings cannot change
  // the stable file-derived ID of the only valid task in a module.
  validate: isTaskDefinitionCandidate,
  prepare: captureTaskDefinition,
  getId: (_task, file, dir) => {
    const normalizedFile = file.startsWith("file://") ? file.slice("file://".length) : file;
    const prefix = dir.endsWith("/") ? dir : `${dir}/`;
    const relative = normalizedFile.startsWith(prefix)
      ? normalizedFile.slice(prefix.length)
      : normalizedFile;
    return relative.replace(/\.(ts|tsx|js|jsx)$/, "");
  },
  register: (_id, task, _file, _dir, _exportName, prepared) =>
    prepared ?? captureTaskDefinition(task),
  getResultMap: (result: DiscoveryResult) => result.tasks,
};
