/**
 * Dedicated Server Resolver
 *
 * Resolves an environment ID to a dedicated server hostname.
 * Used by the proxy to route traffic to dedicated servers instead of the shared pool.
 *
 * Caches results in memory with a short TTL to avoid hitting the API on every request.
 * A null result (no dedicated server) is also cached to prevent repeated lookups.
 */

import { proxyLogger } from "./logger.ts";
import { unrefTimer } from "#veryfront/platform/compat/process.ts";

const logger = proxyLogger.child({ module: "server-resolver" });

interface DedicatedServer {
  id: string;
  short_id: string;
  hostname: string;
  status: string;
}

interface CacheEntry {
  server: DedicatedServer | null;
  expiresAt: number;
}

export class ServerResolver {
  private cache = new Map<string, CacheEntry>();
  private pending = new Map<string, Promise<DedicatedServer | null>>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private apiInternalUrl: string,
    private apiUser: string,
    private apiPass: string,
    private cacheTtlMs: number = 30_000,
  ) {
    // Cleanup expired entries every 60s
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    // Don't keep the process alive for cleanup
    unrefTimer(this.cleanupTimer);
  }

  /**
   * Resolve an environment ID to a dedicated server URL, or null for shared pool.
   */
  async resolve(environmentId: string | undefined): Promise<string | null> {
    if (!environmentId) return null;

    const cached = this.cache.get(environmentId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.server ? `http://${cached.server.hostname}` : null;
    }

    // Deduplicate concurrent requests for the same environment
    const inflight = this.pending.get(environmentId);
    if (inflight) {
      const server = await inflight;
      return server ? `http://${server.hostname}` : null;
    }

    const promise = this.fetchServer(environmentId);
    this.pending.set(environmentId, promise);

    try {
      const server = await promise;
      this.cache.set(environmentId, {
        server,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
      return server ? `http://${server.hostname}` : null;
    } finally {
      this.pending.delete(environmentId);
    }
  }

  close(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
  }

  private async fetchServer(environmentId: string): Promise<DedicatedServer | null> {
    try {
      const url = `${this.apiInternalUrl}/internal/environment-server?environmentId=${
        encodeURIComponent(environmentId)
      }`;
      const headers: Record<string, string> = { Accept: "application/json" };

      if (this.apiUser && this.apiPass) {
        headers.Authorization = `Basic ${btoa(`${this.apiUser}:${this.apiPass}`)}`;
      }

      const response = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });

      if (!response.ok) {
        await response.body?.cancel();
        logger.warn("[ServerResolver] API returned non-OK status", {
          status: response.status,
          environmentId,
        });
        return null;
      }

      const data = (await response.json()) as { server: DedicatedServer | null };
      if (data.server) {
        logger.debug("[ServerResolver] Resolved dedicated server", {
          environmentId,
          hostname: data.server.hostname,
        });
      }
      return data.server;
    } catch (error) {
      logger.warn("[ServerResolver] Failed to resolve server, falling back to shared pool", {
        error: error instanceof Error ? error.message : String(error),
        environmentId,
      });
      return null;
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now >= entry.expiresAt) this.cache.delete(key);
    }
  }
}
