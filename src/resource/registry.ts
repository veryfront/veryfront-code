/**
 * Resource Registry
 *
 * Global registry for MCP resources with pattern matching.
 *
 * @module veryfront/resource
 */

import type { Resource } from "./types.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";

/**
 * Resource registry for managing resources and pattern matching
 */
class ResourceRegistryClass {
  private resources = new Map<string, Resource>();

  /**
   * Register a resource
   */
  register(id: string, resourceInstance: Resource): void {
    if (this.resources.has(id)) {
      // Debug level - overwriting is expected during hot reload and re-discovery
      agentLogger.debug(`Resource "${id}" is already registered. Overwriting.`);
    }

    this.resources.set(id, resourceInstance);
  }

  /**
   * Get a resource by ID
   */
  get(id: string): Resource | undefined {
    return this.resources.get(id);
  }

  /**
   * Get resource by pattern matching
   */
  findByPattern(uri: string): Resource | undefined {
    for (const resource of this.resources.values()) {
      if (this.matchesPattern(uri, resource.pattern)) {
        return resource;
      }
    }
    return undefined;
  }

  /**
   * Convert Express-style pattern to regex
   * Example: "/users/:userId/profile" -> /^\/users\/(?<userId>[^/]+)\/profile$/
   */
  private patternToRegex(pattern: string): RegExp {
    return new RegExp(
      "^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$",
    );
  }

  /**
   * Check if URI matches pattern
   */
  private matchesPattern(uri: string, pattern: string): boolean {
    return this.patternToRegex(pattern).test(uri);
  }

  /**
   * Extract params from URI using pattern
   */
  extractParams(uri: string, pattern: string): Record<string, string> {
    const match = uri.match(this.patternToRegex(pattern));
    return match?.groups || {};
  }

  /**
   * Get all resources
   */
  getAll(): Map<string, Resource> {
    return new Map(this.resources);
  }

  /**
   * List all resource IDs
   */
  list(): string[] {
    return Array.from(this.resources.keys());
  }

  /**
   * Check if a resource exists
   */
  has(id: string): boolean {
    return this.resources.has(id);
  }

  /**
   * Clear all resources
   */
  clear(): void {
    this.resources.clear();
  }
}

// Singleton instance using globalThis to share across module contexts
// This is necessary for esbuild-bundled API routes to access the same registry
const RESOURCE_REGISTRY_KEY = "__veryfront_resource_registry__";
// deno-lint-ignore no-explicit-any
const _globalResource = globalThis as any;
export const resourceRegistry: ResourceRegistryClass = _globalResource[RESOURCE_REGISTRY_KEY] ||=
  new ResourceRegistryClass();
