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

/** Thrown when the API call fails (network error, non-OK status, parse error). */
class ServerResolverError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
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
      // Only cache successful API responses (server found OR explicit "no server").
      // Transient errors (network failures, non-OK status) are NOT cached so the
      // next request retries the API instead of suppressing dedicated routing.
      this.cache.set(environmentId, {
        server,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
      return server ? `http://${server.hostname}` : null;
    } catch (error) {
      // API error — don't cache, fall back to shared pool for this request
      logger.warn("[ServerResolver] Transient error, skipping cache", {
        environmentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
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

  /**
   * Fetch dedicated server from API.
   * Returns DedicatedServer | null on success (null = no dedicated server assigned).
   * Throws ServerResolverError on transient failures (network, non-OK status).
   */
  private async fetchServer(environmentId: string): Promise<DedicatedServer | null> {
    const url = `${this.apiInternalUrl}/internal/environment-server?environmentId=${
      encodeURIComponent(environmentId)
    }`;
    const headers: Record<string, string> = { Accept: "application/json" };

    if (this.apiUser && this.apiPass) {
      headers.Authorization = `Basic ${btoa(`${this.apiUser}:${this.apiPass}`)}`;
    }

    let response: Response;
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
    } catch (error) {
      throw new ServerResolverError(
        `Failed to reach API: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new ServerResolverError(`API returned ${response.status} for ${environmentId}`);
    }

    const data = (await response.json()) as { server: DedicatedServer | null };
    if (data.server) {
      logger.debug("[ServerResolver] Resolved dedicated server", {
        environmentId,
        hostname: data.server.hostname,
      });
    }
    return data.server;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now >= entry.expiresAt) this.cache.delete(key);
    }
  }
}
