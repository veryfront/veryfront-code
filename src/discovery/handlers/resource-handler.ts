/**
 * Resource Discovery Handler
 */

import type { Resource } from "#veryfront/resource";
import { registerResource } from "#veryfront/mcp";
import {
  assertResourceConfig,
  replaceResourceDefinitionMetadata,
} from "#veryfront/resource/validation.ts";
import type { DiscoveryHandler } from "../types.ts";
import { filenameToId, filePathToPattern } from "../discovery-utils.ts";

function isResource(value: unknown): value is Resource {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<Resource>;
  if (candidate.id !== undefined && typeof candidate.id !== "string") {
    return false;
  }
  try {
    assertResourceConfig(value);
    return true;
  } catch {
    return false;
  }
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
      : replaceResourceDefinitionMetadata(resource, id, pattern);
    registerResource(id, resourceWithMeta);
    return resourceWithMeta;
  },
  getResultMap: (result) => result.resources,
};
