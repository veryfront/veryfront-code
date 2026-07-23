/**
 * In-memory cache for project environment variables with TTL and request deduplication.
 *
 * @module server/project-env/cache
 */

interface CacheIdentity {
  readonly environmentId: string;
  readonly projectSlug: string;
  readonly scope: string;
  readonly tokenFingerprint: string;
}

interface CacheEntry {
  readonly identity: CacheIdentity;
  readonly vars: Readonly<Record<string, string>>;
  readonly fetchedAt: number;
}

interface InflightEntry {
  readonly identity: CacheIdentity;
  readonly promise: Promise<Readonly<Record<string, string>>>;
}

type Fetcher = (
  environmentId: string,
  token: string,
  projectSlug: string,
) => Promise<Record<string, string>>;

export interface EnvironmentVariableCacheGetOptions {
  /** Additional authorization scope, such as the active release ID. */
  readonly scope?: string;
}

export interface EnvironmentVariableCacheInvalidationOptions {
  readonly projectSlug?: string;
  readonly scope?: string;
}

/** Max number of environments to cache. Evicts the least recently used entry. */
const DEFAULT_MAX_ENTRIES = 100;
const MAX_CACHE_ENTRIES = 10_000;
const MAX_ENVIRONMENT_ID_LENGTH = 512;
const MAX_PROJECT_SLUG_LENGTH = 512;
const MAX_SCOPE_LENGTH = 1_024;
const MAX_TOKEN_LENGTH = 64 * 1_024;

function assertBoundedString(
  value: string,
  name: string,
  maxLength: number,
  allowEmpty = false,
): void {
  if (
    typeof value !== "string" || (!allowEmpty && value.length === 0) ||
    value.length > maxLength
  ) {
    throw new TypeError(`${name} must be a bounded ${allowEmpty ? "" : "non-empty "}string`);
  }
}

function encodeHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

async function fingerprintToken(token: string): Promise<string> {
  assertBoundedString(token, "token", MAX_TOKEN_LENGTH);
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return encodeHex(new Uint8Array(digest));
}

function copyVariables(vars: Readonly<Record<string, string>>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value !== "string") {
      throw new TypeError("Project environment variable values must be strings");
    }
    Object.defineProperty(output, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  return output;
}

function cacheKey(identity: CacheIdentity): string {
  return JSON.stringify([
    identity.projectSlug,
    identity.environmentId,
    identity.scope,
    identity.tokenFingerprint,
  ]);
}

function matchesIdentity(
  identity: CacheIdentity,
  environmentId: string | undefined,
  options: EnvironmentVariableCacheInvalidationOptions,
): boolean {
  return (environmentId === undefined || identity.environmentId === environmentId) &&
    (options.projectSlug === undefined || identity.projectSlug === options.projectSlug) &&
    (options.scope === undefined || identity.scope === options.scope);
}

export class EnvironmentVariableCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, InflightEntry>();
  private generation = 0;

  constructor(
    private readonly fetcher: Fetcher,
    private readonly ttlMs = 60_000,
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
  ) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 0) {
      throw new RangeError("Project environment cache TTL must be a non-negative integer");
    }
    if (
      !Number.isSafeInteger(maxEntries) || maxEntries < 1 ||
      maxEntries > MAX_CACHE_ENTRIES
    ) {
      throw new RangeError(
        `Project environment cache capacity must be between 1 and ${MAX_CACHE_ENTRIES}`,
      );
    }
  }

  async get(
    environmentId: string,
    token: string,
    projectSlug: string,
    options: EnvironmentVariableCacheGetOptions = {},
  ): Promise<Record<string, string>> {
    assertBoundedString(environmentId, "environmentId", MAX_ENVIRONMENT_ID_LENGTH);
    assertBoundedString(projectSlug, "projectSlug", MAX_PROJECT_SLUG_LENGTH);
    const scope = options.scope ?? "";
    assertBoundedString(scope, "scope", MAX_SCOPE_LENGTH, true);

    const identity: CacheIdentity = {
      environmentId,
      projectSlug,
      scope,
      tokenFingerprint: await fingerprintToken(token),
    };
    const key = cacheKey(identity);
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached && now >= cached.fetchedAt && now - cached.fetchedAt < this.ttlMs) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return copyVariables(cached.vars);
    }
    if (cached) this.cache.delete(key);

    const existing = this.inflight.get(key);
    if (existing) return copyVariables(await existing.promise);
    if (this.inflight.size >= this.maxEntries) {
      throw new Error("Project environment variable request capacity exceeded");
    }

    const generation = this.generation;
    const promise = this.fetch(key, identity, token, generation);
    const inflightEntry: InflightEntry = { identity, promise };
    this.inflight.set(key, inflightEntry);

    try {
      return copyVariables(await promise);
    } finally {
      if (this.inflight.get(key) === inflightEntry) this.inflight.delete(key);
    }
  }

  invalidate(
    environmentId?: string,
    options: EnvironmentVariableCacheInvalidationOptions = {},
  ): void {
    if (environmentId !== undefined) {
      assertBoundedString(environmentId, "environmentId", MAX_ENVIRONMENT_ID_LENGTH);
    }
    if (options.projectSlug !== undefined) {
      assertBoundedString(options.projectSlug, "projectSlug", MAX_PROJECT_SLUG_LENGTH);
    }
    if (options.scope !== undefined) {
      assertBoundedString(options.scope, "scope", MAX_SCOPE_LENGTH, true);
    }

    this.generation++;
    for (const [key, entry] of this.cache) {
      if (matchesIdentity(entry.identity, environmentId, options)) this.cache.delete(key);
    }
    for (const [key, entry] of this.inflight) {
      if (matchesIdentity(entry.identity, environmentId, options)) this.inflight.delete(key);
    }
  }

  private async fetch(
    key: string,
    identity: CacheIdentity,
    token: string,
    generation: number,
  ): Promise<Readonly<Record<string, string>>> {
    const vars = await this.fetcher(
      identity.environmentId,
      token,
      identity.projectSlug,
    );
    const snapshot = Object.freeze(copyVariables(vars));
    if (generation === this.generation) {
      this.cache.set(key, { identity, vars: snapshot, fetchedAt: Date.now() });
      this.evictIfNeeded();
    }
    return snapshot;
  }

  /** Evict least recently used entries when the cache exceeds maxEntries. */
  private evictIfNeeded(): void {
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) return;
      this.cache.delete(oldest);
    }
  }
}
