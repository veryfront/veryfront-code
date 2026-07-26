import { INVALID_ARGUMENT } from "#veryfront/errors";
import { hasWellFormedUnicode, MAX_REPOSITORY_CACHE_KEY_CODE_UNITS } from "../constraints.ts";
import { snapshotRepositoryContext } from "../context.ts";
import type { RepositoryContext } from "../types.ts";

const REPOSITORY_CACHE_KEY_PREFIX = "veryfront:repository:v1:";

export interface RepositoryCacheScope {
  readonly context: RepositoryContext;
  readonly prefix: string;
}

function encodeComponent(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw INVALID_ARGUMENT.create({ detail: `${label} must be a string` });
  }
  if (value.length > MAX_REPOSITORY_CACHE_KEY_CODE_UNITS) {
    throw new RangeError(
      `${label} must contain at most ${MAX_REPOSITORY_CACHE_KEY_CODE_UNITS} code units`,
    );
  }
  if (!hasWellFormedUnicode(value)) {
    throw INVALID_ARGUMENT.create({ detail: `${label} must contain valid Unicode` });
  }

  try {
    return encodeURIComponent(value).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  } catch (cause) {
    throw INVALID_ARGUMENT.create({
      detail: `${label} must contain valid Unicode`,
      cause,
    });
  }
}

function assertComposedKeyLength(key: string): string {
  if (key.length > MAX_REPOSITORY_CACHE_KEY_CODE_UNITS) {
    throw new RangeError(
      `Repository cache key must contain at most ${MAX_REPOSITORY_CACHE_KEY_CODE_UNITS} code units after encoding`,
    );
  }
  return key;
}

export function createRepositoryCacheScope(context: RepositoryContext): RepositoryCacheScope {
  const snapshot = snapshotRepositoryContext(context);
  const prefix = assertComposedKeyLength(
    REPOSITORY_CACHE_KEY_PREFIX +
      `${encodeComponent(snapshot.projectId, "Repository projectId")}:` +
      `${snapshot.environment}:` +
      `${encodeComponent(snapshot.versionId, "Repository versionId")}:`,
  );
  return Object.freeze({ context: snapshot, prefix });
}

export function appendRepositoryCacheKey(scopePrefix: string, key: string): string {
  assertComposedKeyLength(scopePrefix);
  return assertComposedKeyLength(
    scopePrefix + encodeComponent(key, "Repository cache key"),
  );
}

/**
 * Build a versioned, injective cache key for one repository context.
 *
 * Every variable component is RFC 3986 encoded, including glob metacharacters,
 * so delimiter collisions and caller-controlled invalidation patterns cannot
 * cross project or content-source boundaries.
 */
export function buildScopedKey(context: RepositoryContext, key: string): string {
  const scope = createRepositoryCacheScope(context);
  return appendRepositoryCacheKey(scope.prefix, key);
}
