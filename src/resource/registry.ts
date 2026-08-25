/****
 * Resource Registry
 *
 * Project-scoped registry for MCP resources. Each project has its own
 * isolated resource namespace, preventing cross-project resource access.
 *
 * @module
 */

import type { Resource } from "./types.ts";
import { matchResourcePattern } from "./pattern.ts";
import { ScopedRegistryFacade } from "#veryfront/registry/scoped-registry-facade.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";

// A resource registry is intentionally heterogeneous: each entry retains its
// own schema-backed parameter and result types at creation time, while lookup
// erases those generics before runtime schema validation.
// deno-lint-ignore no-explicit-any
type RegisteredResource = Resource<any, any>;

const resourceRegistryManager = new ProjectScopedRegistryManager<RegisteredResource>("resource");

class ResourceRegistry extends ScopedRegistryFacade<RegisteredResource> {
  findByPattern(
    uri: string,
    include: (resource: RegisteredResource) => boolean = () => true,
  ): RegisteredResource | undefined {
    const resources = Array.from(this.getAll().values()).filter(include);
    for (const resource of resources) {
      if (resource.pattern === uri) return resource;
    }
    for (const resource of resources) {
      if (this.matchPattern(uri, resource.pattern)) return resource;
    }
    return undefined;
  }

  private matchPattern(uri: string, pattern: string): Record<string, string> | undefined {
    return matchResourcePattern(uri, pattern);
  }

  extractParams(uri: string, pattern: string): Record<string, string> {
    return this.matchPattern(uri, pattern) ?? {};
  }

  list(): string[] {
    return this.getAllIds();
  }
}

/** Shared resource registry value. */
export const resourceRegistry = new ResourceRegistry(resourceRegistryManager);
