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
  hostname: string;
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

const DEFAULT_CACHE_TTL_MS = 30_000;
const MAX_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_ENTRIES = 1_000;
const MAX_MAX_ENTRIES = 10_000;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_API_RESPONSE_BYTES = 64 * 1024;
const MAX_ENVIRONMENT_ID_BYTES = 256;
const MAX_DEDICATED_SERVER_HOST_BYTES = 512;

function boundedInteger(value: number, fallback: number, minimum: number, maximum: number): number {
  return Number.isSafeInteger(value) && value >= minimum ? Math.min(value, maximum) : fallback;
}

function hasControlCharacter(value: string, includeSpace = false): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < (includeSpace ? 33 : 32) || code === 127) return true;
  }
  return false;
}

function isValidEnvironmentId(value: string): boolean {
  return value.length > 0 &&
    value.trim() === value &&
    !hasControlCharacter(value) &&
    new TextEncoder().encode(value).byteLength <= MAX_ENVIRONMENT_ID_BYTES;
}

function parseDedicatedServer(value: unknown): DedicatedServer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ServerResolverError("API returned an invalid dedicated server payload");
  }
  const hostname = (value as Record<string, unknown>).hostname;
  const status = (value as Record<string, unknown>).status;
  if (
    typeof hostname !== "string" ||
    hostname.length === 0 ||
    hostname !== hostname.trim() ||
    hasControlCharacter(hostname, true) ||
    new TextEncoder().encode(hostname).byteLength > MAX_DEDICATED_SERVER_HOST_BYTES
  ) {
    throw new ServerResolverError("API returned an invalid dedicated server hostname");
  }
  if (typeof status !== "string" || status.length === 0 || hasControlCharacter(status)) {
    throw new ServerResolverError("API returned an invalid dedicated server status");
  }
  if (status !== "running") return null;

  let url: URL;
  try {
    url = new URL(`http://${hostname}`);
  } catch (error) {
    throw new ServerResolverError("API returned an invalid dedicated server hostname", {
      cause: error,
    });
  }
  if (
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new ServerResolverError("API returned an unsafe dedicated server hostname");
  }
  return { hostname: url.host };
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/u.test(declaredLength)) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length > MAX_API_RESPONSE_BYTES) {
      void response.body?.cancel().catch(() => undefined);
      throw new ServerResolverError("API response is too large");
    }
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_API_RESPONSE_BYTES) {
        void reader.cancel("API response is too large").catch(() => undefined);
        throw new ServerResolverError("API response is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new ServerResolverError("API returned invalid UTF-8", { cause: error });
  }
}

/** Resolves and caches dedicated renderer origins for project environments. */
export class ServerResolver {
  private cache = new Map<string, CacheEntry>();
  private pending = new Map<string, Promise<DedicatedServer | null>>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly lifecycleController = new AbortController();
  private readonly normalizedCacheTtlMs: number;
  private readonly maxEntries: number;
  private closed = false;

  /** Creates a resolver with bounded cache and request concurrency. */
  constructor(
    private apiInternalUrl: string,
    private apiUser: string,
    private apiPass: string,
    cacheTtlMs: number = DEFAULT_CACHE_TTL_MS,
    maxEntries: number = DEFAULT_MAX_ENTRIES,
  ) {
    this.normalizedCacheTtlMs = boundedInteger(
      cacheTtlMs,
      DEFAULT_CACHE_TTL_MS,
      0,
      MAX_CACHE_TTL_MS,
    );
    this.maxEntries = boundedInteger(
      maxEntries,
      DEFAULT_MAX_ENTRIES,
      1,
      MAX_MAX_ENTRIES,
    );
    // Cleanup expired entries every 60s
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    // Don't keep the process alive for cleanup
    unrefTimer(this.cleanupTimer);
  }

  /**
   * Resolve an environment ID to a dedicated server URL, or null for shared pool.
   */
  async resolve(environmentId: string | undefined): Promise<string | null> {
    if (this.closed || !environmentId || !isValidEnvironmentId(environmentId)) return null;

    const cached = this.cache.get(environmentId);
    if (cached && Date.now() < cached.expiresAt) {
      this.cache.delete(environmentId);
      this.cache.set(environmentId, cached);
      return cached.server ? `http://${cached.server.hostname}` : null;
    }
    if (cached) this.cache.delete(environmentId);

    // Deduplicate concurrent requests for the same environment
    const inflight = this.pending.get(environmentId);
    if (inflight) {
      try {
        const server = await inflight;
        return server ? `http://${server.hostname}` : null;
      } catch {
        return null;
      }
    }

    if (this.pending.size >= this.maxEntries) {
      logger.warn("[ServerResolver] Pending lookup limit reached");
      return null;
    }

    const promise = this.fetchServer(environmentId);
    this.pending.set(environmentId, promise);

    try {
      const server = await promise;
      // Only cache successful API responses (server found OR explicit "no server").
      // Transient errors (network failures, non-OK status) are NOT cached so the
      // next request retries the API instead of suppressing dedicated routing.
      if (!this.closed && this.normalizedCacheTtlMs > 0) {
        while (this.cache.size >= this.maxEntries) {
          const oldestKey = this.cache.keys().next().value;
          if (oldestKey === undefined) break;
          this.cache.delete(oldestKey);
        }
        this.cache.set(environmentId, {
          server,
          expiresAt: Date.now() + this.normalizedCacheTtlMs,
        });
      }
      return server ? `http://${server.hostname}` : null;
    } catch (error) {
      // Do not cache API errors. Use the shared pool for this request.
      if (!this.closed) {
        logger.warn("[ServerResolver] Transient error, skipping cache", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return null;
    } finally {
      this.pending.delete(environmentId);
    }
  }

  /** Aborts active lookups, clears cached state, and stops cache cleanup. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.lifecycleController.abort(new DOMException("Server resolver closed", "AbortError"));
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.pending.clear();
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
      response = await fetch(url, {
        headers,
        signal: AbortSignal.any([
          this.lifecycleController.signal,
          AbortSignal.timeout(FETCH_TIMEOUT_MS),
        ]),
      });
    } catch (error) {
      throw new ServerResolverError("Failed to reach dedicated server API", { cause: error });
    }

    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new ServerResolverError(`API returned ${response.status}`);
    }

    let data: unknown;
    try {
      data = JSON.parse(await readBoundedResponseText(response));
    } catch (error) {
      if (error instanceof ServerResolverError) throw error;
      throw new ServerResolverError("API returned invalid JSON", { cause: error });
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || !("server" in data)) {
      throw new ServerResolverError("API returned an invalid response payload");
    }
    const server = (data as Record<string, unknown>).server;
    if (server === null) return null;
    return parseDedicatedServer(server);
  }

  /** Removes entries whose cache lifetime has elapsed. */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now >= entry.expiresAt) this.cache.delete(key);
    }
  }
}
