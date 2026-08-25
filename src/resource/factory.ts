/**
 * Resource Factory
 *
 * Create MCP resources with data loading and subscription capabilities.
 *
 * @module veryfront/resource
 */

import type { Resource, ResourceConfig } from "./types.ts";
import { createError, toError } from "#veryfront/errors";
import { validateResourcePatternParameters } from "./pattern.ts";

let generatedResourcePatternCounter = 0;

/** Create a typed resource definition with unique URI-template parameter names. */
export function resource<TParams = unknown, TData = unknown>(
  config: ResourceConfig<TParams, TData>,
): Resource<TParams, TData> {
  const pattern = config.pattern ?? generateFallbackPattern();
  assertUniqueParameterNames(pattern);
  const id = resourcePatternToId(pattern);
  const paramsSchema = config.paramsSchema;
  const parseParams = paramsSchema.parse;
  const load = config.load;
  const subscribe = config.subscribe;

  const validateParams = (params: TParams): TParams => {
    try {
      return Reflect.apply(parseParams, paramsSchema, [params]) as TParams;
    } catch (error) {
      throw createParamsValidationError(id, error);
    }
  };

  return {
    id,
    pattern,
    description: config.description,
    title: config.title,
    paramsSchema,
    load: async (params: TParams): Promise<TData> => {
      return Reflect.apply(load, config, [validateParams(params)]);
    },
    subscribe: subscribe === undefined
      ? undefined
      : (params: TParams) => Reflect.apply(subscribe, config, [validateParams(params)]),
    mcp: config.mcp,
  };
}

function assertUniqueParameterNames(pattern: string): void {
  const seen = new Set<string>();
  for (const name of validateResourcePatternParameters(pattern)) {
    if (seen.has(name)) {
      throw new TypeError(`Resource pattern contains duplicate parameter name "${name}"`);
    }
    seen.add(name);
  }
}

/**
 * Generate resource pattern fallback
 * Note: In practice, resources should explicitly define their pattern.
 * Auto-discovery is handled by the discovery module which scans
 * the filesystem and extracts patterns from resource definitions.
 */
function generateFallbackPattern(): string {
  return `/resource_${Date.now()}_${generatedResourcePatternCounter++}`;
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
