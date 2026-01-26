import * as dntShim from "../../../_dnt.shims.js";
import { logger } from "../../utils/index.js";
import { injectContext, withSpan } from "../../observability/tracing/otlp-setup.js";

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

const domainCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<DomainLookupResult | null>>();

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
    const entry = entries[i];
    if (entry) domainCache.delete(entry[0]);
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
      const now = Date.now();

      const cached = domainCache.get(cacheKey);
      if (cached?.expiresAt && cached.expiresAt > now) {
        logger.debug("[DomainLookup] Cache hit", {
          domain,
          projectSlug: cached.result?.project_slug,
          ttlRemaining: cached.expiresAt - now,
        });
        return cached.result;
      }

      const inFlight = inFlightRequests.get(cacheKey);
      if (inFlight) {
        logger.debug("[DomainLookup] Waiting for in-flight request", { domain });
        return inFlight;
      }

      const requestPromise = fetchDomainLookup(domain, config);
      inFlightRequests.set(cacheKey, requestPromise);

      try {
        const result = await requestPromise;

        domainCache.set(cacheKey, {
          result,
          expiresAt: now + DOMAIN_CACHE_TTL_MS,
        });

        if (domainCache.size > DOMAIN_CACHE_MAX_ENTRIES / 2) {
          cleanupExpiredEntries();
          evictOldestEntries();
        }

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

      try {
        const headers = new dntShim.Headers({
          Authorization: `Bearer ${config.apiToken}`,
          Accept: "application/json",
        });
        injectContext(headers);

        const response = await dntShim.fetch(url, { headers });

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
        logger.error("[DomainLookup] Failed to lookup domain", {
          domain,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    { "domain.fetch.domain": domain },
  );
}

export function clearDomainCache(): void {
  domainCache.clear();
  inFlightRequests.clear();
  logger.debug("[DomainLookup] Cache cleared");
}

export function getDomainCacheStats(): { size: number; maxSize: number } {
  return { size: domainCache.size, maxSize: DOMAIN_CACHE_MAX_ENTRIES };
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
