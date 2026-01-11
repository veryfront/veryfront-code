/**
 * MCP Resource factory and utilities
 */

import type { Resource, ResourceConfig } from "../types/mcp.ts";
import { agentLogger } from "@veryfront/utils/logger/logger.ts";
import { createError, toError } from "@veryfront/errors/veryfront-error.ts";

/**
 * Create an MCP resource
 *
 * @example
 * ```typescript
 * import { resource } from 'veryfront/ai';
 * import { z } from 'zod';

 *
 * export default resource({
 *   description: 'Get user profile',
 *   paramsSchema: z.object({
 *     userId: z.string(),
 *   }),
 *   load: async ({ userId }) => {
 *     return await db.users.findUnique({ where: { id: userId } });
 *   },
 * });
 * ```
 */
export function resource<TParams = unknown, TData = unknown>(
  config: ResourceConfig<TParams, TData>,
): Resource<TParams, TData> {
  // Generate pattern if not provided
  const pattern = config.pattern || generateResourcePattern();

  // Generate ID from pattern
  const id = patternToId(pattern);

  return {
    id,
    pattern,
    description: config.description,
    paramsSchema: config.paramsSchema,
    load: async (params: TParams) => {
      // Validate params
      try {
        config.paramsSchema.parse(params);
      } catch (error) {
        throw toError(createError({
          type: "agent",
          message: `Resource "${id}" params validation failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }));
      }

      return await config.load(params);
    },
    subscribe: config.subscribe,
    mcp: config.mcp,
  };
}

/**
 * Generate resource pattern fallback
 * Note: In practice, resources should explicitly define their pattern.
 * Auto-discovery is handled by the discovery.ts module which scans
 * the filesystem and extracts patterns from resource definitions.
 */
function generateResourcePattern(): string {
  return `/resource_${Date.now()}`;
}

/**
 * Convert path pattern to ID
 * Example: "/users/:userId/profile" -> "users_userId_profile"
 */
function patternToId(pattern: string): string {
  return pattern
    .replace(/^\//, "")
    .replace(/\//g, "_")
    .replace(/:/g, "");
}

/**
 * Resource registry
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
