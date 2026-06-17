/********************************************************************************
 * Cache Key Utilities
 *
 * Parsing, filtering, and normalization functions for cache keys.
 *
 * @module core/cache/keys/utils
 ********************************************************************************/

import { VERSION } from "#veryfront/utils/version.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import type { Span } from "#veryfront/observability/tracing/api-shim.ts";

import { cacheRegistry } from "../registry.ts";

import { DEFAULT_EXCLUDED_QUERY_PARAMS, type QueryParamCacheOptions } from "./prefixes.ts";

const querySegmentEncoder = new TextEncoder();

export function parseRenderCacheKey(cacheKey: string): {
  projectId: string;
  environment: string;
  releaseKey: string;
  version: string;
  contentKey: string;
} | null {
  const parts = cacheKey.split(":");
  if (parts.length < 5) return null;

  const [projectId, environment, releaseKey, version, ...contentParts] = parts;
  if (!projectId || !environment || !releaseKey || !version) return null;

  return {
    projectId,
    environment,
    releaseKey,
    version,
    contentKey: contentParts.join(":"),
  };
}

/**
 * Create a portable key from a path string.
 * Combines a hash (for uniqueness) with the folder name (for readability).
 * Example: "/Users/alice/projects/my-app" -> "local-7a3b2f1c-my-app"
 *
 * This ensures cache keys are:
 * - Portable across different machines and environments
 * - Debuggable (folder name visible at a glance)
 * - Unique (hash prevents collisions for same folder name in different locations)
 */
export function hashPathWithName(path: string): string {
  if (!path) return "local-default";

  // Extract folder name for readability
  const folderName = path.split("/").filter(Boolean).pop() || "unknown";

  // Generate hash for uniqueness
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    hash = (hash << 5) - hash + path.charCodeAt(i);
    hash |= 0;
  }

  return `local-${Math.abs(hash).toString(16)}-${folderName}`;
}

/**
 * Normalize a file path for use in cache keys.
 * Converts absolute paths to portable format: hash + filename for uniqueness and debuggability.
 *
 * Examples:
 * - "/Users/alice/project/components/Button.tsx" -> "a3f2b1c4-Button.tsx"
 * - "components/Button.tsx" -> "components/Button.tsx" (already relative)
 */
export function normalizeFilePath(filePath: string): string {
  // Already relative path - keep as-is
  if (!filePath.startsWith("/")) {
    return filePath;
  }

  // Extract filename for readability
  const parts = filePath.split("/");
  const fileName = parts.pop() || "unknown";

  // Hash the full path for uniqueness
  let hash = 0;
  for (let i = 0; i < filePath.length; i++) {
    hash = (hash << 5) - hash + filePath.charCodeAt(i);
    hash |= 0;
  }

  return `${Math.abs(hash).toString(16)}-${fileName}`;
}

/**
 * Filter query params based on the specified policy.
 *
 * @param params - URLSearchParams to filter
 * @param options - Query param handling options
 * @returns Filtered entries array
 */
export function filterQueryParams(
  params: URLSearchParams,
  options?: QueryParamCacheOptions,
): Array<[string, string]> {
  const policy = options?.policy ?? "exclude-list";
  const paramList = options?.params ?? [];

  const entries = [...params.entries()];

  switch (policy) {
    case "ignore-all":
      return [];

    case "include-list":
      return entries.filter(([key]) => paramList.includes(key));

    case "exclude-list": {
      const excludeSet = new Set(
        [...DEFAULT_EXCLUDED_QUERY_PARAMS, ...paramList].map(normalizeQueryParamName),
      );
      return entries.filter(([key]) => !excludeSet.has(normalizeQueryParamName(key)));
    }

    case "include-all":
    default:
      return entries;
  }
}

function normalizeQueryParamName(param: string): string {
  return param.toLowerCase();
}

/**
 * Sanitize query params for use in cache keys.
 * Converts query params to a format safe for API cache key validation.
 *
 * API cache key validation only allows: a-z A-Z 0-9 _ : . * - /
 *
 * @param url - URL or URLSearchParams to extract query params from
 * @param options - Query param handling options
 * @returns Sanitized query string safe for cache keys, or empty string
 */
