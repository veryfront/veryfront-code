/**
 * Resource Discovery Handler
 */

import type { Resource, ResourceConfig, ResourceDefinition } from "#veryfront/resource";
import { registerResource } from "#veryfront/mcp";
import {
  assertResourceConfig,
  normalizeResourceDefinition,
  replaceResourceDefinitionMetadata,
} from "#veryfront/resource/validation.ts";
import type { DiscoveryHandler } from "../types.ts";
import { filenameToId, filePathToPattern } from "../discovery-utils.ts";

// Discovery collects heterogeneous authored definitions. Parameter erasure is
// confined to this validation boundary; loaders are never invoked until the
// definition has been normalized and runtime parameters have been validated.
// deno-lint-ignore no-explicit-any
interface DiscoverableResource extends ResourceConfig<any, unknown> {
  readonly id?: string;
  readonly __veryfrontGeneratedPattern?: string;
}

function isResource(value: unknown): value is DiscoverableResource {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<DiscoverableResource>;
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

function hasGeneratedResourcePattern(resource: DiscoverableResource): boolean {
  return typeof resource.__veryfrontGeneratedPattern === "string" &&
    resource.pattern === resource.__veryfrontGeneratedPattern;
}

function hasExplicitResourcePattern(
  resource: DiscoverableResource,
): resource is DiscoverableResource & { readonly pattern: string } {
  return typeof resource.pattern === "string" &&
    resource.pattern.length > 0 &&
    !hasGeneratedResourcePattern(resource);
}

function hasResourceIdentity(
  resource: DiscoverableResource,
  id: string,
  pattern: string,
): resource is ResourceDefinition {
  return resource.id === id && resource.pattern === pattern;
}

export const resourceHandler: DiscoveryHandler<DiscoverableResource, Resource> = {
  typeName: "resource",
  validate: isResource,
  getId: (_item, file) => filenameToId(file),
  register: (id, resource, file, dir) => {
    const pattern = hasExplicitResourcePattern(resource)
      ? resource.pattern
      : filePathToPattern(file, dir);
    const resourceWithMeta = hasResourceIdentity(resource, id, pattern)
      ? normalizeResourceDefinition(resource)
      : replaceResourceDefinitionMetadata(resource, id, pattern);
    registerResource(id, resourceWithMeta);
    return resourceWithMeta;
  },
  getResultMap: (result) => result.resources,
};
