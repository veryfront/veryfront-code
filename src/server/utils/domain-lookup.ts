/**
 * Domain Lookup Service
 *
 * Resolves custom domains to project slugs and environments.
 * Used for JIT rendering of production sites with custom domains.
 *
 * Results are cached to avoid API calls on every request.
 */

import { logger } from "@veryfront/utils";
import { injectContext } from "@veryfront/observability/tracing/otlp-setup.ts";

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

/**
 * Domain lookup cache entry.
 * Stores both successful results and 404s to prevent repeated lookups.
 */
interface CacheEntry {
  result: DomainLookupResult | null;
  expiresAt: number;
}

/** Cache TTL in milliseconds (60 seconds) */
const DOMAIN_CACHE_TTL_MS = 60_000;

/** Maximum cache entries before cleanup */
const DOMAIN_CACHE_MAX_ENTRIES = 1000;

/** In-memory cache for domain lookups */
const domainCache = new Map<string, CacheEntry>();

/** In-flight requests to prevent duplicate API calls */
const inFlightRequests = new Map<string, Promise<DomainLookupResult | null>>();

/**
 * Get cache key for domain lookup.
 */
function getCacheKey(domain: string): string {
  return domain.replace(/:\d+$/, "").toLowerCase();
}

/**
 * Clean up expired cache entries.
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of domainCache) {
    if (entry.expiresAt < now) {
      domainCache.delete(key);
    }
  }
}

/**
 * Evict oldest entries if cache is too large.
 */
function evictOldestEntries(): void {
  if (domainCache.size < DOMAIN_CACHE_MAX_ENTRIES) return;

  // Convert to array and sort by expiration time
  const entries = [...domainCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);

  // Remove oldest 10%
  const toRemove = Math.ceil(entries.length * 0.1);
  for (let i = 0; i < toRemove; i++) {
    const entry = entries[i];
    if (entry) {
      domainCache.delete(entry[0]);
    }
  }
}

/**
 * Look up project info by custom domain.
 * Results are cached to avoid API calls on every request.
 *
 * @param domain - The domain to look up
 * @param config - API configuration
 * @returns The domain lookup result or null if not found
 */
export async function lookupProjectByDomain(
  domain: string,
  config: DomainLookupConfig,
): Promise<DomainLookupResult | null> {
  const cacheKey = getCacheKey(domain);
  const now = Date.now();

  // Check cache first
  const cached = domainCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    logger.debug("[DomainLookup] Cache hit", {
      domain,
      projectSlug: cached.result?.project_slug,
      ttlRemaining: cached.expiresAt - now,
    });
    return cached.result;
  }

  // Check for in-flight request to prevent duplicate API calls
  const inFlight = inFlightRequests.get(cacheKey);
  if (inFlight) {
    logger.debug("[DomainLookup] Waiting for in-flight request", { domain });
    return inFlight;
  }

  // Make API call
  const requestPromise = fetchDomainLookup(domain, config);
  inFlightRequests.set(cacheKey, requestPromise);

  try {
    const result = await requestPromise;

    // Cache the result (including nulls for 404s)
    domainCache.set(cacheKey, {
      result,
      expiresAt: now + DOMAIN_CACHE_TTL_MS,
    });

    // Cleanup periodically
    if (domainCache.size > DOMAIN_CACHE_MAX_ENTRIES / 2) {
      cleanupExpiredEntries();
      evictOldestEntries();
    }

    return result;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

/**
 * Internal function to fetch domain lookup from API.
 */
async function fetchDomainLookup(
  domain: string,
  config: DomainLookupConfig,
): Promise<DomainLookupResult | null> {
  const domainWithoutPort = domain.replace(/:\d+$/, "");
  const encodedDomain = encodeURIComponent(domainWithoutPort);
  const url = `${config.apiBaseUrl}/lookup/domain/${encodedDomain}`;

  logger.debug("[DomainLookup] Fetching from API", { domain, url });

  try {
    const headers = new Headers({
      Authorization: `Bearer ${config.apiToken}`,
      Accept: "application/json",
    });
    injectContext(headers);

    const response = await fetch(url, { headers });

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

    const result = await response.json() as DomainLookupResult;

    logger.debug("[DomainLookup] Domain lookup result", {
      domain,
      projectSlug: result.project_slug,
      environment: result.environment?.name,
    });

    return result;
  } catch (error) {
    logger.error("[DomainLookup] Failed to lookup domain", {
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Clear the domain lookup cache.
 * Useful for testing or when domains are updated.
 */
export function clearDomainCache(): void {
  domainCache.clear();
  inFlightRequests.clear();
  logger.debug("[DomainLookup] Cache cleared");
}

/**
 * Get cache statistics for monitoring.
 */
export function getDomainCacheStats(): { size: number; maxSize: number } {
  return {
    size: domainCache.size,
    maxSize: DOMAIN_CACHE_MAX_ENTRIES,
  };
}

/**
 * Determine the environment type from the lookup result.
 */
export function getEnvironmentType(
  result: DomainLookupResult | null,
): "preview" | "production" | undefined {
  if (!result?.environment) {
    return undefined;
  }

  const envName = result.environment.name.toLowerCase();

  // Production environments typically contain "production" or "prod"
  if (envName.includes("production") || envName === "prod") {
    return "production";
  }

  // Preview/staging environments
  if (
    envName.includes("preview") || envName.includes("staging") ||
    envName.includes("development")
  ) {
    return "preview";
  }

  // Default to production for custom domains (most common use case)
  return "production";
}
