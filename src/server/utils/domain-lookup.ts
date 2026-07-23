/**
 * Domain Lookup Utility
 *
 * Resolves custom domains to project information via API lookup.
 * Supports optional CacheRepository injection for testing and distributed caching.
 *
 * @module server/utils/domain-lookup
 */

import { logger as baseLogger } from "#veryfront/utils";
import { injectContext, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { CacheRepository } from "#veryfront/repositories/types.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerLRUCache } from "#veryfront/cache";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";

const logger = baseLogger.component("domain-lookup");

export interface DomainLookupResult {
  project_id: string;
  project_slug: string;
  project_name: string;
  environment: { id: string; name: string } | null;
  release_id: string | null;
}

/**
 * Thrown when a lookup cannot produce a trusted result. Callers must distinguish this
 * from a null return: null means the API confirmed a 404, while this error represents
 * an upstream, transport, cache, or response-validation failure.
 */
export class DomainLookupApiError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    _domain: string,
  ) {
    super(`Domain lookup API request failed with status ${status}`);
    this.name = "DomainLookupApiError";
  }
}

export interface DomainLookupConfig {
  apiBaseUrl: string;
  apiToken: string;
}

interface CacheEntry {
  result: DomainLookupResult | null;
}

const DOMAIN_CACHE_TTL_MS = 60_000;
const DOMAIN_CACHE_MAX_ENTRIES = 1000;
/** Timeout for domain lookup API calls (10 seconds) */
const DOMAIN_LOOKUP_TIMEOUT_MS = 10_000;
/** TTL in seconds for external cache repository */
const DOMAIN_CACHE_TTL_SECONDS = 60;
const DOMAIN_LOOKUP_CACHE_VERSION = "v2";
const DOMAIN_LOOKUP_MAX_CACHE_VALUE_BYTES = 16 * 1_024;
const DOMAIN_LOOKUP_MAX_RESPONSE_BYTES = 256 * 1_024;
const MAX_DOMAIN_LENGTH = 253;
const MAX_API_BASE_URL_LENGTH = 2_048;
const MAX_API_TOKEN_LENGTH = 16_384;
const MAX_PROJECT_ID_LENGTH = 512;
const MAX_PROJECT_NAME_LENGTH = 1_024;
const MAX_PROJECT_SLUG_LENGTH = 256;
const MAX_ENVIRONMENT_ID_LENGTH = 512;
const MAX_ENVIRONMENT_NAME_LENGTH = 512;
const MAX_RELEASE_ID_LENGTH = 512;
const MAX_ENVIRONMENTS = 1_000;
const MAX_DOMAINS_PER_ENVIRONMENT = 1_000;

class InvalidDomainLookupDataError extends Error {
  constructor(readonly category: string) {
    super("Domain lookup data is invalid");
    this.name = "InvalidDomainLookupDataError";
  }
}

const domainCache = new LRUCache<string, CacheEntry>({
  maxEntries: DOMAIN_CACHE_MAX_ENTRIES,
  ttlMs: DOMAIN_CACHE_TTL_MS,
});

// Register cache for monitoring
registerLRUCache("domain-lookup-cache", domainCache);

const inFlightRequests = new Map<string, Promise<DomainLookupResult | null>>();
let cacheGeneration = 0;

/** Injected cache repository for testing or distributed caching */
let injectedCacheRepo: CacheRepository<string> | null = null;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function normalizeDomain(domain: string): string {
  if (
    typeof domain !== "string" || domain.length === 0 ||
    domain.length > MAX_DOMAIN_LENGTH + 8 || hasControlCharacter(domain)
  ) {
    throw new TypeError("Domain lookup requires a valid domain");
  }

  let url: URL;
  try {
    url = new URL(`https://${domain}`);
  } catch {
    throw new TypeError("Domain lookup requires a valid domain");
  }

  if (
    url.username !== "" || url.password !== "" || url.pathname !== "/" ||
    url.search !== "" || url.hash !== ""
  ) {
    throw new TypeError("Domain lookup requires a valid domain");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname.length === 0 || hostname.length > MAX_DOMAIN_LENGTH) {
    throw new TypeError("Domain lookup requires a valid domain");
  }
  return hostname;
}

