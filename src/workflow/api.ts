/**
 * Context-Aware API Module
 *
 * Provides framework utilities that automatically use the current tenant context.
 * Tools and workflows can import and use these without passing any context parameters.
 *
 * @example
 * ```typescript
 * import { api } from "veryfront/workflow";
 *
 * const myTool = {
 *   id: "fetch-file",
 *   execute: async (input) => {
 *     // Just use api - it automatically knows the current project
 *     const content = await api.files.read(input.path);
 *     return content;
 *   },
 * };
 * ```
 */

import { getWorkflowTenant } from "./executor/step-executor.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { VeryfrontAPIClient } from "#veryfront/platform/adapters/veryfront-api-client/client.ts";

/**
 * Validate that a project slug is safe and well-formed.
 * Prevents path traversal and injection attacks.
 *
 * Valid slugs: alphanumeric characters, hyphens, underscores
 * Max length: 128 characters
 */
function isValidProjectSlug(slug: string): boolean {
  if (!slug || typeof slug !== "string") {
    return false;
  }

  // Check length
  if (slug.length > 128) {
    return false;
  }

  // Only allow alphanumeric, hyphens, and underscores
  // Must start with alphanumeric
  const validSlugPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
  return validSlugPattern.test(slug);
}

/**
 * Get the current tenant context from either workflow execution or request context.
 * @throws Error if no tenant context is available or if validation fails
 */
function getTenant() {
  // Check workflow context first (for tool execution within workflows)
  // Then fall back to request context (for direct API route calls)
  const tenant = getWorkflowTenant() ?? getCurrentRequestContext();

  if (!tenant) {
    throw new Error(
      "No tenant context available. " +
        "This API must be called within a request or workflow execution. " +
        "If you're calling this from a standalone script, you need to wrap " +
        "your code with runWithContext() first.",
    );
  }

  // Validate tenant fields to prevent injection attacks
  if (!isValidProjectSlug(tenant.projectSlug)) {
    throw new Error(
      `Invalid project slug: "${tenant.projectSlug}". ` +
        "Project slugs must be 1-128 characters, start with alphanumeric, " +
        "and contain only alphanumeric characters, hyphens, or underscores.",
    );
  }

  return tenant;
}

/**
 * Create a VeryfrontAPIClient configured for the current tenant.
 * Each call creates a new client instance configured with the current tenant's credentials.
 */
function getClient(): VeryfrontAPIClient {
  const tenant = getTenant();

  const client = new VeryfrontAPIClient({
    apiBaseUrl: Deno.env.get("VERYFRONT_API_URL") || "https://api.veryfront.com",
    proxyMode: true,
    projectId: tenant.projectId,
    projectSlug: tenant.projectSlug,
  });

  client.setRequestToken(tenant.token);
  client.setProjectSlug(tenant.projectSlug);

  return client;
}

/**
 * Context-aware API that automatically uses the current tenant.
 *
 * All methods will throw an error if called outside of a request or workflow context.
 */
export const api = {
  /**
   * File operations for the current project
   */
  files: {
    /**
     * Read file content by path
     * @param path - File path relative to project root (e.g., "/pages/index.tsx")
     */
    read: (path: string) => {
      getTenant(); // validates context
      return getClient().getFileContent(path);
    },

    /**
     * List files in the project
     * @param options - List options (cursor, limit, pattern)
     */
    list: (options?: { cursor?: string; limit?: number; pattern?: string }) => {
      getTenant(); // validates context
      return getClient().listFiles(options);
    },

    /**
     * List all files in the project (handles pagination automatically)
     */
    listAll: (options?: { limit?: number; pattern?: string }) => {
      getTenant(); // validates context
      return getClient().listAllFiles(options);
    },

    /**
     * Get file details (content + metadata)
     * @param pathOrId - File path or ID
     */
    get: (pathOrId: string) => {
      getTenant(); // validates context
      return getClient().getFile(pathOrId);
    },

    /**
     * Search for files matching a pattern
     * @param pattern - Search pattern (glob-like)
     */
    search: (pattern: string) => {
      getTenant(); // validates context
      return getClient().searchFiles(pattern);
    },
  },

  /**
   * Project operations
   */
  project: {
    /**
     * Get current project details
     */
    get: () => {
      getTenant(); // validates context
      return getClient().getProject();
    },

    /**
     * Get the current project slug
     */
    slug: () => getTenant().projectSlug,

    /**
     * Get the current project ID (if available)
     */
    id: () => getTenant().projectId,

    /**
     * Check if running in production mode
     */
    isProduction: () => getTenant().productionMode,
  },

  /**
   * Get the raw tenant context (for advanced use cases)
   * @internal
   */
  _getTenant: getTenant,

  /**
   * Get a configured API client (for advanced use cases)
   * @internal
   */
  _getClient: getClient,
};
