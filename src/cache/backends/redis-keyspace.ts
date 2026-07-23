import { decodeCacheKeySegment } from "../keys/segment-codec.ts";

/**
 * Redis namespaces owned by cache backends. Project invalidation is opt-in per
 * namespace and must parse that namespace's exact key schema. Merely owning a
 * prefix never makes opaque or content-addressed keys project-deletable.
 */
export const RedisCacheNamespace = {
  DEFAULT: "cache",
  TRANSFORM: "transform",
  MODULE: "module",
  RENDER: "render",
  HTTP_MODULE: "http-module",
  SSR_MODULE: "ssr-module",
  PROJECT_CSS: "project-css",
  CSS: "css",
  CSS_INPUTS: "css-inputs",
  PREPARED_PROJECT_CSS: "prepared-project-css",
  SNIPPET: "snippet",
} as const;

export type RedisCacheEnvironment = "production" | "preview";

export interface RedisCacheProjectIdentity {
  projectId?: string;
  projectSlug?: string;
}

export interface RedisCacheKeyOwnership extends RedisCacheProjectIdentity {
  environment?: RedisCacheEnvironment;
}

export type RedisCacheOwnershipMatcher = (
  keyWithoutNamespace: string,
) => RedisCacheKeyOwnership | null;

export interface RedisCacheNamespaceDescriptor {
  readonly prefix: string;
  readonly matchProjectOwnership?: RedisCacheOwnershipMatcher;
}

const MAX_REDIS_CACHE_PREFIX_BYTES = 512;
const prefixEncoder = new TextEncoder();

// Prefixes at these roots belong to other subsystems. Reject an ownership claim
// that is equal to, contains, or is broad enough to contain one of them.
const RESERVED_NON_CACHE_PREFIXES = [
  "vf:workflow:",
  // ext-cache-redis defaults to this token-store namespace. Keep the constant
  // duplicated at the boundary so core never imports an optional extension.
  "vf:token:",
  "veryfront:ratelimit:",
  "veryfront:agent:memory:",
] as const;

function getEnvironmentFromContentSource(
  contentSourceId: string | undefined,
): RedisCacheEnvironment | undefined {
  if (!contentSourceId) return undefined;
  if (
    contentSourceId === "preview" ||
    contentSourceId === "preview-draft" ||
    contentSourceId.startsWith("preview-") ||
    contentSourceId.startsWith("local-")
  ) return "preview";
  if (
    contentSourceId === "production" ||
    contentSourceId === "latest" ||
    contentSourceId.startsWith("release-") ||
    contentSourceId.startsWith("production-") ||
    contentSourceId.startsWith("prod-")
  ) return "production";
  return undefined;
}

function matchFileCacheProjectOwnership(key: string): RedisCacheKeyOwnership | null {
  const parts = key.split(":");
  if (!(["file", "stat", "dir", "files"] as string[]).includes(parts[0] ?? "")) {
    return null;
  }
  const sourceType = parts[1];
  const projectSlug = parts[2];
  if (
    !projectSlug ||
    !parts[3] ||
    !["branch", "release", "env"].includes(sourceType ?? "")
  ) return null;

  // Runtime content contexts classify branch sources as preview and every
  // immutable release/environment source as production. The environment-name
  // segment is an arbitrary user-facing name (for example `Staging`), not the
  // preview/production mode and therefore must not drive this classification.
  const environment = sourceType === "branch" ? "preview" : "production";
  return { projectSlug, environment };
}

function matchSsrModuleProjectOwnership(key: string): RedisCacheKeyOwnership | null {
  const parts = key.split(":");
  if (parts[0] === "v2" && parts[1] === "ssr" && parts.length === 5) {
    const version = decodeCacheKeySegment(parts[2] ?? "");
    const projectId = decodeCacheKeySegment(parts[3] ?? "");
    const fileIdentity = decodeCacheKeySegment(parts[4] ?? "");
    if (!version || !projectId || !fileIdentity) return null;
    return {
      projectId,
      environment: getEnvironmentFromContentSource(fileIdentity.split(":", 1)[0]),
    };
  }

  if (!/^v[^:]+$/.test(parts[0] ?? "") || !parts[1] || !parts[2]) return null;
  return {
    projectId: parts[1],
    environment: getEnvironmentFromContentSource(parts[2]),
  };
}

/** Matcher for render keys emitted by buildRenderCachePrefix. */
export const matchRenderCacheProjectOwnership: RedisCacheOwnershipMatcher = (key) => {
  const parts = key.split(":");
  if (
    parts.length < 4 ||
    !parts[0] ||
    (parts[1] !== "production" && parts[1] !== "preview") ||
    !parts[2] ||
    !parts[3]
  ) return null;
  try {
    const projectId = decodeURIComponent(parts[0]);
    if (!projectId) return null;
    return { projectId, environment: parts[1] };
  } catch {
    return null;
  }
};

