/**
 * Environment Variable Cache
 *
 * Caches environment variables per environment ID with TTL,
 * deduplicates concurrent fetches, and serves stale data on failure.
 *
 * @module server/env-vars/environment-variable-cache
 */

import type { EnvVarSource } from "./env-var-source.ts";

interface CacheEntry {
  vars: Record<string, string>;
  expiresAt: number;
}

export class EnvironmentVariableCache {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<Record<string, string>>>();

  constructor(
    private readonly source: EnvVarSource,
    private readonly ttlMs: number = 60_000,
  ) {}

  async get(environmentId: string): Promise<Record<string, string>> {
    const cached = this.cache.get(environmentId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.vars;
    }

    let pending = this.inflight.get(environmentId);
    if (!pending) {
      pending = this.source.fetchByEnvironmentId(environmentId)
        .then((vars) => {
          this.cache.set(environmentId, {
            vars,
            expiresAt: Date.now() + this.ttlMs,
          });
          this.inflight.delete(environmentId);
          return vars;
        })
        .catch((err) => {
          this.inflight.delete(environmentId);
          // Stale on failure: return expired cache entry if available
          if (cached) return cached.vars;
          throw err;
        });
      this.inflight.set(environmentId, pending);
    }

    return pending;
  }

  invalidate(environmentId?: string): void {
    if (environmentId) {
      this.cache.delete(environmentId);
    } else {
      this.cache.clear();
    }
  }
}
