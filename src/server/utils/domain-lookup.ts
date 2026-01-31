/**
 * Domain Lookup Utility
 *
 * Resolves custom domains to project information via API lookup.
 * Supports optional CacheRepository injection for testing and distributed caching.
 *
 * @module server/utils/domain-lookup
 */

import { logger } from "#veryfront/utils";
import { injectContext, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { CacheRepository } from "#veryfront/repositories/types.ts";

export interface DomainLookupResult {
  project_id: string;
  project_slug: string;
  project_name: string;
  environment: { id: string; name: string } | null;
  release_id: string | null;
}

export interface DomainLookupConfig {
  apiBaseUrl: string;
  apiToken: string;
}

interface CacheEntry {
  result: DomainLookupResult | null;
  expiresAt: number;
}

const DOMAIN_CACHE_TTL_MS = 60_000;
const DOMAIN_CACHE_MAX_ENTRIES = 1000;
/** Timeout for domain lookup API calls (10 seconds) */
const DOMAIN_LOOKUP_TIMEOUT_MS = 10_000;
/** TTL in seconds for external cache repository */
const DOMAIN_CACHE_TTL_SECONDS = 60;

const domainCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<DomainLookupResult | null>>();

/** Injected cache repository for testing or distributed caching */
let injectedCacheRepo: CacheRepository<string> | null = null;

function normalizeDomain(domain: string): string {
  return domain.replace(/:\d+$/, "").toLowerCase();
}

function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of domainCache) {
    if (entry.expiresAt < now) domainCache.delete(key);
  }
}

