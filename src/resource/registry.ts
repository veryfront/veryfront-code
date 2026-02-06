/****
 * Resource Registry
 *
 * Project-scoped registry for MCP resources. Each project has its own
 * isolated resource namespace, preventing cross-project resource access.
 *
 * @module
 */

import type { Resource } from "./types.ts";
import { ProjectScopedRegistryManager } from "#veryfront/ai/registry-manager.ts";
import { ScopedRegistryFacade } from "#veryfront/ai/registry-facade.ts";

const resourceManager = new ProjectScopedRegistryManager<Resource>("resource");

class ResourceRegistryClass extends ScopedRegistryFacade<Resource> {
  findByPattern(uri: string): Resource | undefined {
    for (const resource of this.getAll().values()) {
      if (this.matchesPattern(uri, resource.pattern)) return resource;
    }
    return undefined;
  }

  private patternToRegex(pattern: string): RegExp {
    return new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`);
  }

  private matchesPattern(uri: string, pattern: string): boolean {
    return this.patternToRegex(pattern).test(uri);
  }

  extractParams(uri: string, pattern: string): Record<string, string> {
    return uri.match(this.patternToRegex(pattern))?.groups ?? {};
  }

  list(): string[] {
    return this.getAllIds();
  }
}

export const resourceRegistry = new ResourceRegistryClass(resourceManager);
