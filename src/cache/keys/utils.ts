/********************************************************************************
 * Cache Key Utilities
 *
 * Parsing, filtering, and normalization functions for cache keys.
 *
 * @module core/cache/keys/utils
 ********************************************************************************/

import { VERSION } from "#veryfront/utils/version.ts";
import { type Span, SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

import { cacheRegistry, isKeyForProject } from "../registry.ts";
import { containsUnsafeCacheStringCharacter, encodeCacheHashInput } from "../validation.ts";

import {
  DEFAULT_EXCLUDED_QUERY_PARAMS,
  type QueryParamCacheOptions,
  type QueryParamPolicy,
} from "./prefixes.ts";

const querySegmentEncoder = new TextEncoder();
const MAX_QUERY_POLICY_PARAMS = 256;
const MAX_QUERY_PARAM_NAME_LENGTH = 1024;

// 64-bit FNV-1a parameters (run twice with independent seeds to yield a 128-bit
// digest). Replaces the previous 32-bit DJB2 hash, whose ~16-bit birthday bound
// meant cache-key collisions became likely at only ~77k unique paths. This was a
// cross-tenant risk since two colliding project paths would share a cache prefix.
const FNV64_MASK = (1n << 64n) - 1n;
const FNV64_PRIME = 1099511628211n;
const FNV64_OFFSET_A = 14695981039346656037n;
const FNV64_OFFSET_B = 1099511628211n;

/**
 * Strong, deterministic, synchronous path hash. Produces a 128-bit lowercase-hex
 * digest by running two independently-seeded 64-bit FNV-1a passes over the UTF-8
 * bytes of the input. Sync (BigInt, no crypto.subtle) because the cache-key
 * builders that call it are synchronous hot paths.
 */
function strongPathHash(input: string): string {
  const bytes = encodeCacheHashInput(input);
  let a = FNV64_OFFSET_A;
  let b = FNV64_OFFSET_B;
  for (const rawByte of bytes) {
    const byte = BigInt(rawByte);
    a = ((a ^ byte) * FNV64_PRIME) & FNV64_MASK;
    b = ((b ^ (byte + 0x9en)) * FNV64_PRIME) & FNV64_MASK;
  }
  return a.toString(16).padStart(16, "0") + b.toString(16).padStart(16, "0");
}

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

  try {
    return {
      projectId: decodeURIComponent(projectId),
      environment,
      releaseKey: decodeURIComponent(releaseKey),
      version,
      contentKey: contentParts.join(":"),
    };
  } catch {
    return null;
  }
}

/**
 * Create a portable key from a path string.
 * Combines a hash (for uniqueness) with the folder name (for readability).
 * Example: "<PROJECT_DIR>/my-app" becomes "local-<HASH>-my-app".
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

  return `local-${strongPathHash(path)}-${folderName}`;
}

/**
 * Normalize a file path for use in cache keys.
 * Converts absolute paths to portable format: hash + filename for uniqueness and debuggability.
 *
 * Examples:
 * - "<PROJECT_DIR>/components/Button.tsx" becomes "<HASH>-Button.tsx"
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

  return `${strongPathHash(filePath)}-${fileName}`;
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
  const { policy, paramList } = normalizeQueryParamOptions(options);

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
      return entries;
  }
}

function invalidQueryOptions(message: string): never {
  throw INVALID_ARGUMENT.create({ message });
}

function readQueryOption(options: object, key: keyof QueryParamCacheOptions): unknown {
  try {
    return Reflect.get(options, key);
  } catch {
    invalidQueryOptions("Query parameter cache options are unreadable");
  }
}

function normalizeQueryParamOptions(options: unknown): {
  policy: QueryParamPolicy;
  paramList: string[];
} {
  if (options === undefined) return { policy: "exclude-list", paramList: [] };
  let isOptionsArray: boolean;
  try {
    isOptionsArray = Array.isArray(options);
  } catch {
    invalidQueryOptions("Query parameter cache options are unreadable");
  }
  if (typeof options !== "object" || options === null || isOptionsArray) {
    invalidQueryOptions("Query parameter cache options are invalid");
  }

  const policy = readQueryOption(options, "policy") ?? "exclude-list";
  if (
    policy !== "ignore-all" && policy !== "include-all" &&
    policy !== "include-list" && policy !== "exclude-list"
  ) {
    invalidQueryOptions("Query parameter cache policy is invalid");
  }

  const configuredParams = readQueryOption(options, "params") ?? [];
  let isArray: boolean;
  let length: unknown;
  try {
    isArray = Array.isArray(configuredParams);
    length = isArray ? Reflect.get(configuredParams, "length") : undefined;
  } catch {
    invalidQueryOptions("Query parameter cache options are unreadable");
  }
  if (
    !isArray || typeof length !== "number" || !Number.isSafeInteger(length) ||
    length > MAX_QUERY_POLICY_PARAMS
  ) {
    invalidQueryOptions("Query parameter cache options are invalid");
  }

  const paramList: string[] = [];
  for (let index = 0; index < length; index++) {
    let value: unknown;
    try {
      value = Reflect.get(configuredParams, String(index));
    } catch {
      invalidQueryOptions("Query parameter cache options are unreadable");
    }
    if (
      typeof value !== "string" || value.length > MAX_QUERY_PARAM_NAME_LENGTH ||
      containsUnsafeCacheStringCharacter(value)
    ) {
      invalidQueryOptions("Query parameter cache options are invalid");
    }
    paramList.push(value);
  }

  return { policy, paramList };
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

  // Build an injective string with reserved structural delimiters:
  // - Hyphen (-) separates each name from its value.
  // - Underscore (_) separates entries.
  // - Data occurrences of either delimiter are escaped with every other
  //   non-alphanumeric byte, using * as the escape marker.
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
    .sort((leftKey, rightKey) => leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0)
    .flatMap((key) => grouped.get(key)!);
}

function encodeCacheKeySegment(value: string): string {
  return Array.from(value, (char) => {
    if (/^[a-zA-Z0-9.]$/.test(char)) return char;

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
      if (!isKeyForProject(key, options.projectId)) return false;
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
    undefined,
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
    undefined,
  );
}
