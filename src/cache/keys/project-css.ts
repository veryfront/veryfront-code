import {
  API_CACHE_KEY_MAX_LENGTH,
  isCacheKeyPassThroughSafe,
  isValidCachePattern,
} from "./api-policy.ts";
import { decodeCacheKeyLiteralSegment, encodeCacheKeyLiteralSegment } from "./segment-codec.ts";

/** Internal namespace selected by every project CSS cache backend. */
export const PROJECT_CSS_CACHE_NAMESPACE = "project-css";
/** Internal schema for project CSS cache identities. */
export const PROJECT_CSS_CACHE_SCHEMA = "v5";
/** Internal namespace selected by every prepared project CSS cache backend. */
export const PREPARED_PROJECT_CSS_CACHE_NAMESPACE = "prepared-project-css";
/** Internal schema for prepared project CSS cache identities. */
export const PREPARED_PROJECT_CSS_CACHE_SCHEMA = "v5";

const CSS_DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export interface ProjectCSSCacheKeyFields {
  readonly projectScope: string;
  readonly environment: string;
  readonly stylesheetHash: string;
  readonly candidatesHash: string;
  readonly profileHash: string;
}

export interface DecodedProjectCSSCacheKey {
  readonly projectScope: string;
  readonly environment: string;
}

export interface PreparedProjectCSSCacheKeyFields {
  readonly projectScope: string;
  readonly environment: string;
  readonly identityHash: string;
}

export type DecodedPreparedProjectCSSCacheKey = DecodedProjectCSSCacheKey;

function assertString(
  value: unknown,
  cacheLabel: string,
  fieldLabel: string,
): asserts value is string {
  if (typeof value !== "string") {
    throw new TypeError(`${cacheLabel} ${fieldLabel} must be a string`);
  }
}

function assertBoundedInput(value: string, cacheLabel: string, fieldLabel: string): void {
  if (value.length > API_CACHE_KEY_MAX_LENGTH) {
    throw new RangeError(
      `${cacheLabel} ${fieldLabel} must contain at most ${API_CACHE_KEY_MAX_LENGTH} characters`,
    );
  }
}

function assertDigest(
  value: unknown,
  cacheLabel: string,
  fieldLabel: string,
): asserts value is string {
  if (typeof value !== "string" || !CSS_DIGEST_PATTERN.test(value)) {
    throw new TypeError(
      `${cacheLabel} ${fieldLabel} must be a full lowercase SHA-256 digest`,
    );
  }
}

function assertApiKey(namespace: string, cacheLabel: string, logicalKey: string): string {
  const concreteKey = `${namespace}:${logicalKey}`;
  if (concreteKey.length > API_CACHE_KEY_MAX_LENGTH) {
    throw new RangeError(
      `${cacheLabel} cache key must contain at most ${API_CACHE_KEY_MAX_LENGTH} characters including its backend namespace`,
    );
  }
  if (!isCacheKeyPassThroughSafe(concreteKey)) {
    throw new TypeError(`${cacheLabel} cache key is not valid at the cache API boundary`);
  }
  return logicalKey;
}

function assertApiInvalidationPrefix(
  namespace: string,
  cacheLabel: string,
  logicalPrefix: string,
): string {
  const concretePattern = `${namespace}:${logicalPrefix}*`;
  if (concretePattern.length > API_CACHE_KEY_MAX_LENGTH) {
    throw new RangeError(
      `${cacheLabel} invalidation pattern must contain at most ${API_CACHE_KEY_MAX_LENGTH} characters including its backend namespace`,
    );
  }
  if (
    !isCacheKeyPassThroughSafe(`${namespace}:${logicalPrefix}entry`) ||
    !isValidCachePattern(concretePattern)
  ) {
    throw new TypeError(
      `${cacheLabel} invalidation pattern is not valid at the cache API boundary`,
    );
  }
  return logicalPrefix;
}

function buildScopePrefix(
  namespace: string,
  schema: string,
  cacheLabel: string,
  projectScope: string,
): string {
  assertString(projectScope, cacheLabel, "project scope");
  assertBoundedInput(projectScope, cacheLabel, "project scope");
  return assertApiInvalidationPrefix(
    namespace,
    cacheLabel,
    `${schema}:${encodeCacheKeyLiteralSegment(projectScope)}:`,
  );
}