export function sanitizeQueryParamsForCacheKey(
  url: URL | URLSearchParams,
  options?: QueryParamCacheOptions,
): string {
  const params = url instanceof URL ? url.searchParams : url;

  // Filter params based on policy
  const filtered = filterQueryParams(params, options);
  if (filtered.length === 0) return "";

  const sorted = sortQueryParamsForCacheKey(filtered);

  // Build sanitized string using allowed characters:
  // - Use hyphen (-) instead of equals (=)
  // - Use underscore (_) instead of ampersand (&)
  // - Percent-encode special characters using * as the escape marker
  const sanitized = sorted
    .map(([key, value]) => {
      const safeKey = encodeCacheKeySegment(key);
      const safeValue = encodeCacheKeySegment(value);
      return `${safeKey}-${safeValue}`;
    })
    .join("_");

  return sanitized;
}

function sortQueryParamsForCacheKey(entries: Array<[string, string]>): Array<[string, string]> {
  const grouped = new Map<string, Array<[string, string]>>();

  for (const entry of entries) {
    const [key] = entry;
    const group = grouped.get(key);
    if (group) {
      group.push(entry);
    } else {
      grouped.set(key, [entry]);
    }
  }

  return [...grouped.keys()]
    .sort((leftKey, rightKey) => leftKey.localeCompare(rightKey))
    .flatMap((key) => grouped.get(key)!);
}

function encodeCacheKeySegment(value: string): string {
  return Array.from(value, (char) => {
    if (/^[a-zA-Z0-9_.-]$/.test(char)) return char;

    return Array.from(
      querySegmentEncoder.encode(char),
      (byte) => `*${byte.toString(16).toUpperCase().padStart(2, "0")}`,
    ).join("");
  }).join("");
}

export function createCacheKeyFilter(options: {
  projectId?: string;
  environment?: "production" | "preview";
  version?: string;
  prefix?: string;
}): (key: string) => boolean {
  return (key: string): boolean => {
    const parts = key.split(":");
    if (parts.length < 2) return false;

    if (options.prefix && !key.startsWith(options.prefix)) return false;

    if (options.projectId) {
      const projectId = options.projectId;
      const hasProjectId = parts[1] === projectId ||
        (parts.length > 2 && parts[2] === projectId) ||
        parts.includes(projectId);

      if (!hasProjectId) return false;
    }

    if (options.environment && !parts.includes(options.environment)) return false;
    if (options.version && !parts.includes(options.version)) return false;

    return true;
  };
}

export function getCacheKeyVersion(): string {
  return VERSION;
}

export function getAllKeysForProject(projectId: string): Map<string, string[]> {
  return cacheRegistry.getKeysForProject(projectId);
}

export function getAllKeysForProjectAsync(
  projectId: string,
  includeRedis: boolean = true,
): Promise<{ memory: Map<string, string[]>; redis: Map<string, string[]> }> {
  return withSpan(
    SpanNames.CACHE_KEYS_GET_ALL_ASYNC,
    async (span?: Span) => {
      const result = await cacheRegistry.getAllKeysForProjectAsync(projectId, includeRedis);
      span?.setAttribute("cache.include_redis", includeRedis);
      return result;
    },
    { "cache.project_id": projectId },
  );
}

export function deleteAllKeysForProject(projectId: string): number {
  return cacheRegistry.deleteKeysForProject(projectId);
}

export function deleteAllKeysForProjectAsync(
  projectId: string,
): Promise<{ memoryDeleted: number; redisDeleted: number }> {
  return withSpan(
    SpanNames.CACHE_KEYS_DELETE_ALL_ASYNC,
    async (span?: Span) => {
      const result = await cacheRegistry.deleteAllKeysForProjectAsync(projectId);
      span?.setAttribute("cache.memory.deleted", result.memoryDeleted);
      span?.setAttribute("cache.redis.deleted", result.redisDeleted);
      return result;
    },
    { "cache.project_id": projectId },
  );
}
