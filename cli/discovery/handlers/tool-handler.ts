/**
 * Tool Discovery Handler
 */

import type { Tool } from "#veryfront/tool";
import { registerTool } from "#veryfront/mcp";
import type { DiscoveryHandler } from "../types.ts";
import { filenameToId } from "../discovery-utils.ts";

export const toolHandler: DiscoveryHandler<Tool> = {
  typeName: "tool",
  validate: (item): item is Tool =>
    item !== null && typeof item === "object" && typeof (item as Tool).execute === "function",
  getId: (_item, file) => filenameToId(file),
  register: (id, tool) => {
    const toolWithId = { ...tool, id };
    registerTool(id, toolWithId);
    return toolWithId;
  },
  getResultMap: (result) => result.tools,
};