function decodeScopeAndEnvironment(
  namespace: string,
  schema: string,
  key: string,
  expectedParts: number,
): DecodedProjectCSSCacheKey | null {
  if (
    typeof key !== "string" ||
    !isCacheKeyPassThroughSafe(`${namespace}:${key}`)
  ) return null;
  const parts = key.split(":");
  if (parts.length !== expectedParts || parts[0] !== schema) return null;

  const projectScope = decodeCacheKeyLiteralSegment(parts[1] ?? "");
  const environment = decodeCacheKeyLiteralSegment(parts[2] ?? "");
  if (projectScope === null || environment === null) return null;

  return Object.freeze({ projectScope, environment });
}

/** Build the delimiter- and glob-safe prefix shared by lookup and invalidation. */
export function buildProjectCSSCacheScopePrefix(projectScope: string): string {
  return buildScopePrefix(
    PROJECT_CSS_CACHE_NAMESPACE,
    PROJECT_CSS_CACHE_SCHEMA,
    "Project CSS",
    projectScope,
  );
}

/** Build one bounded, injectively framed project CSS cache identity. */
export function buildProjectCSSCacheKey(fields: ProjectCSSCacheKeyFields): string {
  assertString(fields.environment, "Project CSS", "environment");
  assertBoundedInput(fields.environment, "Project CSS", "environment");
  assertDigest(fields.stylesheetHash, "Project CSS", "stylesheet hash");
  assertDigest(fields.candidatesHash, "Project CSS", "candidates hash");
  assertDigest(fields.profileHash, "Project CSS", "profile hash");

  return assertApiKey(
    PROJECT_CSS_CACHE_NAMESPACE,
    "Project CSS",
    `${buildProjectCSSCacheScopePrefix(fields.projectScope)}${
      encodeCacheKeyLiteralSegment(fields.environment)
    }:${fields.stylesheetHash}:${fields.candidatesHash}:${fields.profileHash}`,
  );
}

/** Decode only exact keys emitted by {@link buildProjectCSSCacheKey}. */
export function decodeProjectCSSCacheKey(key: string): DecodedProjectCSSCacheKey | null {
  if (typeof key !== "string") return null;
  const decoded = decodeScopeAndEnvironment(
    PROJECT_CSS_CACHE_NAMESPACE,
    PROJECT_CSS_CACHE_SCHEMA,
    key,
    6,
  );
  if (decoded === null) return null;
  const parts = key.split(":");
  if (
    parts.length !== 6 ||
    !CSS_DIGEST_PATTERN.test(parts[3] ?? "") ||
    !CSS_DIGEST_PATTERN.test(parts[4] ?? "") ||
    !CSS_DIGEST_PATTERN.test(parts[5] ?? "")
  ) return null;
  return decoded;
}

/** Build the exact prepared-CSS prefix shared by local and distributed invalidation. */
export function buildPreparedProjectCSSCacheScopePrefix(projectScope: string): string {
  return buildScopePrefix(
    PREPARED_PROJECT_CSS_CACHE_NAMESPACE,
    PREPARED_PROJECT_CSS_CACHE_SCHEMA,
    "Prepared project CSS",
    projectScope,
  );
}

/** Build one bounded prepared-CSS identity from its pre-hashed identity tuple. */
export function buildPreparedProjectCSSCacheKey(
  fields: PreparedProjectCSSCacheKeyFields,
): string {
  assertString(fields.environment, "Prepared project CSS", "environment");
  assertBoundedInput(fields.environment, "Prepared project CSS", "environment");
  assertDigest(fields.identityHash, "Prepared project CSS", "identity hash");

  return assertApiKey(
    PREPARED_PROJECT_CSS_CACHE_NAMESPACE,
    "Prepared project CSS",
    `${buildPreparedProjectCSSCacheScopePrefix(fields.projectScope)}${
      encodeCacheKeyLiteralSegment(fields.environment)
    }:${fields.identityHash}`,
  );
}

/** Decode only exact keys emitted by {@link buildPreparedProjectCSSCacheKey}. */
export function decodePreparedProjectCSSCacheKey(
  key: string,
): DecodedPreparedProjectCSSCacheKey | null {
  if (typeof key !== "string") return null;
  const decoded = decodeScopeAndEnvironment(
    PREPARED_PROJECT_CSS_CACHE_NAMESPACE,
    PREPARED_PROJECT_CSS_CACHE_SCHEMA,
    key,
    4,
  );
  if (decoded === null) return null;
  const parts = key.split(":");
  if (parts.length !== 4 || !CSS_DIGEST_PATTERN.test(parts[3] ?? "")) return null;
  return decoded;
}
