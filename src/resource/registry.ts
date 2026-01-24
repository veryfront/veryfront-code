import type { Resource } from "./types.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";

class ResourceRegistryClass {
  private resources = new Map<string, Resource>();

  register(id: string, resourceInstance: Resource): void {
    if (this.resources.has(id)) {
      agentLogger.debug(`Resource "${id}" is already registered. Overwriting.`);
    }

    this.resources.set(id, resourceInstance);
  }

  get(id: string): Resource | undefined {
    return this.resources.get(id);
  }

  findByPattern(uri: string): Resource | undefined {
    for (const resource of this.resources.values()) {
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

  getAll(): Map<string, Resource> {
    return new Map(this.resources);
  }

  list(): string[] {
    return [...this.resources.keys()];
  }

  has(id: string): boolean {
    return this.resources.has(id);
  }

  clear(): void {
    this.resources.clear();
  }
}

const RESOURCE_REGISTRY_KEY = "__veryfront_resource_registry__";

type GlobalWithRegistry = typeof globalThis & {
  [RESOURCE_REGISTRY_KEY]?: ResourceRegistryClass;
};

const globalWithRegistry = globalThis as GlobalWithRegistry;

export const resourceRegistry: ResourceRegistryClass =
  (globalWithRegistry[RESOURCE_REGISTRY_KEY] ??= new ResourceRegistryClass());
