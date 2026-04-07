/**
 * Tool Discovery Handler
 */

import type { Tool } from "#veryfront/tool";
import { registerTool } from "#veryfront/mcp";
import type { DiscoveryHandler } from "../types.ts";
import { filenameToId } from "../discovery-utils.ts";

function hasGeneratedToolId(tool: Tool): boolean {
  return typeof tool.__veryfrontGeneratedId === "string" &&
    tool.id === tool.__veryfrontGeneratedId;
}

export const toolHandler: DiscoveryHandler<Tool> = {
  typeName: "tool",
  validate: (item): item is Tool =>
    item !== null && typeof item === "object" && typeof (item as Tool).execute === "function",
  getId: (tool, file) => {
    return typeof tool.id === "string" &&
        tool.id.trim().length > 0 &&
        !hasGeneratedToolId(tool)
      ? tool.id
      : filenameToId(file);
  },
  register: (id, tool) => {
    const toolWithId = tool.id === id ? tool : { ...tool, id };
    registerTool(id, toolWithId);
    return toolWithId;
  },
  getResultMap: (result) => result.tools,
};