function evictOldestEntries(): void {
  if (domainCache.size < DOMAIN_CACHE_MAX_ENTRIES) return;

  const entries = [...domainCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const toRemove = Math.ceil(entries.length * 0.1);

  for (let i = 0; i < toRemove; i++) {
    const [key] = entries[i] ?? [];
    if (key) domainCache.delete(key);
  }
}

async function getCachedResult(
  cacheKey: string,
  domain: string,
): Promise<DomainLookupResult | null | undefined> {
  const now = Date.now();

  if (injectedCacheRepo) {
    const cached = await injectedCacheRepo.get(cacheKey);
    if (!cached) return undefined;

    const result = JSON.parse(cached) as DomainLookupResult | null;
    logger.debug("[DomainLookup] Repository cache hit", {
      domain,
      projectSlug: result?.project_slug,
    });
    return result;
  }

  const cached = domainCache.get(cacheKey);
  if (!cached || cached.expiresAt <= now) return undefined;

  logger.debug("[DomainLookup] Cache hit", {
    domain,
    projectSlug: cached.result?.project_slug,
    ttlRemaining: cached.expiresAt - now,
  });
  return cached.result;
}

function setCachedResult(
  cacheKey: string,
  result: DomainLookupResult | null,
): Promise<void> | void {
  if (injectedCacheRepo) {
    return injectedCacheRepo.set(cacheKey, JSON.stringify(result), DOMAIN_CACHE_TTL_SECONDS);
  }

  const now = Date.now();
  domainCache.set(cacheKey, { result, expiresAt: now + DOMAIN_CACHE_TTL_MS });

  if (domainCache.size > DOMAIN_CACHE_MAX_ENTRIES / 2) {
    cleanupExpiredEntries();
    evictOldestEntries();
  }
}

export function lookupProjectByDomain(
  domain: string,
  config: DomainLookupConfig,
): Promise<DomainLookupResult | null> {
  return withSpan(
    "server.domainLookup.lookup",
    async () => {
      const cacheKey = normalizeDomain(domain);

      const cached = await getCachedResult(cacheKey, domain);
      if (cached !== undefined) return cached;

      const inFlight = inFlightRequests.get(cacheKey);
      if (inFlight) {
        logger.debug("[DomainLookup] Waiting for in-flight request", { domain });
        return inFlight;
      }

      const requestPromise = fetchDomainLookup(domain, config);
      inFlightRequests.set(cacheKey, requestPromise);

      try {
        const result = await requestPromise;
        await setCachedResult(cacheKey, result);
        return result;
      } finally {
        inFlightRequests.delete(cacheKey);
      }
    },
    { "domain.lookup.domain": domain },
  );
}

interface ProjectEnvironment {
  id: string;
  name: string;
  domains?: string[];
  active_release_id?: string | null;
}

interface ProjectResponse {
  id: string;
  name: string;
  slug: string;
  environments?: ProjectEnvironment[];
}

function fetchDomainLookup(
  domain: string,
  config: DomainLookupConfig,
): Promise<DomainLookupResult | null> {
  return withSpan(
    "server.domainLookup.fetch",
    async () => {
      const domainWithoutPort = domain.replace(/:\d+$/, "");
      const normalizedDomain = domainWithoutPort.toLowerCase();
      const url = `${config.apiBaseUrl}/projects/${encodeURIComponent(domainWithoutPort)}`;

      logger.debug("[DomainLookup] Fetching from API", { domain, url });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DOMAIN_LOOKUP_TIMEOUT_MS);

      try {
        const headers = new Headers({
          Authorization: `Bearer ${config.apiToken}`,
          Accept: "application/json",
        });
        injectContext(headers);

        const response = await fetch(url, { headers, signal: controller.signal });

        if (response.status === 404) {
          logger.debug("[DomainLookup] No project found for domain", { domain });
          return null;
        }

        if (!response.ok) {
          logger.error("[DomainLookup] API error", {
            domain,
            status: response.status,
            statusText: response.statusText,
          });
          return null;
        }

        const project = (await response.json()) as ProjectResponse;

        const matchingEnv = project.environments?.find((env) =>
          env.domains?.some((d) => d.toLowerCase() === normalizedDomain)
        );

        const result: DomainLookupResult = {
          project_id: project.id,
          project_slug: project.slug,
          project_name: project.name,
          environment: matchingEnv ? { id: matchingEnv.id, name: matchingEnv.name } : null,
          release_id: matchingEnv?.active_release_id ?? null,
        };

        logger.debug("[DomainLookup] Domain lookup result", {
          domain,
          projectSlug: result.project_slug,
          environment: result.environment?.name,
        });

        return result;
      } catch (error) {
        const isTimeout = error instanceof Error && error.name === "AbortError";
        logger.error("[DomainLookup] Failed to lookup domain", {
          domain,
          error: error instanceof Error ? error.message : String(error),
          timeout: isTimeout,
        });
        return null;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    { "domain.fetch.domain": domain },
  );
}

export function clearDomainCache(): void {
  domainCache.clear();
  inFlightRequests.clear();

  if (injectedCacheRepo?.clear) void injectedCacheRepo.clear();

  logger.debug("[DomainLookup] Cache cleared");
}

export function getDomainCacheStats(): { size: number; maxSize: number } {
  return { size: domainCache.size, maxSize: DOMAIN_CACHE_MAX_ENTRIES };
}

/**
 * Inject a CacheRepository for testing or distributed caching.
 * Call with null to restore default Map-based caching.
 *
 * @example
 * ```typescript
 * import { MockCacheRepository, createMockRepositoryContext } from "#veryfront/repositories/testing";
 *
 * const mockCache = new MockCacheRepository({ context: createMockRepositoryContext() });
 * __injectCacheForTests(mockCache);
 *
 * // Run tests...
 *
 * __injectCacheForTests(null); // Restore default
 * ```
 */
export function __injectCacheForTests(cacheRepo: CacheRepository<string> | null): void {
  injectedCacheRepo = cacheRepo;
}

export function getEnvironmentType(
  result: DomainLookupResult | null,
): "preview" | "production" | undefined {
  const envName = result?.environment?.name.toLowerCase();
  if (!envName) return undefined;

  if (envName.includes("production") || envName === "prod") return "production";

  if (
    envName.includes("preview") || envName.includes("staging") || envName.includes("development")
  ) {
    return "preview";
  }

  return "production";
}
