/**
 * Resource Factory
 *
 * Create MCP resources with data loading and subscription capabilities.
 *
 * @module veryfront/resource
 */

import type { Resource, ResourceConfig } from "./types.ts";
import { compileResourcePattern } from "./pattern.ts";
import { assertResourceConfig, createResourceDefinition } from "./validation.ts";

let resourcePatternCounter = 0;

/** Create a typed resource definition. */
export function resource<TParams = unknown, TData = unknown>(
  config: ResourceConfig<TParams, TData>,
): Resource<TParams, TData> {
  // Validate before reading optional fields so malformed JavaScript callers
  // fail at the construction boundary rather than producing a partial value.
  assertResourceConfig(config);
  const pattern = config.pattern ?? generateFallbackPattern();
  const generatedPattern = config.pattern === undefined ? pattern : undefined;
  compileResourcePattern(pattern);
  const id = resourcePatternToId(pattern);

  return createResourceDefinition({
    id,
    pattern,
    generatedPattern,
    config,
  });
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
