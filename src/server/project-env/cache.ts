/**
 * In-memory cache for project environment variables with TTL and request deduplication.
 *
 * Cache authority is the complete project/environment/credential scope. Neither a
 * tenant-supplied environment ID nor a reusable platform credential may alias a
 * different project's cached secrets.
 *
 * @module server/project-env/cache
 */

import { createProjectEnvSnapshot } from "./snapshot.ts";

export interface ProjectEnvironmentScope {
  /** Canonical project slug authorized by the credential. */
  projectSlug: string;
  /** Canonical project ID when the control plane supplied one. */
  projectId?: string;
  environmentId: string;
  token: string;
}

interface CacheEntry {
  vars: Record<string, string>;
  fetchedAt: number;
  environmentId: string;
}

type Fetcher = (scope: ProjectEnvironmentScope) => Promise<Record<string, string>>;

/** Max number of scoped environments to cache. Evicts oldest entry when exceeded. */
const DEFAULT_MAX_ENTRIES = 100;
const encodeText = TextEncoder.prototype.encode;
const subtleDigest = crypto.subtle.digest.bind(crypto.subtle);
const textEncoder = new TextEncoder();

function frame(value: string): string {
  return `${value.length}:${value}`;
}

async function digestCredential(token: string): Promise<string> {
  const bytes = encodeText.call(textEncoder, token);
  const digest = await subtleDigest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function buildCacheKey(scope: ProjectEnvironmentScope): Promise<string> {
  const credentialPrincipal = await digestCredential(scope.token);
  return [
    "project-env-v2",
    frame(scope.projectSlug),
    frame(scope.projectId ?? ""),
    frame(scope.environmentId),
    credentialPrincipal,
  ].join("|");
}

function normalizeScope(scope: ProjectEnvironmentScope): ProjectEnvironmentScope {
  const projectSlug = scope?.projectSlug;
  const projectId = scope?.projectId;
  const environmentId = scope?.environmentId;
  const token = scope?.token;

  if (typeof projectSlug !== "string" || !projectSlug.trim()) {
    throw new TypeError("Project environment scope requires a slug");
  }
  if (projectId !== undefined && (typeof projectId !== "string" || !projectId.trim())) {
    throw new TypeError("Project environment scope project ID must be a non-empty string");
  }
  if (typeof environmentId !== "string" || !environmentId.trim()) {
    throw new TypeError("Project environment scope requires an environment ID");
  }
  if (typeof token !== "string" || !token) {
    throw new TypeError("Project environment scope requires a credential");
  }

  return Object.freeze({ projectSlug, projectId, environmentId, token });
}

export class EnvironmentVariableCache {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<Record<string, string>>>();
  private fetcher: Fetcher;
  private ttlMs: number;
  private maxEntries: number;

  constructor(fetcher: Fetcher, ttlMs = 60_000, maxEntries = DEFAULT_MAX_ENTRIES) {
    this.fetcher = fetcher;
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  async get(scope: ProjectEnvironmentScope): Promise<Record<string, string>> {
    const normalizedScope = normalizeScope(scope);
    const key = await buildCacheKey(normalizedScope);
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached && now - cached.fetchedAt < this.ttlMs) {
      return cached.vars;
    }

    // Deduplicate only requests with exactly the same canonical identity and
    // credential principal. A shared environment ID is never sufficient.
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = this.fetch(normalizedScope, key);
    this.inflight.set(key, promise);

    try {
      return await promise;
    } finally {
      if (this.inflight.get(key) === promise) this.inflight.delete(key);
    }
  }

  invalidate(environmentId?: string): void {
    if (!environmentId) {
      this.cache.clear();
      return;
    }

    for (const [key, entry] of this.cache) {
      if (entry.environmentId === environmentId) this.cache.delete(key);
    }
  }

  private async fetch(
    scope: ProjectEnvironmentScope,
    key: string,
  ): Promise<Record<string, string>> {
    // Fetch failures are deliberately not replaced by stale or empty data.
    // Environment variables are an authorization-sensitive input; continuing
    // after credential revocation or an identity mismatch would fail open.
    const vars = createProjectEnvSnapshot(await this.fetcher(scope)) as Record<string, string>;
    this.cache.delete(key);
    this.cache.set(key, {
      vars,
      fetchedAt: Date.now(),
      environmentId: scope.environmentId,
    });
    this.evictIfNeeded();
    return vars;
  }

  /** Evict oldest entries when cache exceeds maxEntries. */
  private evictIfNeeded(): void {
    if (this.cache.size <= this.maxEntries) return;
    const excess = this.cache.size - this.maxEntries;
    let removed = 0;
    for (const key of this.cache.keys()) {
      if (removed >= excess) break;
      this.cache.delete(key);
      removed++;
    }
  }
}
