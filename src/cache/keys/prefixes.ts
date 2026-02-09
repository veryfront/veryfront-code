/********************************************************************************
 * Cache Key Prefixes
 *
 * All cache key prefix constants used across the system.
 *
 * @module core/cache/keys/prefixes
 ********************************************************************************/

export const CacheKeyPrefix = {
  // Redis prefixes (include trailing colon for direct concatenation)
  SSR_MODULE: "veryfront:ssr-module:",
  FILE_CACHE: "veryfront:file-cache:",
  TRANSFORM: "veryfront:transform:",

  // Memory cache prefixes
  CONFIG: "config",
  CONFIG_VIRTUAL: "vf", // For virtual filesystem (API-backed) projects

  // File operation prefixes
  FILE: "file",
  STAT: "stat",
  DIR: "dir",
  FILES: "files",

  // GitHub adapter prefixes
  GITHUB_CONTENT: "github:content",
  GITHUB_BYTES: "github:bytes",
  GITHUB_DIR: "github:dir",
  GITHUB_STAT: "github:stat",
  GITHUB_TREE: "github:tree",
  GITHUB_RESOLVE: "github:resolve",

  // Module system prefixes
  MODULE_RESOLVE: "resolve",
  MODULE_PATH: "veryfront",
  SSR_VERSION: "v", // Version prefix for SSR module cache keys

  // Component cache prefixes
  COMPONENT: "component",
  LAYOUT: "layout",

  // Server-side prefixes
  ERROR_PAGE: "error",
  PROXY: "proxy",

  // Project prefixes
  PROJECT: "project",

  // Styles prefixes
  GLOBALS_CSS: "globals",
} as const;

export type FileSourceType = "branch" | "release" | "environment";

/**
 * Query parameter handling policy for cache keys.
 *
 * - "ignore-all": Ignore all query params (best for marketing UTM params)
 * - "include-all": Include all query params in cache key (default behavior)
 * - "include-list": Only include specified params
 * - "exclude-list": Include all except specified params
 */
export type QueryParamPolicy = "ignore-all" | "include-all" | "include-list" | "exclude-list";

export interface QueryParamCacheOptions {
  /** How to handle query params. Default: "include-all" */
  policy?: QueryParamPolicy;
  /** List of param names for include-list or exclude-list policies */
  params?: string[];
}

export interface FileOperationContext {
  sourceType: FileSourceType;
  projectSlug: string;
  branch?: string | null;
  releaseId?: string | null;
  environmentName?: string | null;
}

export interface TransformCacheKeyOptions {
  filePath: string;
  contentHash: string;
  ssr?: boolean;
  studioEmbed?: boolean;
  /** Hash of transitive dependencies (for invalidation when deps change) */
  depsHash?: string;
  /** Hash of transform-affecting config (for invalidation when config changes) */
  configHash?: string;
  /** Project ID for multi-tenant isolation */
  projectId?: string;
}

/** Default marketing params to exclude (common tracking params that don't affect content) */
export const DEFAULT_EXCLUDED_QUERY_PARAMS = [
  // UTM tracking
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  // HubSpot
  "_hsenc",
  "_hsmi",
  "hsCtaTracking",
  // Google Analytics / Ads
  "gclid",
  "gclsrc",
  "dclid",
  "_ga",
  "_gl",
  // Facebook
  "fbclid",
  "fb_action_ids",
  "fb_action_types",
  // Microsoft / Bing
  "msclkid",
  // Mailchimp
  "mc_cid",
  "mc_eid",
  // Other tracking
  "ref",
  "referrer",
  "source",
  "_openstat",
  "yclid",
  "zanpid",
];