/** Matcher for legacy renderer CacheCoordinator keys. */
export const matchLegacyRenderCacheProjectOwnership: RedisCacheOwnershipMatcher = (key) => {
  const parts = key.split(":");
  if (!parts[0] || !parts[1] || !parts[2]) return null;
  let projectId: string;
  try {
    projectId = decodeURIComponent(parts[0]);
  } catch {
    return null;
  }
  if (!projectId) return null;
  return {
    projectId,
    environment: getEnvironmentFromContentSource(parts[1]),
  };
};

function matchProjectCssOwnership(key: string): RedisCacheKeyOwnership | null {
  const parts = key.split(":");
  if (
    parts.length < 5 ||
    !parts[0] ||
    (parts[1] !== "production" && parts[1] !== "preview")
  ) return null;
  return { projectSlug: parts[0], environment: parts[1] };
}

function matchPreparedProjectCssOwnership(key: string): RedisCacheKeyOwnership | null {
  const parts = key.split(":");
  if (
    parts.length < 7 ||
    !parts[0] ||
    (parts[1] !== "production" && parts[1] !== "preview") ||
    parts[2] !== "prepared"
  ) return null;
  return { projectSlug: parts[0], environment: parts[1] };
}

const INITIAL_DESCRIPTORS: RedisCacheNamespaceDescriptor[] = [
  { prefix: "vf:cache:", matchProjectOwnership: matchFileCacheProjectOwnership },
  { prefix: "vf:transform:" },
  { prefix: "vf:module:" },
  { prefix: "vf:render:", matchProjectOwnership: matchRenderCacheProjectOwnership },
  { prefix: "vf:http-module:" },
  { prefix: "vf:ssr-module:", matchProjectOwnership: matchSsrModuleProjectOwnership },
  { prefix: "vf:project-css:", matchProjectOwnership: matchProjectCssOwnership },
  { prefix: "vf:css:" },
  { prefix: "vf:css-inputs:" },
  {
    prefix: "vf:prepared-project-css:",
    matchProjectOwnership: matchPreparedProjectCssOwnership,
  },
  { prefix: "vf:snippet:" },
  // Earlier deployments emitted these prefixes. They remain cache-owned during
  // rolling upgrades, but only schemas with reversible identity are deletable.
  { prefix: "veryfront:ssr-module:", matchProjectOwnership: matchSsrModuleProjectOwnership },
  { prefix: "veryfront:file-cache:", matchProjectOwnership: matchFileCacheProjectOwnership },
  { prefix: "veryfront:transform:" },
  { prefix: "veryfront:render:", matchProjectOwnership: matchLegacyRenderCacheProjectOwnership },
];

const ownedNamespaces = new Map<string, RedisCacheNamespaceDescriptor>(
  INITIAL_DESCRIPTORS.map((descriptor) => [
    descriptor.prefix,
    Object.freeze({ ...descriptor }),
  ]),
);

export function validateRedisCacheKeyPrefix(prefix: string): string {
  if (typeof prefix !== "string" || prefix.length === 0) {
    throw new TypeError("Redis cache key prefix must be a non-empty string");
  }
  if (/\p{Cc}/u.test(prefix)) {
    throw new TypeError("Redis cache key prefix cannot contain control characters");
  }
  if (!prefix.endsWith(":")) {
    throw new TypeError("Redis cache key prefix must be non-empty and end with ':'");
  }
  if (prefixEncoder.encode(prefix).byteLength > MAX_REDIS_CACHE_PREFIX_BYTES) {
    throw new TypeError("Redis cache key prefix is too long");
  }
  if (
    RESERVED_NON_CACHE_PREFIXES.some((reserved) =>
      prefix.startsWith(reserved) || reserved.startsWith(prefix)
    )
  ) {
    throw new TypeError("Redis cache key prefix overlaps a reserved non-cache namespace");
  }
  return prefix;
}

/**
 * Canonicalize the historically free-form renderer Redis prefix.
 *
 * Older configuration commonly omitted the delimiter because RedisCacheStore
 * previously concatenated the prefix verbatim. Keep accepting that input while
 * ensuring every registered namespace has an unambiguous trailing boundary.
 */
export function normalizeLegacyRenderRedisCacheKeyPrefix(prefix: string): string {
  if (typeof prefix !== "string" || prefix.trim().length === 0) {
    throw new TypeError("Redis render cache key prefix must be a non-blank string");
  }

  const normalized = prefix.endsWith(":") ? prefix : `${prefix}:`;
  validateRedisCacheKeyPrefix(normalized);
  return normalized;
}

/** Validate a legacy renderer namespace without mutating the ownership table. */
export function validateLegacyRenderRedisCacheKeyPrefix(prefix: string): string {
  const normalizedPrefix = normalizeLegacyRenderRedisCacheKeyPrefix(prefix);
  const existing = ownedNamespaces.get(normalizedPrefix);
  if (existing) {
    if (existing.matchProjectOwnership === matchLegacyRenderCacheProjectOwnership) {
      return normalizedPrefix;
    }
    throw new TypeError(
      `Redis render cache prefix "${normalizedPrefix}" collides with an existing cache namespace`,
    );
  }

  const overlapping = [...ownedNamespaces.keys()].find((ownedPrefix) =>
    normalizedPrefix.startsWith(ownedPrefix) || ownedPrefix.startsWith(normalizedPrefix)
  );
  if (overlapping !== undefined) {
    throw new TypeError(
      `Redis render cache prefix "${normalizedPrefix}" collides with existing namespace "${overlapping}"`,
    );
  }

  return normalizedPrefix;
}

