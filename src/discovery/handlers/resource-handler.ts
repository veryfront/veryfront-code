/**
 * Resource Discovery Handler
 */

import type { Resource } from "#veryfront/resource";
import { registerResource } from "#veryfront/mcp";
import type { DiscoveryHandler } from "../types.ts";
import { filenameToId, filePathToPattern } from "../discovery-utils.ts";

function isResource(value: unknown): value is Resource {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<Resource>;
  if (
    (candidate.id !== undefined && typeof candidate.id !== "string") ||
    (candidate.pattern !== undefined && typeof candidate.pattern !== "string") ||
    typeof candidate.description !== "string" ||
    typeof candidate.load !== "function" ||
    candidate.paramsSchema === null ||
    typeof candidate.paramsSchema !== "object" ||
    typeof candidate.paramsSchema.parse !== "function"
  ) {
    return false;
  }
  if (candidate.title !== undefined && typeof candidate.title !== "string") return false;
  if (candidate.subscribe !== undefined && typeof candidate.subscribe !== "function") return false;
  if (candidate.mcp !== undefined) {
    if (candidate.mcp === null || typeof candidate.mcp !== "object") return false;
    if (
      candidate.mcp.enabled !== undefined &&
      typeof candidate.mcp.enabled !== "boolean"
    ) {
      return false;
    }
    if (
      candidate.mcp.cachePolicy !== undefined &&
      !["no-cache", "cache", "cache-first"].includes(candidate.mcp.cachePolicy)
    ) {
      return false;
    }
  }
  return true;
}

function hasGeneratedResourcePattern(resource: Resource): boolean {
  return typeof resource.__veryfrontGeneratedPattern === "string" &&
    resource.pattern === resource.__veryfrontGeneratedPattern;
}

function hasExplicitResourcePattern(resource: Resource): boolean {
  return typeof resource.pattern === "string" &&
    resource.pattern.length > 0 &&
    !hasGeneratedResourcePattern(resource);
}

export const resourceHandler: DiscoveryHandler<Resource> = {
  typeName: "resource",
  validate: isResource,
  getId: (_item, file) => filenameToId(file),
  register: (id, resource, file, dir) => {
    const pattern = hasExplicitResourcePattern(resource)
      ? resource.pattern
      : filePathToPattern(file, dir);
    const resourceWithMeta = resource.id === id && resource.pattern === pattern
      ? resource
      : { ...resource, id, pattern };
    registerResource(id, resourceWithMeta);
    return resourceWithMeta;
  },
  getResultMap: (result) => result.resources,
};
