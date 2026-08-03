import {
  decodePreparedProjectCSSCacheKey,
  decodeProjectCSSCacheKey,
  PREPARED_PROJECT_CSS_CACHE_NAMESPACE,
  PROJECT_CSS_CACHE_NAMESPACE,
} from "../keys/project-css.ts";
import { decodeCacheKeyPercentSegment, decodeCacheKeySegment } from "../keys/segment-codec.ts";

/**
 * Distributed namespaces owned by cache backends. Project invalidation is opt-in per
 * namespace and must parse that namespace's exact key schema. Merely owning a
 * prefix never makes opaque or content-addressed keys project-deletable.
 */
export const DistributedCacheNamespace = {
  DEFAULT: "default",
  TRANSFORM: "transform",
  MODULE: "module",
  RENDER: "render",
  HTTP_MODULE: "http-module",
  SSR_MODULE: "ssr-module",
  PROJECT_CSS: PROJECT_CSS_CACHE_NAMESPACE,
  CSS: "css",
  CSS_INPUTS: "css-inputs",
  PREPARED_PROJECT_CSS: PREPARED_PROJECT_CSS_CACHE_NAMESPACE,
  SNIPPET: "snippet",
} as const;

export type DistributedCacheEnvironment = "production" | "preview";

export interface DistributedCacheProjectIdentity {
  projectId?: string;
  projectSlug?: string;
}

export interface DistributedCacheKeyOwnership extends DistributedCacheProjectIdentity {
  environment?: DistributedCacheEnvironment;
}

export type DistributedCacheOwnershipMatcher = (
  keyWithoutNamespace: string,
) => DistributedCacheKeyOwnership | null;

export interface DistributedCacheNamespaceDescriptor {
  readonly prefix: string;
  readonly matchProjectOwnership?: DistributedCacheOwnershipMatcher;
}

const DISTRIBUTED_CACHE_ROOT = "vf:cache:";
const MAX_DISTRIBUTED_CACHE_PREFIX_BYTES = 512;
const prefixEncoder = new TextEncoder();

