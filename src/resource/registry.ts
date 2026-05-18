/****
 * Resource Registry
 *
 * Project-scoped registry for MCP resources. Each project has its own
 * isolated resource namespace, preventing cross-project resource access.
 *
 * @module
 */

import type { Resource } from "./types.ts";
import { ScopedRegistryFacade } from "#veryfront/registry/scoped-registry-facade.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";

const resourceRegistryManager = new ProjectScopedRegistryManager<Resource>("resource");

class ResourceRegistry extends ScopedRegistryFacade<Resource> {
  findByPattern(uri: string): Resource | undefined {
    for (const resource of this.getAll().values()) {
      if (this.matchPattern(uri, resource.pattern)) return resource;
    }
    return undefined;
  }

  private patternToRegex(pattern: string): RegExp {
    return new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`);
  }

  private matchPattern(uri: string, pattern: string): RegExpMatchArray | null {
    return uri.match(this.patternToRegex(pattern));
  }

  extractParams(uri: string, pattern: string): Record<string, string> {
    return this.matchPattern(uri, pattern)?.groups ?? {};
  }

  list(): string[] {
    return this.getAllIds();
  }
}

/** Shared resource registry value. */
export const resourceRegistry = new ResourceRegistry(resourceRegistryManager);
