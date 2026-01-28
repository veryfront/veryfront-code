/**
 * Resource Registry
 *
 * Project-scoped registry for MCP resources. Each project has its own
 * isolated resource namespace, preventing cross-project resource access.
 *
 * @module
 */

import type { Resource } from "./types.ts";
import { ProjectScopedRegistryManager } from "#veryfront/ai/registry-manager.ts";

const resourceManager = new ProjectScopedRegistryManager<Resource>("resource");

class ResourceRegistryClass {
  register(id: string, resourceInstance: Resource): void {
    resourceManager.register(id, resourceInstance);
  }

  /**
   * Register a framework-provided resource available to all projects.
   */
  registerShared(id: string, resourceInstance: Resource): void {
    resourceManager.registerShared(id, resourceInstance);
  }

  get(id: string): Resource | undefined {
    return resourceManager.get(id);
  }

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

  getAll(): Map<string, Resource> {
    return resourceManager.getAll();
  }

  list(): string[] {
    return resourceManager.getAllIds();
  }

  has(id: string): boolean {
    return resourceManager.has(id);
  }

  clear(): void {
    resourceManager.clear();
  }

  /**
   * Clear everything (for testing).
   */
  clearAll(): void {
    resourceManager.clearAll();
  }

  getStats() {
    return resourceManager.getStats();
  }
}

// Singleton instance - maintains same interface but now project-scoped internally
export const resourceRegistry = new ResourceRegistryClass();
