/**
 * In-memory cache for project environment variables with TTL and request deduplication.
 *
 * @module server/project-env/cache
 */

interface CacheEntry {
  vars: Record<string, string>;
  fetchedAt: number;
}

type Fetcher = (
  environmentId: string,
  token: string,
  projectSlug: string,
) => Promise<Record<string, string>>;

export class EnvironmentVariableCache {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<Record<string, string>>>();
  private fetcher: Fetcher;
  private ttlMs: number;

  constructor(fetcher: Fetcher, ttlMs = 60_000) {
    this.fetcher = fetcher;
    this.ttlMs = ttlMs;
  }

  async get(
    environmentId: string,
    token: string,
    projectSlug: string,
  ): Promise<Record<string, string>> {
    const cached = this.cache.get(environmentId);
    const now = Date.now();

    if (cached && now - cached.fetchedAt < this.ttlMs) {
      return cached.vars;
    }

    // Deduplicate concurrent fetches for the same environment
    const existing = this.inflight.get(environmentId);
    if (existing) return existing;

    const promise = this.fetch(environmentId, token, projectSlug, cached);
    this.inflight.set(environmentId, promise);

    try {
      return await promise;
    } finally {
      this.inflight.delete(environmentId);
    }
  }

  invalidate(environmentId?: string): void {
    if (environmentId) {
      this.cache.delete(environmentId);
    } else {
      this.cache.clear();
    }
  }

  private async fetch(
    environmentId: string,
    token: string,
    projectSlug: string,
    stale: CacheEntry | undefined,
  ): Promise<Record<string, string>> {
    try {
      const vars = await this.fetcher(environmentId, token, projectSlug);
      this.cache.set(environmentId, { vars, fetchedAt: Date.now() });
      return vars;
    } catch {
      // Stale-on-error: return stale data if available
      if (stale) return stale.vars;
      return {};
    }
  }
}
