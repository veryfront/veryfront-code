/**
 * MCP Resource factory and utilities
 */

import type { Resource, ResourceConfig } from "../types/mcp.ts";
import { agentLogger } from "../../core/utils/logger/logger.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

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
export function resource<TParams = any, TData = any>(
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
      agentLogger.warn(`Resource "${id}" is already registered. Overwriting.`);
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
   * Check if URI matches pattern
   * Uses regex-based pattern matching with named capture groups.
   * Supports Express-style patterns like "/users/:userId/profile"
   */
  private matchesPattern(uri: string, pattern: string): boolean {
    const patternRegex = new RegExp(
      "^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$",
    );
    return patternRegex.test(uri);
  }

  /**
   * Extract params from URI using pattern
   */
  extractParams(uri: string, pattern: string): Record<string, string> {
    const patternRegex = new RegExp(
      "^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$",
    );
    const match = uri.match(patternRegex);

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

// Singleton instance
export const resourceRegistry = new ResourceRegistryClass();
