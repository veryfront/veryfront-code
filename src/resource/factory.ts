/**
 * Resource Factory
 *
 * Create MCP resources with data loading and subscription capabilities.
 *
 * @module veryfront/resource
 */

import type { Resource, ResourceConfig } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

export function resource<TParams = unknown, TData = unknown>(
  config: ResourceConfig<TParams, TData>,
): Resource<TParams, TData> {
  const pattern = config.pattern ?? generateResourcePattern();
  const id = patternToId(pattern);

  return {
    id,
    pattern,
    description: config.description,
    paramsSchema: config.paramsSchema,
    load: async (params: TParams): Promise<TData> => {
      try {
        config.paramsSchema.parse(params);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw toError(
          createError({
            type: "agent",
            message: `Resource "${id}" params validation failed: ${message}`,
          }),
        );
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
 * Auto-discovery is handled by the discovery module which scans
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
  return pattern.replace(/^\//, "").replace(/\//g, "_").replace(/:/g, "");
}
