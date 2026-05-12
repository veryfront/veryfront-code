/**
 * Example resource: User profile
 * Will be auto-discovered with pattern: /users/:userId/profile
 */

import { resource } from "veryfront/resource";
import { defineSchema } from "#veryfront/schemas/index.ts";

export default resource({
  description: "Get user profile information",
  paramsSchema: defineSchema((v) =>
    v.object({
      userId: v.string(),
    })
  )(),
  load: async ({ userId }) => {
    // Mock user data
    return {
      id: userId,
      name: `User ${userId}`,
      email: `user${userId}@example.com`,
      role: "developer",
      joinedAt: "2025-01-01",
    };
  },
});
