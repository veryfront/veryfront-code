/**
 * Resource Discovery Handler
 */

import type { Resource } from "#veryfront/resource";
import { registerResource } from "#veryfront/mcp";
import type { DiscoveryHandler } from "../types.ts";
import { filenameToId, filePathToPattern } from "../discovery-utils.ts";

export const resourceHandler: DiscoveryHandler<Resource> = {
  typeName: "resource",
  validate: (item): item is Resource =>
    item !== null && typeof item === "object" && typeof (item as Resource).load === "function",
  getId: (_item, file) => filenameToId(file),
  register: (id, resource, file, dir) => {
    const pattern = filePathToPattern(file, dir);
    const resourceWithMeta = { ...resource, id, pattern };
    registerResource(id, resourceWithMeta);
    return resourceWithMeta;
  },
  getResultMap: (result) => result.resources,
};
