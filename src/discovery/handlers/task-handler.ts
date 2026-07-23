/**
 * Task Discovery Handler
 */

import type { TaskDefinition } from "#veryfront/task/types.ts";
import { hasTaskDefinitionRunMember, normalizeTaskDefinition } from "#veryfront/task/definition.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";
import { normalizeTaskId } from "#veryfront/task/id.ts";
import type { DiscoveryHandler, DiscoveryResult } from "../types.ts";

export const taskHandler: DiscoveryHandler<TaskDefinition> = {
  typeName: "task",
  validate: (item): item is TaskDefinition => {
    try {
      normalizeTaskDefinition(item);
      return true;
    } catch {
      if (hasTaskDefinitionRunMember(item)) {
        throw INITIALIZATION_ERROR.create({
          detail: "Task module exports an invalid task definition.",
        });
      }
      return false;
    }
  },
  getId: (_task, file, dir) => {
    const normalizedFile = file.startsWith("file://") ? file.slice("file://".length) : file;
    const prefix = dir.endsWith("/") ? dir : `${dir}/`;
    const relative = normalizedFile.startsWith(prefix)
      ? normalizedFile.slice(prefix.length)
      : normalizedFile;
    return normalizeTaskId(
      relative.replace(/\.(ts|tsx|js|jsx|mjs)$/, ""),
      "Discovered task id",
    );
  },
  register: (_id, task) => normalizeTaskDefinition(task),
  getResultMap: (result: DiscoveryResult) => result.tasks,
};
