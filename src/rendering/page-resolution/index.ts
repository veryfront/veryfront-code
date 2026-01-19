/**
 * Page Resolution Module
 *
 * Exports components for page entity resolution and slug mapping:
 * - PageResolver: Resolves page entities from slugs
 * - SlugMapper: Converts between slugs and file paths
 *
 * This module handles the critical task of mapping URL slugs to
 * file system entities, supporting both App Router and Pages Router modes.
 */

export { PageResolver, type PageResolverOptions } from "./page-resolver.ts";

// Re-export slug mapper utilities from routing package
export {
  extractParams,
  getPathCandidates,
  getSlugFromPath,
  getSupportedExtensions,
  isDynamicRoute,
  matchesPattern,
  normalizeSlug,
  type PathCandidates,
  pathToSlug,
  type RouteParams,
  slugToPath,
} from "#veryfront/routing";
