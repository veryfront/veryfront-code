import { encodeCacheIdentitySegment } from "#veryfront/cache/keys/source-identity.ts";
import { containsUnsafeCacheStringCharacter } from "#veryfront/cache/validation.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { RepositoryContext } from "./types.ts";
import { MAX_REPOSITORY_CACHE_KEY_LENGTH, MAX_REPOSITORY_IDENTITY_LENGTH } from "./limits.ts";
const CACHE_GLOB_META_CHARACTERS = ["*", "?", "[", "]", "\\"] as const;

function invalidArgument(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function readOwnDataProperty(value: object, key: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    invalidArgument(`Repository context ${key} must be inspectable`);
  }
  if (!descriptor || !("value" in descriptor)) {
    invalidArgument(`Repository context ${key} must be an own data property`);
  }
  return descriptor.value;
}

function normalizeIdentity(value: unknown, label: string): string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_REPOSITORY_IDENTITY_LENGTH ||
    containsUnsafeCacheStringCharacter(value)
  ) {
    invalidArgument(
      `${label} must be a non-empty bounded string without control characters or unpaired UTF-16 surrogates`,
    );
  }
  return value;
}

/** Validate and detach repository identity from caller-owned mutable state. */
export function snapshotRepositoryContext(value: unknown): RepositoryContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidArgument("Repository context must be an object");
  }

  const projectId = normalizeIdentity(readOwnDataProperty(value, "projectId"), "projectId");
  const environment = readOwnDataProperty(value, "environment");
  const versionId = normalizeIdentity(readOwnDataProperty(value, "versionId"), "versionId");
  if (environment !== "production" && environment !== "preview") {
    invalidArgument('Repository environment must be "production" or "preview"');
  }

  const scopePrefix = `${encodeScopeSegment(projectId, "projectId")}:${environment}:` +
    `${encodeScopeSegment(versionId, "versionId")}:`;
  if (scopePrefix.length >= MAX_REPOSITORY_CACHE_KEY_LENGTH) {
    invalidArgument("Repository context leaves no capacity for a cache key");
  }

  return Object.freeze({ projectId, environment, versionId });
}

function encodeScopeSegment(value: string, label: string): string {
  // encodeURIComponent intentionally leaves "*" unchanged. Cache backends treat
  // it as a glob, so encode it explicitly before building deletion patterns.
  return encodeCacheIdentitySegment(value, label).replaceAll("*", "%2A");
}

export function buildRepositoryScopedKey(context: RepositoryContext, key: unknown): string {
  const snapshot = snapshotRepositoryContext(context);
  if (
    typeof key !== "string" || key.length > MAX_REPOSITORY_CACHE_KEY_LENGTH ||
    containsUnsafeCacheStringCharacter(key)
  ) {
    invalidArgument(
      "Cache key must be a bounded string without control characters or unpaired UTF-16 surrogates",
    );
  }

  const scopedKey =
    `${encodeScopeSegment(snapshot.projectId, "projectId")}:${snapshot.environment}:` +
    `${encodeScopeSegment(snapshot.versionId, "versionId")}:${key}`;
  if (scopedKey.length > MAX_REPOSITORY_CACHE_KEY_LENGTH) {
    invalidArgument("Scoped cache key exceeds the supported length");
  }
  return scopedKey;
}

export function assertLiteralCachePrefix(prefix: unknown): asserts prefix is string {
  if (
    typeof prefix !== "string" || prefix.length > MAX_REPOSITORY_CACHE_KEY_LENGTH ||
    containsUnsafeCacheStringCharacter(prefix) ||
    CACHE_GLOB_META_CHARACTERS.some((character) => prefix.includes(character))
  ) {
    invalidArgument(
      "Cache prefix must be a bounded literal string without glob or unsafe characters",
    );
  }
}
