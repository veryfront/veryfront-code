/**
 * Veryfront Resource Module
 *
 * Create and manage MCP resources with pattern matching and subscriptions.
 *
 * @example
 * ```typescript
 * import { resource, resourceRegistry } from 'veryfront/resource';
 * import { z } from 'zod';
 *
 * // Create a resource
 * const userProfile = resource({
 *   pattern: '/users/:userId/profile',
 *   description: 'User profile resource',
 *   paramsSchema: z.object({ userId: z.string() }),
 *   load: async ({ userId }) => {
 *     return await db.users.findUnique({ where: { id: userId } });
 *   },
 * });
 *
 * // Register for discovery
 * resourceRegistry.register('userProfile', userProfile);
 *
 * // Find by pattern
 * const found = resourceRegistry.findByPattern('/users/123/profile');
 * const params = resourceRegistry.extractParams('/users/123/profile', found.pattern);
 * // params = { userId: '123' }
 * ```
 *
 * @module veryfront/resource
 */

// Types
export type { Resource, ResourceConfig } from "./types.ts";

// Factory
export { resource } from "./factory.ts";

// Registry
export { resourceRegistry } from "./registry.ts";