function normalizeApiBaseUrl(value: string): URL {
  if (
    typeof value !== "string" || value.length === 0 || value.length > MAX_API_BASE_URL_LENGTH ||
    hasControlCharacter(value)
  ) {
    throw new TypeError("Domain lookup API base URL is invalid");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Domain lookup API base URL is invalid");
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== ""
  ) {
    throw new TypeError("Domain lookup API base URL is invalid");
  }

  url.pathname = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
  return url;
}

function requireApiToken(value: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > MAX_API_TOKEN_LENGTH ||
    hasControlCharacter(value)
  ) {
    throw new TypeError("Domain lookup API token is invalid");
  }
  return value;
}

function buildLookupUrl(apiBaseUrl: URL, normalizedDomain: string): URL {
  const url = new URL(apiBaseUrl.href);
  const basePath = url.pathname === "/" ? "" : url.pathname;
  url.pathname = `${basePath}/projects/${encodeURIComponent(normalizedDomain)}`;
  return url;
}

async function createCacheKey(
  normalizedDomain: string,
  apiBaseUrl: URL,
  apiToken: string,
): Promise<string> {
  const material = JSON.stringify([apiBaseUrl.href, apiToken, normalizedDomain]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  const fingerprint = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return `domain-lookup:${DOMAIN_LOOKUP_CACHE_VERSION}:${fingerprint}`;
}

function requireBoundedString(value: unknown, maxLength: number): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > maxLength ||
    hasControlCharacter(value)
  ) {
    throw new InvalidDomainLookupDataError("invalid-string");
  }
  return value;
}

function parseNullableString(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  return requireBoundedString(value, maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCachedResult(value: unknown): DomainLookupResult | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new InvalidDomainLookupDataError("invalid-cache-entry");

  const environmentValue = value.environment;
  let environment: DomainLookupResult["environment"] = null;
  if (environmentValue !== null) {
    if (!isRecord(environmentValue)) {
      throw new InvalidDomainLookupDataError("invalid-cache-environment");
    }
    environment = {
      id: requireBoundedString(environmentValue.id, MAX_ENVIRONMENT_ID_LENGTH),
      name: requireBoundedString(environmentValue.name, MAX_ENVIRONMENT_NAME_LENGTH),
    };
  }

  return {
    project_id: requireBoundedString(value.project_id, MAX_PROJECT_ID_LENGTH),
    project_slug: requireBoundedString(value.project_slug, MAX_PROJECT_SLUG_LENGTH),
    project_name: requireBoundedString(value.project_name, MAX_PROJECT_NAME_LENGTH),
    environment,
    release_id: parseNullableString(value.release_id, MAX_RELEASE_ID_LENGTH),
  };
}

function parseProjectResponse(
  value: unknown,
  normalizedDomain: string,
): DomainLookupResult {
  if (!isRecord(value)) throw new InvalidDomainLookupDataError("invalid-envelope");

  const environmentsValue = value.environments;
  if (
    environmentsValue !== undefined &&
    (!Array.isArray(environmentsValue) || environmentsValue.length > MAX_ENVIRONMENTS)
  ) {
    throw new InvalidDomainLookupDataError("invalid-environments");
  }

  let matchingEnvironment: DomainLookupResult["environment"] = null;
  let releaseId: string | null = null;
  for (const environmentValue of environmentsValue ?? []) {
    if (!isRecord(environmentValue)) {
      throw new InvalidDomainLookupDataError("invalid-environment");
    }
    const id = requireBoundedString(environmentValue.id, MAX_ENVIRONMENT_ID_LENGTH);
    const name = requireBoundedString(environmentValue.name, MAX_ENVIRONMENT_NAME_LENGTH);
    const domainsValue = environmentValue.domains;
    if (
      domainsValue !== undefined &&
      (!Array.isArray(domainsValue) || domainsValue.length > MAX_DOMAINS_PER_ENVIRONMENT)
    ) {
      throw new InvalidDomainLookupDataError("invalid-environment-domains");
    }

    const domains = domainsValue ?? [];
    let matches = false;
    for (const candidate of domains) {
      if (typeof candidate !== "string" || candidate.length > MAX_DOMAIN_LENGTH + 8) {
        throw new InvalidDomainLookupDataError("invalid-environment-domain");
      }
      try {
        if (normalizeDomain(candidate) === normalizedDomain) matches = true;
      } catch {
        throw new InvalidDomainLookupDataError("invalid-environment-domain");
      }
    }

    const activeReleaseId = parseNullableString(
      environmentValue.active_release_id,
      MAX_RELEASE_ID_LENGTH,
    );
    if (matches && matchingEnvironment === null) {
      matchingEnvironment = { id, name };
      releaseId = activeReleaseId;
    }
  }

  return {
    project_id: requireBoundedString(value.id, MAX_PROJECT_ID_LENGTH),
    project_slug: requireBoundedString(value.slug, MAX_PROJECT_SLUG_LENGTH),
    project_name: requireBoundedString(value.name, MAX_PROJECT_NAME_LENGTH),
    environment: matchingEnvironment,
    release_id: releaseId,
  };
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json" ||
    (mediaType.startsWith("application/") && mediaType.endsWith("+json"));
}

function cancelResponseBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => {});
  } catch {
    // Cancellation is best effort and must not replace the lookup result.
  }
}

