/**
 * Resource Factory
 *
 * Create MCP resources with data loading and subscription capabilities.
 *
 * @module veryfront/resource
 */

import type { Resource, ResourceConfig } from "./types.ts";
import { compileResourcePattern } from "./pattern.ts";
import { ResourceParamsValidationError } from "./errors.ts";

let resourcePatternCounter = 0;

/** Create a typed resource definition. */
export function resource<TParams = unknown, TData = unknown>(
  config: ResourceConfig<TParams, TData>,
): Resource<TParams, TData> {
  const pattern = config.pattern ?? generateFallbackPattern();
  const generatedPattern = config.pattern === undefined ? pattern : undefined;
  compileResourcePattern(pattern);
  const id = resourcePatternToId(pattern);

  const validateParams = (params: TParams): TParams => {
    try {
      return config.paramsSchema.parse(params);
    } catch (error) {
      throw createParamsValidationError(id, error);
    }
  };

  const created: Resource<TParams, TData> = {
    id,
    pattern,
    description: config.description,
    title: config.title,
    paramsSchema: config.paramsSchema,
    load: async (params: TParams): Promise<TData> => {
      return config.load(validateParams(params));
    },
    subscribe: config.subscribe
      ? (params: TParams) => config.subscribe!(validateParams(params))
      : undefined,
    mcp: config.mcp,
  };
  return generatedPattern === undefined
    ? created
    : { ...created, __veryfrontGeneratedPattern: generatedPattern };
}

/**
 * Generate resource pattern fallback
 * Note: In practice, resources should explicitly define their pattern.
 * Auto-discovery is handled by the discovery module which scans
 * the filesystem and extracts patterns from resource definitions.
 */
function generateFallbackPattern(): string {
  return `/resource_${Date.now()}_${resourcePatternCounter++}`;
}

/**
 * Convert path pattern to ID
 * Example: "/users/:userId/profile" -> "users_userId_profile"
 */
function resourcePatternToId(pattern: string): string {
  return pattern.replace(/^\//, "").replace(/\//g, "_").replace(/:/g, "");
}

function createParamsValidationError(resourceId: string, cause: unknown): Error {
  return new ResourceParamsValidationError(resourceId, cause);
}
