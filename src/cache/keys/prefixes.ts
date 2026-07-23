/********************************************************************************
 * Cache Key Prefixes
 *
 * All cache key prefix constants used across the system.
 *
 * @module core/cache/keys/prefixes
 ********************************************************************************/

export const CacheKeyPrefix = Object.freeze(
  {
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
  } as const,
);

/** Content source kinds supported by file-operation cache keys. */
export type FileSourceType = "branch" | "release" | "environment";

/**
 * Query parameter handling policy for cache keys.
 *
 * - "ignore-all": Ignore all query params (best for marketing UTM params)
 * - "include-all": Include all query params in cache key
 * - "include-list": Only include specified params
 * - "exclude-list": Include all except specified params (default behavior)
 */
export type QueryParamPolicy = "ignore-all" | "include-all" | "include-list" | "exclude-list";

export interface QueryParamCacheOptions {
  /** How to handle query params. Default: "exclude-list" */
  policy?: QueryParamPolicy;
  /** List of param names for include-list or exclude-list policies */
  params?: readonly string[];
}

/** Immutable source identity used to isolate file-operation cache entries. */
export interface FileOperationContext {
  /** Kind of source serving the file operation. */
  sourceType: FileSourceType;
  /** Project slug that owns the cached file operation. */
  projectSlug: string;
  /** Branch name for a branch source. */
  branch?: string | null;
  /** Release identifier for a release or environment source. */
  releaseId?: string | null;
  /** Environment name for an environment source. */
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
export const DEFAULT_EXCLUDED_QUERY_PARAMS = Object.freeze(
  [
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
    "gad_source",
    "gbraid",
    "wbraid",
    // Facebook
    "fbclid",
    "fb_action_ids",
    "fb_action_types",
    // LinkedIn
    "li_fat_id",
    // Microsoft / Bing
    "msclkid",
    // Mailchimp
    "mc_cid",
    "mc_eid",
    // Cache-busting probes
    "_",
    "cb",
    "cacheBust",
    "cache_bust",
    "cachebuster",
    "cache_buster",
    // Other tracking
    "ref",
    "referrer",
    "source",
    "_openstat",
    "igshid",
    "twclid",
    "yclid",
    "zanpid",
  ] as const,
);
