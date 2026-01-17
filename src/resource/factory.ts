/**
 * Resource Factory
 *
 * Create MCP resources with data loading and subscription capabilities.
 *
 * @module veryfront/resource
 */

import type { Resource, ResourceConfig } from "./types.ts";
import { createError, toError } from "@veryfront/errors/veryfront-error.ts";

/**
 * Create an MCP resource
 *
 * @example Basic resource
 * ```typescript
 * import { resource } from 'veryfront/resource';
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
 *
 * @example Resource with pattern
 * ```typescript
 * import { resource } from 'veryfront/resource';
 * import { z } from 'zod';
 *
 * export default resource({
 *   pattern: '/users/:userId/profile',
 *   description: 'User profile resource',
 *   paramsSchema: z.object({
 *     userId: z.string(),
 *   }),
 *   load: async ({ userId }) => {
 *     return await getProfile(userId);
 *   },
 * });
 * ```
 *
 * @example Resource with subscription
 * ```typescript
 * import { resource } from 'veryfront/resource';
 * import { z } from 'zod';
 *
 * export default resource({
 *   pattern: '/notifications/:userId',
 *   description: 'User notifications stream',
 *   paramsSchema: z.object({ userId: z.string() }),
 *   load: async ({ userId }) => {
 *     return await getNotifications(userId);
 *   },
 *   subscribe: async function* ({ userId }) {
 *     for await (const notification of notificationStream(userId)) {
 *       yield notification;
 *     }
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
  return pattern
    .replace(/^\//, "")
    .replace(/\//g, "_")
    .replace(/:/g, "");
}
