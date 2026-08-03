/**
 * Resource Factory
 *
 * Create MCP resources with data loading and subscription capabilities.
 *
 * @module veryfront/resource
 */

import type { Resource, ResourceConfig } from "./types.ts";
import { createError, toError } from "#veryfront/errors";

/** Create a typed resource definition. */
export function resource<TParams = unknown, TData = unknown>(
  config: ResourceConfig<TParams, TData>,
): Resource<TParams, TData> {
  const pattern = config.pattern ?? generateFallbackPattern();
  const id = resourcePatternToId(pattern);

  return {
    id,
    pattern,
    description: config.description,
    title: config.title,
    paramsSchema: config.paramsSchema,
    load: async (params: TParams): Promise<TData> => {
      try {
        config.paramsSchema.parse(params);
      } catch (error) {
        throw createParamsValidationError(id, error);
      }

      return config.load(params);
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
function generateFallbackPattern(): string {
  return `/resource_${Date.now()}`;
}

/**
 * Convert path pattern to ID
 * Example: "/users/:userId/profile" -> "users_userId_profile"
 */
function resourcePatternToId(pattern: string): string {
  return pattern.replace(/^\//, "").replace(/\//g, "_").replace(/:/g, "");
}

function createParamsValidationError(resourceId: string, cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : String(cause);
  return toError(
    createError({
      type: "agent",
      message: `Resource "${resourceId}" params validation failed: ${message}`,
    }),
  );
}