export function validateRedisCacheProjectIdentity(
  identity: RedisCacheProjectIdentity,
): RedisCacheProjectIdentity {
  for (const [name, value] of Object.entries(identity)) {
    if (value !== undefined && (typeof value !== "string" || value.trim().length === 0)) {
      throw new TypeError(`Redis cache ${name} must be a non-empty string`);
    }
  }
  if (identity.projectId === undefined && identity.projectSlug === undefined) {
    throw new TypeError("Redis cache project identity requires a projectId or projectSlug");
  }
  return Object.freeze({
    projectId: identity.projectId,
    projectSlug: identity.projectSlug,
  });
}

/** Build the exact Redis prefix used by createCacheBackend. */
export function buildRedisCacheKeyPrefix(
  namespace: string = RedisCacheNamespace.DEFAULT,
): string {
  const prefix = `vf:${namespace || RedisCacheNamespace.DEFAULT}:`;
  validateRedisCacheKeyPrefix(prefix);
  return prefix;
}

/**
 * Register a cache-owned namespace. Configured namespaces without a matcher
 * remain discoverable as cache data but cannot participate in project scans or
 * deletion. Ownership is immutable after the first registration: allowing a
 * later caller to attach a matcher could reinterpret keys written by another
 * cache with a different schema.
 */
export function registerOwnedRedisCacheNamespace(
  descriptor: RedisCacheNamespaceDescriptor,
): void {
  validateRedisCacheKeyPrefix(descriptor.prefix);
  if (
    descriptor.matchProjectOwnership !== undefined &&
    typeof descriptor.matchProjectOwnership !== "function"
  ) {
    throw new TypeError("Redis cache project ownership matcher must be a function");
  }

  const existing = ownedNamespaces.get(descriptor.prefix);
  if (existing) {
    if (!descriptor.matchProjectOwnership) return;
    if (!existing.matchProjectOwnership) {
      throw new TypeError(
        "Redis cache namespace is already registered without project ownership",
      );
    }
    if (existing.matchProjectOwnership !== descriptor.matchProjectOwnership) {
      throw new TypeError("Redis cache namespace already has a different ownership matcher");
    }
    return;
  }
  ownedNamespaces.set(
    descriptor.prefix,
    Object.freeze({ ...descriptor }),
  );
}

/**
 * Register a namespace containing legacy renderer CacheCoordinator keys.
 *
 * A custom render prefix must be disjoint from every namespace already claimed
 * by another cache. Exact repeated registration is allowed only when that
 * namespace already uses the same legacy render schema.
 */
export function registerLegacyRenderRedisCacheNamespace(prefix: string): string {
  const normalizedPrefix = validateLegacyRenderRedisCacheKeyPrefix(prefix);
  if (ownedNamespaces.has(normalizedPrefix)) return normalizedPrefix;

  registerOwnedRedisCacheNamespace({
    prefix: normalizedPrefix,
    matchProjectOwnership: matchLegacyRenderCacheProjectOwnership,
  });
  return normalizedPrefix;
}

/**
 * Backward-compatible ownership registration for opaque namespaces. It does
 * not make the namespace eligible for project invalidation.
 */
export function registerOwnedRedisCacheKeyPrefix(prefix: string): void {
  registerOwnedRedisCacheNamespace({ prefix });
}

/** Return longest prefixes first so nested configured namespaces match exactly. */
export function getOwnedRedisCacheNamespaceDescriptors(): RedisCacheNamespaceDescriptor[] {
  return [...ownedNamespaces.values()].sort((left, right) =>
    right.prefix.length - left.prefix.length || left.prefix.localeCompare(right.prefix)
  );
}

export function getOwnedRedisCacheKeyPrefixes(): string[] {
  return getOwnedRedisCacheNamespaceDescriptors().map(({ prefix }) => prefix);
}

/** Escape Redis glob metacharacters in a literal key fragment. */
export function escapeRedisCacheGlobLiteral(value: string): string {
  return value.replace(/[\\*?\[\]]/g, "\\$&");
}

/** Escape Redis glob metacharacters before appending the only wildcard we own. */
export function buildRedisCacheScanPattern(prefix: string): string {
  return `${escapeRedisCacheGlobLiteral(prefix)}*`;
}

export function stripOwnedRedisCacheKeyPrefix(key: string): string {
  for (const prefix of getOwnedRedisCacheKeyPrefixes()) {
    if (key.startsWith(prefix)) return key.slice(prefix.length);
  }
  return key;
}