function getEnvironmentFromContentSource(
  contentSourceId: string | undefined,
): DistributedCacheEnvironment | undefined {
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

function matchFileCacheProjectOwnership(key: string): DistributedCacheKeyOwnership | null {
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

function matchSsrModuleProjectOwnership(key: string): DistributedCacheKeyOwnership | null {
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
export const matchRenderCacheProjectOwnership: DistributedCacheOwnershipMatcher = (key) => {
  const parts = key.split(":");
  if (
    parts.length < 4 ||
    !parts[0] ||
    (parts[1] !== "production" && parts[1] !== "preview") ||
    !parts[2] ||
    !parts[3]
  ) return null;
  const projectId = decodeCacheKeyPercentSegment(parts[0]);
  return projectId ? { projectId, environment: parts[1] } : null;
};

function matchProjectCssOwnership(key: string): DistributedCacheKeyOwnership | null {
  const decoded = decodeProjectCSSCacheKey(key);
  if (decoded === null) return null;

  return {
    projectSlug: decoded.projectScope,
    environment: decoded.environment === "production" || decoded.environment === "preview"
      ? decoded.environment
      : undefined,
  };
}

function matchPreparedProjectCssOwnership(key: string): DistributedCacheKeyOwnership | null {
  const decoded = decodePreparedProjectCSSCacheKey(key);
  if (decoded === null) return null;

  return {
    projectSlug: decoded.projectScope,
    environment: decoded.environment === "production" || decoded.environment === "preview"
      ? decoded.environment
      : undefined,
  };
}

const INITIAL_DESCRIPTORS: DistributedCacheNamespaceDescriptor[] = [
  { prefix: "vf:cache:default:", matchProjectOwnership: matchFileCacheProjectOwnership },
  { prefix: "vf:cache:transform:" },
  { prefix: "vf:cache:module:" },
  { prefix: "vf:cache:render:", matchProjectOwnership: matchRenderCacheProjectOwnership },
  { prefix: "vf:cache:http-module:" },
  { prefix: "vf:cache:ssr-module:", matchProjectOwnership: matchSsrModuleProjectOwnership },
  {
    prefix: `${DISTRIBUTED_CACHE_ROOT}${PROJECT_CSS_CACHE_NAMESPACE}:`,
    matchProjectOwnership: matchProjectCssOwnership,
  },
  { prefix: "vf:cache:css:" },
  { prefix: "vf:cache:css-inputs:" },
  {
    prefix: `${DISTRIBUTED_CACHE_ROOT}${PREPARED_PROJECT_CSS_CACHE_NAMESPACE}:`,
    matchProjectOwnership: matchPreparedProjectCssOwnership,
  },
  { prefix: "vf:cache:snippet:" },
];

const ownedNamespaces = new Map<string, DistributedCacheNamespaceDescriptor>(
  INITIAL_DESCRIPTORS.map((descriptor) => [
    descriptor.prefix,
    Object.freeze({ ...descriptor }),
  ]),
);

export function validateDistributedCacheKeyPrefix(prefix: string): string {
  if (typeof prefix !== "string" || prefix.length === 0) {
    throw new TypeError("Distributed cache key prefix must be a non-empty string");
  }
  if (/\p{Cc}/u.test(prefix)) {
    throw new TypeError("Distributed cache key prefix cannot contain control characters");
  }
  if (!prefix.endsWith(":")) {
    throw new TypeError("Distributed cache key prefix must end with ':'");
  }
  if (!prefix.startsWith(DISTRIBUTED_CACHE_ROOT) || prefix === DISTRIBUTED_CACHE_ROOT) {
    throw new TypeError(`Distributed cache key prefix must be below ${DISTRIBUTED_CACHE_ROOT}`);
  }
  if (prefixEncoder.encode(prefix).byteLength > MAX_DISTRIBUTED_CACHE_PREFIX_BYTES) {
    throw new TypeError("Distributed cache key prefix is too long");
  }
  return prefix;
}

/** Validate a render namespace without mutating the ownership table. */
export function validateRenderDistributedCacheKeyPrefix(prefix: string): string {
  const normalizedPrefix = validateDistributedCacheKeyPrefix(prefix);
  const existing = ownedNamespaces.get(prefix);
  if (existing) {
    if (existing.matchProjectOwnership === matchRenderCacheProjectOwnership) {
      return normalizedPrefix;
    }
    throw new TypeError(
      `Distributed render cache prefix "${normalizedPrefix}" collides with an existing cache namespace`,
    );
  }

  const overlapping = [...ownedNamespaces.keys()].find((ownedPrefix) =>
    normalizedPrefix.startsWith(ownedPrefix) || ownedPrefix.startsWith(normalizedPrefix)
  );
  if (overlapping !== undefined) {
    throw new TypeError(
      `Distributed render cache prefix "${normalizedPrefix}" collides with existing namespace "${overlapping}"`,
    );
  }

  return normalizedPrefix;
}

export function validateDistributedCacheProjectIdentity(
  identity: DistributedCacheProjectIdentity,
): DistributedCacheProjectIdentity {
  for (const [name, value] of Object.entries(identity)) {
    if (value !== undefined && (typeof value !== "string" || value.trim().length === 0)) {
      throw new TypeError(`Distributed cache ${name} must be a non-empty string`);
    }
  }
  if (identity.projectId === undefined && identity.projectSlug === undefined) {
    throw new TypeError("Distributed cache project identity requires a projectId or projectSlug");
  }
  return Object.freeze({
    projectId: identity.projectId,
    projectSlug: identity.projectSlug,
  });
}

/** Build the canonical provider-neutral prefix used by distributed cache backends. */
export function buildDistributedCacheKeyPrefix(
  namespace: string = DistributedCacheNamespace.DEFAULT,
): string {
  const prefix = `${DISTRIBUTED_CACHE_ROOT}${namespace || DistributedCacheNamespace.DEFAULT}:`;
  validateDistributedCacheKeyPrefix(prefix);
  return prefix;
}

/**
 * Register a cache-owned namespace. Configured namespaces without a matcher
 * remain discoverable as cache data but cannot participate in project scans or
 * deletion. Ownership is immutable after the first registration: allowing a
 * later caller to attach a matcher could reinterpret keys written by another
 * cache with a different schema.
 */
export function registerOwnedDistributedCacheNamespace(
  descriptor: DistributedCacheNamespaceDescriptor,
): void {
  validateDistributedCacheKeyPrefix(descriptor.prefix);
  if (
    descriptor.matchProjectOwnership !== undefined &&
    typeof descriptor.matchProjectOwnership !== "function"
  ) {
    throw new TypeError("Distributed cache project ownership matcher must be a function");
  }

  const existing = ownedNamespaces.get(descriptor.prefix);
  if (existing) {
    if (!descriptor.matchProjectOwnership) return;
    if (!existing.matchProjectOwnership) {
      throw new TypeError(
        "Distributed cache namespace is already registered without project ownership",
      );
    }
    if (existing.matchProjectOwnership !== descriptor.matchProjectOwnership) {
      throw new TypeError("Distributed cache namespace already has a different ownership matcher");
    }
    return;
  }
  ownedNamespaces.set(
    descriptor.prefix,
    Object.freeze({ ...descriptor }),
  );
}

/**
 * Register a namespace containing render-cache keys.
 */
export function registerRenderDistributedCacheNamespace(prefix: string): string {
  const normalizedPrefix = validateRenderDistributedCacheKeyPrefix(prefix);
  if (ownedNamespaces.has(normalizedPrefix)) return normalizedPrefix;

  registerOwnedDistributedCacheNamespace({
    prefix: normalizedPrefix,
    matchProjectOwnership: matchRenderCacheProjectOwnership,
  });
  return normalizedPrefix;
}

/** Register an opaque namespace without making it eligible for project invalidation. */
export function registerOwnedDistributedCacheKeyPrefix(prefix: string): void {
  registerOwnedDistributedCacheNamespace({ prefix });
}

/** Return longest prefixes first so nested configured namespaces match exactly. */
export function getOwnedDistributedCacheNamespaceDescriptors(): DistributedCacheNamespaceDescriptor[] {
  return [...ownedNamespaces.values()].sort((left, right) =>
    right.prefix.length - left.prefix.length || left.prefix.localeCompare(right.prefix)
  );
}

export function getOwnedDistributedCacheKeyPrefixes(): string[] {
  return getOwnedDistributedCacheNamespaceDescriptors().map(({ prefix }) => prefix);
}

/** Escape the wildcard syntax shared by cache backend pattern operations. */
export function escapeCacheGlobLiteral(value: string): string {
  return value.replace(/[\\*?\[\]]/g, "\\$&");
}

export function stripOwnedDistributedCacheKeyPrefix(key: string): string {
  for (const prefix of getOwnedDistributedCacheKeyPrefixes()) {
    if (key.startsWith(prefix)) return key.slice(prefix.length);
  }
  return key;
}
