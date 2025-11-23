/**
 * App template library modules
 * Provides templates for authentication, user management, and statistics
 * @module cli/templates/app/lib
 */

import type { TemplateFile } from "./types.ts";
import { createAuthTemplate } from "./auth-template.ts";
import { createUsersTemplate } from "./users-template.ts";
import { createStatsTemplate } from "./stats-template.ts";
import { createAuthClientTemplate } from "./auth-client-template.ts";

// Re-export types
export type { TemplateFile } from "./types.ts";

// Re-export template creators
export { createAuthTemplate } from "./auth-template.ts";
export { createUsersTemplate } from "./users-template.ts";
export { createStatsTemplate } from "./stats-template.ts";
export { createAuthClientTemplate } from "./auth-client-template.ts";

/**
 * Creates all library template files for the app template
 *
 * This includes:
 * - Server-side authentication (sessions, tokens)
 * - User management (CRUD, password hashing)
 * - Statistics and activity tracking
 * - Client-side authentication utilities
 *
 * @returns Array of template files for the lib directory
 */
export function createAppLibTemplates(): TemplateFile[] {
  return [
    createAuthTemplate(),
    createUsersTemplate(),
    createStatsTemplate(),
    createAuthClientTemplate(),
  ];
}

/**
 * Default export for backward compatibility
 */
export const appLibTemplates: TemplateFile[] = createAppLibTemplates();