async function readProjectResponse(
  response: Response,
  normalizedDomain: string,
): Promise<DomainLookupResult> {
  if (!isJsonContentType(response.headers.get("content-type"))) {
    cancelResponseBody(response);
    throw new InvalidDomainLookupDataError("invalid-content-type");
  }

  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null && /^\d+$/.test(contentLength) &&
    Number(contentLength) > DOMAIN_LOOKUP_MAX_RESPONSE_BYTES
  ) {
    cancelResponseBody(response);
    throw new InvalidDomainLookupDataError("response-too-large");
  }

  const { text, truncated } = await readResponseTextPrefix(
    response,
    DOMAIN_LOOKUP_MAX_RESPONSE_BYTES + 1,
  );
  if (
    truncated || new TextEncoder().encode(text).byteLength > DOMAIN_LOOKUP_MAX_RESPONSE_BYTES
  ) {
    throw new InvalidDomainLookupDataError("response-too-large");
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new InvalidDomainLookupDataError("invalid-json");
  }
  return parseProjectResponse(value, normalizedDomain);
}

async function getCachedResult(
  cacheKey: string,
): Promise<DomainLookupResult | null | undefined> {
  if (injectedCacheRepo) {
    const cached = await injectedCacheRepo.get(cacheKey);
    if (cached === null || cached === undefined) return undefined;
    if (
      typeof cached !== "string" ||
      new TextEncoder().encode(cached).byteLength > DOMAIN_LOOKUP_MAX_CACHE_VALUE_BYTES
    ) {
      throw new InvalidDomainLookupDataError("invalid-cache-value");
    }

    let value: unknown;
    try {
      value = JSON.parse(cached);
    } catch {
      throw new InvalidDomainLookupDataError("invalid-cache-json");
    }
    const result = parseCachedResult(value);
    logger.debug("Repository cache hit", {
      cacheBackend: "repository",
      found: result !== null,
    });
    return result;
  }

  const cached = domainCache.get(cacheKey);
  if (!cached) return undefined;

  logger.debug("Cache hit", {
    cacheBackend: "memory",
    found: cached.result !== null,
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

  domainCache.set(cacheKey, { result });
}

export function lookupProjectByDomain(
  domain: string,
  config: DomainLookupConfig,
): Promise<DomainLookupResult | null> {
  return withSpan(
    "server.domainLookup.lookup",
    async () => {
      const normalizedDomain = normalizeDomain(domain);
      const apiBaseUrl = normalizeApiBaseUrl(config.apiBaseUrl);
      const apiToken = requireApiToken(config.apiToken);
      const cacheKey = await createCacheKey(normalizedDomain, apiBaseUrl, apiToken);

      let cached: DomainLookupResult | null | undefined;
      try {
        cached = await getCachedResult(cacheKey);
      } catch (error) {
        logger.error("Domain lookup cache read failed", {
          cacheBackend: injectedCacheRepo ? "repository" : "memory",
          errorName: error instanceof Error ? error.name : typeof error,
        });
        throw new DomainLookupApiError(502, "Bad Gateway", normalizedDomain);
      }
      if (cached !== undefined) return cached;

      const inFlight = inFlightRequests.get(cacheKey);
      if (inFlight) {
        logger.debug("Waiting for in-flight request", { deduplicated: true });
        return inFlight;
      }

      const requestPromise = fetchDomainLookup(
        normalizedDomain,
        buildLookupUrl(apiBaseUrl, normalizedDomain),
        apiToken,
      );
      const requestCacheGeneration = cacheGeneration;
      inFlightRequests.set(cacheKey, requestPromise);

      try {
        const result = await requestPromise;
        if (requestCacheGeneration === cacheGeneration) {
          try {
            await setCachedResult(cacheKey, result);
          } catch (error) {
            logger.error("Domain lookup cache write failed", {
              cacheBackend: injectedCacheRepo ? "repository" : "memory",
              errorName: error instanceof Error ? error.name : typeof error,
            });
            throw new DomainLookupApiError(502, "Bad Gateway", normalizedDomain);
          }
        }
        return result;
      } finally {
        if (inFlightRequests.get(cacheKey) === requestPromise) {
          inFlightRequests.delete(cacheKey);
        }
      }
    },
  );
}

function fetchDomainLookup(
  normalizedDomain: string,
  url: URL,
  apiToken: string,
): Promise<DomainLookupResult | null> {
  return withSpan(
    "server.domainLookup.fetch",
    async () => {
      logger.debug("Fetching domain mapping from API");

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
        DOMAIN_LOOKUP_TIMEOUT_MS,
      );

      try {
        const headers = new Headers({
          Authorization: `Bearer ${apiToken}`,
          Accept: "application/json",
        });
        injectContext(headers);

        const response = await fetch(url, {
          cache: "no-store",
          headers,
          redirect: "error",
          signal: controller.signal,
        });

        if (response.status === 404) {
          cancelResponseBody(response);
          logger.debug("Domain mapping not found", { found: false });
          return null;
        }

        if (!response.ok) {
          cancelResponseBody(response);
          logger.error("Domain lookup API rejected the request", {
            status: response.status,
          });
          throw new DomainLookupApiError(
            response.status,
            response.statusText,
            normalizedDomain,
          );
        }

        const result = await readProjectResponse(response, normalizedDomain);

        logger.debug("Domain lookup result", {
          found: true,
          hasEnvironment: result.environment !== null,
          hasRelease: result.release_id !== null,
        });

        return result;
      } catch (error) {
        if (error instanceof DomainLookupApiError) throw error;

        const isTimeout = controller.signal.aborted;
        logger.error("Domain lookup request failed", {
          errorName: error instanceof Error ? error.name : typeof error,
          failureCategory: error instanceof InvalidDomainLookupDataError
            ? error.category
            : isTimeout
            ? "timeout"
            : "network",
          timeout: isTimeout,
        });
        throw new DomainLookupApiError(
          isTimeout ? 504 : 502,
          isTimeout ? "Gateway Timeout" : "Bad Gateway",
          normalizedDomain,
        );
      } finally {
        clearTimeout(timeoutId);
      }
    },
  );
}

export function clearDomainCache(): void {
  cacheGeneration++;
  domainCache.clear();
  inFlightRequests.clear();

  if (injectedCacheRepo?.clear) {
    try {
      void injectedCacheRepo.clear().catch((error) => {
        logger.error("Domain lookup repository cache clear failed", {
          errorName: error instanceof Error ? error.name : typeof error,
        });
      });
    } catch (error) {
      logger.error("Domain lookup repository cache clear failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  logger.debug("Cache cleared");
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

  // Unknown environment names default to "preview" (safe: does not expose released/production
  // content to the public). Defaulting to "production" for an unknown env name would risk
  // serving production content to users on environments that are not intentionally public.
  return "preview";
}
