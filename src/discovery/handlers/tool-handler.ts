/**
 * Tool Discovery Handler
 */

import type { Tool } from "#veryfront/tool";
import { registerTool } from "#veryfront/mcp";
import type { DiscoveryHandler } from "../types.ts";
import { filenameToId } from "../discovery-utils.ts";

function hasGeneratedToolId(id: string | undefined): boolean {
  return typeof id === "string" && /^tool_\d+_\d+$/.test(id);
}

export const toolHandler: DiscoveryHandler<Tool> = {
  typeName: "tool",
  validate: (item): item is Tool =>
    item !== null && typeof item === "object" && typeof (item as Tool).execute === "function",
  getId: (tool, file) => {
    const configuredId = tool.id;
    return typeof configuredId === "string" &&
        configuredId.trim().length > 0 &&
        !hasGeneratedToolId(configuredId)
      ? configuredId
      : filenameToId(file);
  },
  register: (id, tool) => {
    const toolWithId = tool.id === id ? tool : { ...tool, id };
    registerTool(id, toolWithId);
    return toolWithId;
  },
  getResultMap: (result) => result.tools,
};
