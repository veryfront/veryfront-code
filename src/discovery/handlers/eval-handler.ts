/**
 * Eval Discovery Handler
 */

import type { EvalDefinition } from "#veryfront/eval";
import { deriveEvalId, isEvalDefinition } from "#veryfront/eval";
import type { DiscoveryHandler, DiscoveryResult } from "../types.ts";

export const evalHandler: DiscoveryHandler<EvalDefinition> = {
  typeName: "eval",
  validate: (item): item is EvalDefinition => isEvalDefinition(item),
  getId: (definition, file, dir) => definition.id || deriveEvalId(file, dir),
  register: (id, definition, file, _dir, exportName = "default") => ({
    ...definition,
    id,
    name: definition.name || id,
    source: definition.source ?? { filePath: file, exportName },
  }),
  getResultMap: (result: DiscoveryResult) => result.evals,
};
