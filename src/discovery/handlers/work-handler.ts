/**
 * Work Discovery Handler
 */

import type { WorkDefinition } from "#veryfront/work";
import { workRegistry } from "#veryfront/work";
import type { DiscoveryHandler } from "../types.ts";

export const workHandler: DiscoveryHandler<WorkDefinition> = {
  typeName: "work",
  validate: (item): item is WorkDefinition =>
    item !== null &&
    typeof item === "object" &&
    typeof (item as WorkDefinition).id === "string" &&
    typeof (item as WorkDefinition).outcome === "string" &&
    Array.isArray((item as WorkDefinition).acceptanceCriteria),
  getId: (definition) => definition.id,
  register: (id, definition) => {
    const definitionWithId = definition.id === id ? definition : { ...definition, id };
    workRegistry.register(id, definitionWithId);
    return definitionWithId;
  },
  getResultMap: (result) => result.works,
};
