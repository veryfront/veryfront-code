import { TokenManager, type TokenScope } from "./token-manager.ts";
import { OAuthTokenRequestError } from "./oauth-client.ts";
import { parseProjectDomain } from "#veryfront/server/utils/domain-parser.ts";
import type { TokenCache } from "./cache/types.ts";
import type { CacheStats } from "./cache/types.ts";
export type { CacheStats, TokenCache, TokenCacheEntry } from "./cache/types.ts";
import { injectContext, ProxySpanNames, sanitizeProxySpanUrl, withSpan } from "./tracing.ts";
import { computeContentSourceId } from "#veryfront/cache/keys.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { checkProtectedProxyAccess } from "./proxy-access-control.ts";
import { createLocalProjectResolver } from "./local-project-resolver.ts";
import {
  isMissingCustomDomainProjectError,
  resolveProxyRequestToken,
} from "./proxy-token-resolution.ts";
import {
  createProjectNotFoundProxyContext,
  createProxyErrorContext,
  createReleaseNotFoundProxyContext,
} from "./proxy-error-context.ts";
import { profileProxyServerTimingPhase, type ProxyServerTiming } from "./server-timing.ts";
import { isVerifiedInternalControlPlaneRequest } from "./control-plane-signature.ts";
import { hasControlCharacter, parseIntegerSetting } from "./env.ts";
import { createLinkedRequestTimeout } from "./request-lifecycle.ts";

export { __resetCachedAuthProviderForTests } from "./proxy-access-control.ts";

/** Headers owned by the proxy and never trusted from an inbound client. */
export const INTERNAL_PROXY_HEADERS = [
  "forwarded",
  "x-token",
  "x-project-slug",
  "x-environment",
  "x-environment-id",
  "x-content-source-id",
  "x-forwarded-host",
  "x-forwarded-for",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
  "x-project-path",
  "x-project-id",
  "x-release-id",
  "x-branch-id",
  "x-branch-name",
] as const;

interface ProjectRoutingLookupResult {
  id: string;
  slug: string;
  name: string;
  environments?: Array<{
    id: string;
    name: string;
    domains?: string[];
    active_release_id?: string | null;
  }>;
}

interface ProjectAccessLookupResult {
  id: string;
  slug: string;
  users?: Array<{ id: string }>;
  environments?: Array<{
    id: string;
    name: string;
    domains?: string[];
    protected?: boolean;
  }>;
}

interface DomainLookupResult extends ProjectRoutingLookupResult {
  users?: Array<{ id: string }>;
  environments?: Array<{
    id: string;
    name: string;
    domains?: string[];
    active_release_id?: string | null;
    protected?: boolean;
  }>;
}

type ProjectLookupEnvironment = {
  id: string;
  name: string;
  domains?: string[];
};

interface ProjectRoutingCacheEntry {
  value: ProjectRoutingLookupResult;
  expiresAt: number;
}

interface ProjectRoutingInflightEntry {
  generation: number;
  promise: Promise<ProjectRoutingLookupResult | null>;
}

const DEFAULT_PROXY_ROUTING_CACHE_TTL_MS = 60_000;
const DEFAULT_PROXY_ROUTING_CACHE_MAX_ENTRIES = 1_000;
const DEFAULT_PROXY_METADATA_LOOKUP_TIMEOUT_MS = 10_000;
const DEFAULT_PROXY_METADATA_RESPONSE_MAX_BYTES = 1_048_576;
const MAX_PROXY_ROUTING_CACHE_TTL_MS = 86_400_000;
const MAX_PROXY_ROUTING_CACHE_ENTRIES = 10_000;
const MAX_PROXY_METADATA_LOOKUP_TIMEOUT_MS = 60_000;
const MAX_PROXY_METADATA_RESPONSE_BYTES = 4_194_304;
const MAX_PROXY_LOOKUP_STRING_LENGTH = 4_096;
const MAX_PROXY_LOOKUP_ENVIRONMENTS = 1_000;
const MAX_PROXY_LOOKUP_DOMAINS = 1_000;
const MAX_PROXY_LOOKUP_USERS = 10_000;
const MAX_PROXY_LOOKUP_EMPTY_BODY_CHUNKS = 100;
const MAX_ROUTING_LOOKUP_INVALIDATION_RETRIES = 2;

function readBoundedIntegerEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return parseIntegerSetting(name, getEnv(name), fallback, minimum, maximum);
}

function readPositiveIntegerOption(
  name: string,
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function normalizeProjectLookupKey(lookupKey: string): string {
  return lookupKey.trim().replace(/:\d+$/, "").toLowerCase();
}

type ProxyLookupType = "domain" | "routing" | "access";

class ProxyLookupAuthError extends Error {
  constructor(
    readonly lookupType: ProxyLookupType,
    readonly status: number,
  ) {
    super(`Proxy ${lookupType} lookup rejected service token: ${status}`);
    this.name = "ProxyLookupAuthError";
  }
}

class ProxyRoutingInvalidationRaceError extends Error {
  constructor() {
    super("Project routing changed during request; retry");
    this.name = "ProxyRoutingInvalidationRaceError";
  }
}

class ProxyLookupUnavailableError extends Error {
  constructor(
    readonly lookupType: ProxyLookupType,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(`Proxy ${lookupType} metadata service unavailable`, options);
    this.name = "ProxyLookupUnavailableError";
  }
}

function isProxyLookupAuthError(error: unknown): error is ProxyLookupAuthError {
  return error instanceof ProxyLookupAuthError;
}

function throwIfProxyLookupAuthFailure(status: number, lookupType: ProxyLookupType): void {
  if (status === 401 || status === 403) {
    throw new ProxyLookupAuthError(lookupType, status);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_PROXY_LOOKUP_STRING_LENGTH && !hasControlCharacter(value);
}

function hasValidEnvironments(value: unknown, access: boolean): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > MAX_PROXY_LOOKUP_ENVIRONMENTS) return false;

  return value.every((environment) => {
    if (
      !isRecord(environment) || !isBoundedString(environment.id) ||
      !isBoundedString(environment.name)
    ) return false;
    if (
      environment.domains !== undefined &&
      (!Array.isArray(environment.domains) ||
        environment.domains.length > MAX_PROXY_LOOKUP_DOMAINS ||
        !environment.domains.every(isBoundedString))
    ) return false;
    if (
      !access && environment.active_release_id !== undefined &&
      environment.active_release_id !== null &&
      !isBoundedString(environment.active_release_id)
    ) return false;
    return !access || environment.protected === undefined ||
      typeof environment.protected === "boolean";
  });
}

function isProjectRoutingLookupResult(value: unknown): value is ProjectRoutingLookupResult {
  return isRecord(value) && isBoundedString(value.id) && isBoundedString(value.slug) &&
    isBoundedString(value.name) && hasValidEnvironments(value.environments, false);
}

function isProjectAccessLookupResult(value: unknown): value is ProjectAccessLookupResult {
  if (
    !isRecord(value) || !isBoundedString(value.id) || !isBoundedString(value.slug) ||
    !hasValidEnvironments(value.environments, true)
  ) return false;
  if (value.users === undefined) return true;
  return Array.isArray(value.users) && value.users.length <= MAX_PROXY_LOOKUP_USERS &&
    value.users.every((user) => isRecord(user) && isBoundedString(user.id));
}

function isDomainLookupResult(value: unknown): value is DomainLookupResult {
  return isProjectRoutingLookupResult(value) && isProjectAccessLookupResult(value);
}

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > maximumBytes) {
      await response.body?.cancel();
      throw new Error("Proxy metadata response exceeded the allowed size");
    }
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Proxy metadata response body is missing");
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let emptyChunks = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      if (value.byteLength === 0) {
        emptyChunks++;
        if (emptyChunks >= MAX_PROXY_LOOKUP_EMPTY_BODY_CHUNKS) {
          throw new Error("Proxy metadata response body made no progress");
        }
        continue;
      }
      emptyChunks = 0;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        throw new Error("Proxy metadata response exceeded the allowed size");
      }
      chunks.push(value);
    }
  } finally {
    if (!complete) {
      try {
        await reader.cancel();
      } catch {
        // Cancellation is best effort and must not mask the protocol error.
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // A non-conforming stream must not mask the protocol error.
    }
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}

async function fetchProxyLookup<T>(input: {
  url: URL;
  headers: Headers;
  lookupType: ProxyLookupType;
  timeoutMs: number;
  maximumResponseBytes: number;
  requestSignal?: AbortSignal;
  validate: (value: unknown) => value is T;
}): Promise<T | null> {
  const passiveSignal = new AbortController().signal;
  const linkedTimeout = createLinkedRequestTimeout(
    input.requestSignal ?? passiveSignal,
    input.timeoutMs,
  );
  try {
    const response = await fetch(input.url, {
      headers: input.headers,
      redirect: "error",
      signal: linkedTimeout.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throwIfProxyLookupAuthFailure(response.status, input.lookupType);
      if (response.status === 404) return null;
      throw new ProxyLookupUnavailableError(input.lookupType, response.status);
    }

    const value = await readBoundedJson(response, input.maximumResponseBytes);
    if (!input.validate(value)) {
      throw new ProxyLookupUnavailableError(input.lookupType);
    }
    return value;
  } finally {
    linkedTimeout.cleanup();
  }
}

function throwIfRequestAborted(signal: AbortSignal, error: unknown): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw error;
}

async function lookupProjectByDomain(
  domain: string,
  apiBaseUrl: string,
  token: string,
  timeoutMs: number,
  maximumResponseBytes: number,
  requestSignal: AbortSignal,
  logger?: ProxyLogger,
): Promise<DomainLookupResult | null> {
  return withSpan(
    ProxySpanNames.PROXY_DOMAIN_LOOKUP,
    async () => {
      const domainWithoutPort = domain.replace(/:\d+$/, "");
      const url = `${apiBaseUrl}/projects/${encodeURIComponent(domainWithoutPort)}`;
      const urlObj = new URL(url);

      logger?.debug("Looking up project by domain", { domain });

      const headers = new Headers({
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      });
      injectContext(headers);

      try {
        const result = await withSpan(
          ProxySpanNames.HTTP_CLIENT_FETCH,
          () =>
            fetchProxyLookup({
              url: urlObj,
              headers,
              lookupType: "domain",
              timeoutMs,
              maximumResponseBytes,
              requestSignal,
              validate: isDomainLookupResult,
            }),
          {
            "http.method": "GET",
            "http.url": sanitizeProxySpanUrl(urlObj),
            "http.host": urlObj.host,
            "proxy.domain_lookup": domain,
          },
        );

        if (!result) return null;
        logger?.debug("Domain lookup successful", {
          domain,
          projectSlug: result.slug,
          environments: result.environments?.map((e) => e.name),
        });
        return result;
      } catch (error) {
        throwIfRequestAborted(requestSignal, error);
        if (isProxyLookupAuthError(error)) throw error;
        const unavailable = error instanceof ProxyLookupUnavailableError
          ? error
          : new ProxyLookupUnavailableError("domain", undefined, { cause: error });
        logger?.error("Domain lookup failed", unavailable, {
          domain,
          status: unavailable.status,
        });
        throw unavailable;
      }
    },
    { "proxy.domain": domain },
  );
}

async function lookupProjectRoutingMetadata(
  lookupKey: string,
  apiBaseUrl: string,
  token: string,
  timeoutMs: number,
  maximumResponseBytes: number,
  logger?: ProxyLogger,
): Promise<ProjectRoutingLookupResult | null> {
  return withSpan(
    ProxySpanNames.PROXY_DOMAIN_LOOKUP,
    async () => {
      const normalizedLookupKey = normalizeProjectLookupKey(lookupKey);
      const url = `${apiBaseUrl}/projects/-/proxy-routing/${
        encodeURIComponent(normalizedLookupKey)
      }`;
      const urlObj = new URL(url);

      logger?.debug("Looking up project proxy routing metadata", { lookupKey });

      const headers = new Headers({
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      });
      injectContext(headers);

      try {
        const result = await withSpan(
          ProxySpanNames.HTTP_CLIENT_FETCH,
          () =>
            fetchProxyLookup({
              url: urlObj,
              headers,
              lookupType: "routing",
              timeoutMs,
              maximumResponseBytes,
              validate: isProjectRoutingLookupResult,
            }),
          {
            "http.method": "GET",
            "http.url": sanitizeProxySpanUrl(urlObj),
            "http.host": urlObj.host,
            "proxy.routing_lookup": normalizedLookupKey,
          },
        );

        if (!result) return null;
        logger?.debug("Proxy routing metadata lookup successful", {
          lookupKey,
          projectSlug: result.slug,
          environments: result.environments?.map((e) => e.name),
        });
        return result;
      } catch (error) {
        if (isProxyLookupAuthError(error)) throw error;
        const unavailable = error instanceof ProxyLookupUnavailableError
          ? error
          : new ProxyLookupUnavailableError("routing", undefined, { cause: error });
        logger?.error("Proxy routing metadata lookup failed", unavailable, {
          lookupKey,
          status: unavailable.status,
        });
        throw unavailable;
      }
    },
    { "proxy.lookup_key": lookupKey },
  );
}

async function lookupProjectAccessMetadata(
  lookupKey: string,
  apiBaseUrl: string,
  token: string,
  includeUsers: boolean,
  timeoutMs: number,
  maximumResponseBytes: number,
  requestSignal: AbortSignal,
  logger?: ProxyLogger,
): Promise<ProjectAccessLookupResult | null> {
  return withSpan(
    ProxySpanNames.PROXY_DOMAIN_LOOKUP,
    async () => {
      const normalizedLookupKey = normalizeProjectLookupKey(lookupKey);
      const url = `${apiBaseUrl}/projects/-/proxy-access/${
        encodeURIComponent(normalizedLookupKey)
      }?include_users=${includeUsers ? "true" : "false"}`;
      const urlObj = new URL(url);

      logger?.debug("Looking up project proxy access metadata", { lookupKey, includeUsers });

      const headers = new Headers({
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      });
      injectContext(headers);

      try {
        const result = await withSpan(
          ProxySpanNames.HTTP_CLIENT_FETCH,
          () =>
            fetchProxyLookup({
              url: urlObj,
              headers,
              lookupType: "access",
              timeoutMs,
              maximumResponseBytes,
              requestSignal,
              validate: isProjectAccessLookupResult,
            }),
          {
            "http.method": "GET",
            "http.url": sanitizeProxySpanUrl(urlObj),
            "http.host": urlObj.host,
            "proxy.access_lookup": normalizedLookupKey,
          },
        );

        if (!result) return null;
        logger?.debug("Proxy access metadata lookup successful", {
          lookupKey,
          projectSlug: result.slug,
          environments: result.environments?.map((e) => e.name),
          userCount: result.users?.length ?? 0,
        });
        return result;
      } catch (error) {
        throwIfRequestAborted(requestSignal, error);
        if (isProxyLookupAuthError(error)) throw error;
        const unavailable = error instanceof ProxyLookupUnavailableError
          ? error
          : new ProxyLookupUnavailableError("access", undefined, { cause: error });
        logger?.error("Proxy access metadata lookup failed", unavailable, {
          lookupKey,
          status: unavailable.status,
        });
        throw unavailable;
      }
    },
    { "proxy.lookup_key": lookupKey },
  );
}

/** Runtime credentials and local-project mappings used by the proxy handler. */
export interface ProxyConfig {
  /** Validated Veryfront API base URL. */
  apiBaseUrl: string;
  /** Production service-account client identifier. */
  apiClientId: string;
  /** Production service-account client secret. */
  apiClientSecret: string;
  /** Preview service-account client identifier. */
  previewApiClientId: string;
  /** Preview service-account client secret. */
  previewApiClientSecret: string;
  /** Optional static token used only when service credentials are unavailable. */
  apiToken?: string;
  /** Optional map of project slugs to local filesystem paths. */
  localProjects?: Record<string, string>;
}

/** Domain classification required by proxy routing consumers. */
export interface ProxyParsedDomain {
  /** Parsed project slug, when present. */
  slug: string | null;
  /** Parsed preview branch, when present. */
  branch: string | null;
  /** Parsed deployment environment. */
  environment: "preview" | "development" | "staging" | "production" | null;
  /** Whether the host belongs to a recognized Veryfront domain. */
  isVeryfrontDomain: boolean;
  /** Whether the host resolves draft content. */
  isDraft: boolean;
  /** Whether the host permits iframe embedding. */
  allowIframeEmbed: boolean;
}

/** Public error attached to an unresolved proxy request context. */
export interface ProxyContextError {
  /** HTTP response status. */
  status: number;
  /** Public error message. */
  message: string;
  /** Stable error-page discriminator. */
  slug?: string;
  /** Approved sign-in redirect URL. */
  redirectUrl?: string;
}

/** Fully resolved routing and authorization context for one proxy request. */
export interface ProxyContext {
  /** Token selected for the renderer or API. */
  token?: string;
  /** Resolved project slug. */
  projectSlug?: string;
  /** Resolved project identifier. */
  projectId?: string;
  /** Active release identifier. */
  releaseId?: string;
  /** Preview branch identifier. */
  branchId?: string;
  /** Preview branch name. */
  branchName?: string;
  /** Resolved environment identifier. */
  environmentId?: string;
  /** Runtime token scope. */
  environment: "preview" | "production";
  /** Cache-safe content-source identity. */
  contentSourceId: string;
  /** Local project path, when local routing is enabled. */
  localPath?: string;
  /** Normalized request host. */
  host: string;
  /** Parsed request-domain classification. */
  parsedDomain: ProxyParsedDomain;
  /** Whether the request resolves a configured local project. */
  isLocalProject: boolean;
  /** Routing or authorization failure, when resolution did not succeed. */
  error?: ProxyContextError;
}

type ResolvedProjectMetadata =
  | { projectId?: string; projectSlug?: string; releaseId?: string; environmentId?: string }
  | { error: { status: number; message: string; redirectUrl?: string } };

/** Logger contract accepted by the proxy handler. */
export interface ProxyLogger {
  /** Write diagnostic context. */
  debug: (msg: string, extra?: Record<string, unknown>) => void;
  /** Write normal operational context. */
  info: (msg: string, extra?: Record<string, unknown>) => void;
  /** Write recoverable failure context. */
  warn: (msg: string, extra?: Record<string, unknown>) => void;
  /** Write a contained error and sanitized context. */
  error: (msg: string, error?: Error, extra?: Record<string, unknown>) => void;
}

/** Construction options for a proxy request handler. */
export interface ProxyHandlerOptions {
  /** Runtime credentials and endpoint configuration. */
  config: ProxyConfig;
  /** Optional shared token cache. */
  cache?: TokenCache;
  /** Optional structured logger. */
  logger?: ProxyLogger;
  /** Metadata request deadline in milliseconds. */
  metadataLookupTimeoutMs?: number;
  /** Maximum accepted metadata response body size. */
  metadataResponseMaxBytes?: number;
}

/** Optional instrumentation inputs for one proxy request. */
export interface ProxyRequestOptions {
  /** Request URL parsed by the caller. */
  url?: URL;
  /** Mutable server-timing accumulator for the request. */
  timing?: ProxyRequestTiming;
}

/** Server-timing state consumed while resolving a proxy request. */
export interface ProxyRequestTiming {
  /** Whether server-timing metrics are enabled. */
  enabled: boolean;
  /** High-resolution request start time. */
  startedAt: number;
  /** Accumulated phase durations in milliseconds. */
  phases: Map<string, number>;
}

/** Routing-cache invalidation received after deployment state changes. */
export interface ProxyRoutingInvalidation {
  /** Project identifier whose routing changed. */
  projectId: string;
  /** Project slug, when supplied by the publisher. */
  projectSlug?: string;
  /** Deployment identifier that caused the invalidation. */
  deploymentId?: string;
  /** Environment identifier that changed. */
  environmentId?: string;
  /** Environment name that changed. */
  environmentName?: string;
  /** Newly active release identifier. */
  releaseId?: string;
}

/** Invalidation with all fields required for convergence confirmation. */
export interface ConfirmedProxyRoutingInvalidation extends ProxyRoutingInvalidation {
  /** Project slug used to refresh routing metadata. */
  projectSlug: string;
  /** Environment identifier expected after refresh. */
  environmentId: string;
  /** Environment name used to select token scope. */
  environmentName: string;
  /** Release identifier expected after refresh. */
  releaseId: string;
}

/** Result of applying one routing-cache invalidation. */
export interface ProxyRoutingInvalidationResult {
  /** Number of cached lookups removed. */
  evictedEntries: number;
  /** Monotonic invalidation generation. */
  generation: number;
}

/** Stateful proxy request handler. */
export interface ProxyHandler {
  /** Resolve routing and authorization for one request. */
  processRequest(req: Request, options?: ProxyRequestOptions): Promise<ProxyContext>;
  /** Resolve the token used by the BFF API route. */
  getTokenForApi(req: Request, options?: ProxyRequestOptions): Promise<string | undefined>;
  /** Return current token-cache statistics. */
  getStats(): Promise<CacheStats>;
  /** Release token-cache resources. */
  close(): Promise<void>;
  /** Return required credential environment variable names that are not configured. */
  validateConfig(): string[];
  /** Evict routing metadata associated with a deployment change. */
  invalidateRoutingLookup(input: ProxyRoutingInvalidation): ProxyRoutingInvalidationResult;
  /** Evict and synchronously confirm canonical routing convergence. */
  invalidateAndConfirmRoutingLookup(input: ConfirmedProxyRoutingInvalidation): Promise<void>;
  /** Immutable local-project mapping captured at construction time. */
  readonly localProjects: Readonly<Record<string, string>>;
}

function getRequestHost(req: Request, url: URL): string {
  return req.headers.get("host") ?? url.host;
}

function getScope(environment: string | null): TokenScope {
  return environment === "preview" ? "preview" : "production";
}

function parseStatusFromError(error: unknown): number | null {
  // Fresh and negatively cached token failures share the same typed error.
  if (error instanceof OAuthTokenRequestError) return error.status;
  return null;
}

/** Create an isolated stateful proxy request handler. */
export function createProxyHandler(options: ProxyHandlerOptions): ProxyHandler {
  const { cache, logger } = options;
  if (typeof options.config.apiBaseUrl !== "string" || options.config.apiBaseUrl.length > 4_096) {
    throw new TypeError("Proxy API base URL must be a string of at most 4096 characters");
  }
  const inputApiBaseUrl = new URL(options.config.apiBaseUrl);
  if (
    (inputApiBaseUrl.protocol !== "http:" && inputApiBaseUrl.protocol !== "https:") ||
    inputApiBaseUrl.username || inputApiBaseUrl.password || inputApiBaseUrl.search ||
    inputApiBaseUrl.hash
  ) {
    throw new TypeError(
      "Proxy API base URL must be an HTTP(S) URL without credentials, a query, or a fragment",
    );
  }
  const normalizedApiBaseUrl = inputApiBaseUrl.toString().replace(/\/+$/, "");
  const localProjects = Object.freeze({ ...(options.config.localProjects ?? {}) });
  const config: Readonly<ProxyConfig> = Object.freeze({
    ...options.config,
    apiBaseUrl: normalizedApiBaseUrl,
    localProjects,
  });
  const localProjectResolver = createLocalProjectResolver({ localProjects, logger });

  const tokenManager = new TokenManager(
    {
      apiBaseUrl: config.apiBaseUrl,
      apiClientId: config.apiClientId,
      apiClientSecret: config.apiClientSecret,
      previewApiClientId: config.previewApiClientId,
      previewApiClientSecret: config.previewApiClientSecret,
    },
    { cache },
  );
  const routingCacheTtlMs = readBoundedIntegerEnv(
    "VERYFRONT_PROXY_ROUTING_CACHE_TTL_MS",
    DEFAULT_PROXY_ROUTING_CACHE_TTL_MS,
    0,
    MAX_PROXY_ROUTING_CACHE_TTL_MS,
  );
  const routingCacheMaxEntries = readBoundedIntegerEnv(
    "VERYFRONT_PROXY_ROUTING_CACHE_MAX_ENTRIES",
    DEFAULT_PROXY_ROUTING_CACHE_MAX_ENTRIES,
    0,
    MAX_PROXY_ROUTING_CACHE_ENTRIES,
  );
  const metadataLookupTimeoutMs = options.metadataLookupTimeoutMs === undefined
    ? readBoundedIntegerEnv(
      "VERYFRONT_PROXY_METADATA_LOOKUP_TIMEOUT_MS",
      DEFAULT_PROXY_METADATA_LOOKUP_TIMEOUT_MS,
      1,
      MAX_PROXY_METADATA_LOOKUP_TIMEOUT_MS,
    )
    : readPositiveIntegerOption(
      "metadataLookupTimeoutMs",
      options.metadataLookupTimeoutMs,
      DEFAULT_PROXY_METADATA_LOOKUP_TIMEOUT_MS,
      MAX_PROXY_METADATA_LOOKUP_TIMEOUT_MS,
    );
  const metadataResponseMaxBytes = options.metadataResponseMaxBytes === undefined
    ? readBoundedIntegerEnv(
      "VERYFRONT_PROXY_METADATA_RESPONSE_MAX_BYTES",
      DEFAULT_PROXY_METADATA_RESPONSE_MAX_BYTES,
      1,
      MAX_PROXY_METADATA_RESPONSE_BYTES,
    )
    : readPositiveIntegerOption(
      "metadataResponseMaxBytes",
      options.metadataResponseMaxBytes,
      DEFAULT_PROXY_METADATA_RESPONSE_MAX_BYTES,
      MAX_PROXY_METADATA_RESPONSE_BYTES,
    );
  const routingLookupCache = new Map<string, ProjectRoutingCacheEntry>();
  const routingLookupInflight = new Map<string, ProjectRoutingInflightEntry>();
  const projectInvalidationGenerations = new Map<string, number>();
  const lookupKeyInvalidationGenerations = new Map<string, number>();
  const activeRoutingLookupGenerations = new Map<number, number>();
  const maxTrackedInvalidationGenerations = Math.max(
    routingCacheMaxEntries,
    DEFAULT_PROXY_ROUTING_CACHE_MAX_ENTRIES,
  );
  let routingLookupGeneration = 0;

  async function resolveProjectLookup(
    lookupKey: string,
    token: string,
    requestSignal: AbortSignal,
    timing?: ProxyServerTiming,
  ): Promise<DomainLookupResult | null> {
    return await profileProxyServerTimingPhase(
      timing ?? { enabled: false, startedAt: 0, phases: new Map() },
      "proxy.project_lookup",
      () =>
        lookupProjectByDomain(
          lookupKey,
          config.apiBaseUrl,
          token,
          metadataLookupTimeoutMs,
          metadataResponseMaxBytes,
          requestSignal,
          logger,
        ),
    );
  }

  function getCachedRoutingLookup(cacheKey: string): ProjectRoutingLookupResult | null {
    if (routingCacheTtlMs <= 0 || routingCacheMaxEntries <= 0) {
      return null;
    }

    const cached = routingLookupCache.get(cacheKey);
    if (!cached) {
      return null;
    }

    if (cached.expiresAt <= Date.now()) {
      routingLookupCache.delete(cacheKey);
      return null;
    }

    routingLookupCache.delete(cacheKey);
    routingLookupCache.set(cacheKey, cached);
    return cached.value;
  }

  function setCachedRoutingLookup(cacheKey: string, value: ProjectRoutingLookupResult): void {
    if (routingCacheTtlMs <= 0 || routingCacheMaxEntries <= 0) {
      return;
    }

    if (!routingLookupCache.has(cacheKey)) {
      while (routingLookupCache.size >= routingCacheMaxEntries) {
        const oldestKey = routingLookupCache.keys().next().value;
        if (!oldestKey) break;
        routingLookupCache.delete(oldestKey);
      }
    }

    routingLookupCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + routingCacheTtlMs,
    });
  }

  function pruneInvalidationGenerations(generations: Map<string, number>): void {
    let oldestActiveGeneration = Number.POSITIVE_INFINITY;
    for (const generation of activeRoutingLookupGenerations.keys()) {
      oldestActiveGeneration = Math.min(oldestActiveGeneration, generation);
    }

    while (generations.size > maxTrackedInvalidationGenerations) {
      const oldestEntry = generations.entries().next().value as [string, number] | undefined;
      if (!oldestEntry || oldestEntry[1] > oldestActiveGeneration) break;
      generations.delete(oldestEntry[0]);
    }
  }

  function rememberInvalidationGeneration(
    generations: Map<string, number>,
    key: string,
    generation: number,
  ): void {
    generations.delete(key);
    generations.set(key, generation);
    pruneInvalidationGenerations(generations);
  }

  function beginRoutingLookup(generation: number): void {
    activeRoutingLookupGenerations.set(
      generation,
      (activeRoutingLookupGenerations.get(generation) ?? 0) + 1,
    );
  }

  function endRoutingLookup(generation: number): void {
    const activeCount = activeRoutingLookupGenerations.get(generation) ?? 0;
    if (activeCount <= 1) activeRoutingLookupGenerations.delete(generation);
    else activeRoutingLookupGenerations.set(generation, activeCount - 1);
    pruneInvalidationGenerations(projectInvalidationGenerations);
    pruneInvalidationGenerations(lookupKeyInvalidationGenerations);
  }

  function wasRoutingLookupInvalidated(
    cacheKey: string,
    result: ProjectRoutingLookupResult | null,
    startedAtGeneration: number,
  ): boolean {
    const keyGeneration = lookupKeyInvalidationGenerations.get(cacheKey) ?? 0;
    if (keyGeneration > startedAtGeneration) return true;
    if (!result) return false;
    return (projectInvalidationGenerations.get(result.id) ?? 0) > startedAtGeneration;
  }

  function invalidateRoutingLookup(input: ProxyRoutingInvalidation): {
    evictedEntries: number;
    generation: number;
  } {
    const generation = ++routingLookupGeneration;
    rememberInvalidationGeneration(projectInvalidationGenerations, input.projectId, generation);

    const normalizedProjectSlug = input.projectSlug
      ? normalizeProjectLookupKey(input.projectSlug)
      : undefined;
    if (normalizedProjectSlug) {
      rememberInvalidationGeneration(
        lookupKeyInvalidationGenerations,
        normalizedProjectSlug,
        generation,
      );
    }

    let evictedEntries = 0;
    for (const [cacheKey, entry] of routingLookupCache) {
      if (entry.value.id !== input.projectId && cacheKey !== normalizedProjectSlug) continue;
      routingLookupCache.delete(cacheKey);
      rememberInvalidationGeneration(lookupKeyInvalidationGenerations, cacheKey, generation);
      evictedEntries++;
    }

    logger?.info("Proxy routing metadata invalidated after deployment activation", {
      projectId: input.projectId,
      projectSlug: input.projectSlug,
      deploymentId: input.deploymentId,
      environmentId: input.environmentId,
      environmentName: input.environmentName,
      releaseId: input.releaseId,
      generation,
      evictedEntries,
    });

    return { evictedEntries, generation };
  }

  async function resolveProjectRoutingLookup(
    lookupKey: string,
    token: string,
    timing?: ProxyServerTiming,
  ): Promise<ProjectRoutingLookupResult | null> {
    const cacheKey = normalizeProjectLookupKey(lookupKey);
    return await profileProxyServerTimingPhase(
      timing ?? { enabled: false, startedAt: 0, phases: new Map() },
      "proxy.routing_lookup",
      async () => {
        const cached = getCachedRoutingLookup(cacheKey);
        if (cached) {
          logger?.debug("Proxy routing metadata cache hit", { lookupKey });
          return cached;
        }

        const existingLookup = routingLookupInflight.get(cacheKey);
        if (existingLookup?.generation === routingLookupGeneration) {
          logger?.debug("Proxy routing metadata lookup joined in-flight request", { lookupKey });
          return await existingLookup.promise;
        }

        const lookupPromise = (async () => {
          for (let attempt = 0; attempt <= MAX_ROUTING_LOOKUP_INVALIDATION_RETRIES; attempt++) {
            const startedAtGeneration = routingLookupGeneration;
            beginRoutingLookup(startedAtGeneration);
            try {
              const result = await lookupProjectRoutingMetadata(
                lookupKey,
                config.apiBaseUrl,
                token,
                metadataLookupTimeoutMs,
                metadataResponseMaxBytes,
                logger,
              );

              if (!wasRoutingLookupInvalidated(cacheKey, result, startedAtGeneration)) {
                if (result) setCachedRoutingLookup(cacheKey, result);
                return result;
              }

              logger?.info("Retrying proxy routing metadata lookup after invalidation race", {
                lookupKey,
                attempt: attempt + 1,
                generation: routingLookupGeneration,
              });

              if (attempt === MAX_ROUTING_LOOKUP_INVALIDATION_RETRIES) {
                logger?.warn(
                  "Proxy routing metadata changed repeatedly during lookup; failing request closed",
                  {
                    lookupKey,
                    attempts: attempt + 1,
                  },
                );
                throw new ProxyRoutingInvalidationRaceError();
              }
            } finally {
              endRoutingLookup(startedAtGeneration);
            }
          }

          return null;
        })();
        const inflightEntry: ProjectRoutingInflightEntry = {
          generation: routingLookupGeneration,
          promise: lookupPromise,
        };
        routingLookupInflight.set(cacheKey, inflightEntry);

        try {
          return await lookupPromise;
        } finally {
          if (routingLookupInflight.get(cacheKey) === inflightEntry) {
            routingLookupInflight.delete(cacheKey);
          }
        }
      },
    );
  }

  async function resolveProjectAccessLookup(
    lookupKey: string,
    token: string,
    includeUsers: boolean,
    requestSignal: AbortSignal,
    timing?: ProxyServerTiming,
  ): Promise<ProjectAccessLookupResult | null> {
    return await profileProxyServerTimingPhase(
      timing ?? { enabled: false, startedAt: 0, phases: new Map() },
      "proxy.access_lookup",
      () =>
        lookupProjectAccessMetadata(
          lookupKey,
          config.apiBaseUrl,
          token,
          includeUsers,
          metadataLookupTimeoutMs,
          metadataResponseMaxBytes,
          requestSignal,
          logger,
        ),
    );
  }

  async function invalidateAndConfirmRoutingLookup(
    input: ConfirmedProxyRoutingInvalidation,
  ): Promise<void> {
    invalidateRoutingLookup(input);

    const scope = getScope(input.environmentName.toLowerCase());
    const resolveWithToken = async (token: string) => {
      const result = await resolveProjectRoutingLookup(input.projectSlug, token);
      const environment = result?.environments?.find((candidate) =>
        candidate.id === input.environmentId
      );
      if (
        result?.id !== input.projectId ||
        environment?.active_release_id !== input.releaseId
      ) {
        throw new Error(
          `Proxy routing metadata did not converge for project ${input.projectId} environment ${input.environmentId}`,
        );
      }
    };

    let token = await tokenManager.getToken(scope, input.projectSlug);
    try {
      await resolveWithToken(token);
    } catch (error) {
      if (!isProxyLookupAuthError(error)) throw error;
      await tokenManager.invalidateToken(scope, input.projectSlug);
      token = await tokenManager.getToken(scope, input.projectSlug);
      await resolveWithToken(token);
    }

    logger?.info("Proxy routing metadata converged after deployment activation", {
      projectId: input.projectId,
      projectSlug: input.projectSlug,
      deploymentId: input.deploymentId,
      environmentId: input.environmentId,
      environmentName: input.environmentName,
      releaseId: input.releaseId,
    });
  }

  function validateConfig(): string[] {
    const missing: string[] = [];
    if (!config.apiClientId) missing.push("VERYFRONT_PROXY_API_CLIENT_ID");
    if (!config.apiClientSecret) missing.push("VERYFRONT_PROXY_API_CLIENT_SECRET");
    return missing;
  }

  async function resolveFullProjectLookupAndProtection(
    req: Request,
    url: URL,
    token: string,
    userToken: string | undefined,
    lookupKey: string,
    envMatcher: (env: ProjectLookupEnvironment) => boolean,
    timing: ProxyServerTiming | undefined,
    logContext: Record<string, unknown>,
    signedInternalControlPlaneRequest: boolean,
  ): Promise<ResolvedProjectMetadata> {
    const lookupResult = await resolveProjectLookup(lookupKey, token, req.signal, timing);
    if (!lookupResult) return { projectId: undefined, releaseId: undefined };

    const matchingEnv = lookupResult.environments?.find(envMatcher);
    if (!matchingEnv) return { projectId: undefined, releaseId: undefined };

    const protectionError = await checkProtectedProxyAccess({
      req,
      url,
      matchingEnv,
      userToken,
      users: lookupResult.users,
      apiBaseUrl: config.apiBaseUrl,
      logger,
      logContext,
      isSignedInternalControlPlaneRequest: signedInternalControlPlaneRequest,
    });
    if (protectionError) return { error: protectionError };

    return {
      projectId: lookupResult.id,
      projectSlug: lookupResult.slug,
      releaseId: matchingEnv?.active_release_id ?? undefined,
      environmentId: matchingEnv?.id,
    };
  }

  async function resolveProjectMetadataAndProtection(
    req: Request,
    url: URL,
    token: string,
    userToken: string | undefined,
    lookupKey: string,
    envMatcher: (env: ProjectLookupEnvironment) => boolean,
    timing: ProxyServerTiming | undefined,
    logContext: Record<string, unknown>,
    signedInternalControlPlaneRequest: boolean,
  ): Promise<ResolvedProjectMetadata> {
    return await profileProxyServerTimingPhase(
      timing ?? { enabled: false, startedAt: 0, phases: new Map() },
      "proxy.project_lookup",
      async () => {
        const routingResult = await resolveProjectRoutingLookup(lookupKey, token, timing);
        if (!routingResult) {
          return await resolveFullProjectLookupAndProtection(
            req,
            url,
            token,
            userToken,
            lookupKey,
            envMatcher,
            undefined,
            logContext,
            signedInternalControlPlaneRequest,
          );
        }

        const accessResult = await resolveProjectAccessLookup(
          lookupKey,
          token,
          !!userToken,
          req.signal,
          timing,
        );
        if (
          !accessResult || accessResult.id !== routingResult.id ||
          accessResult.slug !== routingResult.slug
        ) {
          routingLookupCache.delete(normalizeProjectLookupKey(lookupKey));
          return await resolveFullProjectLookupAndProtection(
            req,
            url,
            token,
            userToken,
            lookupKey,
            envMatcher,
            undefined,
            logContext,
            signedInternalControlPlaneRequest,
          );
        }

        const routingEnv = routingResult.environments?.find(envMatcher);
        const accessEnv = accessResult.environments?.find(envMatcher);
        if (!routingEnv || !accessEnv || routingEnv.id !== accessEnv.id) {
          routingLookupCache.delete(normalizeProjectLookupKey(lookupKey));
          return await resolveFullProjectLookupAndProtection(
            req,
            url,
            token,
            userToken,
            lookupKey,
            envMatcher,
            undefined,
            logContext,
            signedInternalControlPlaneRequest,
          );
        }

        const protectionError = await checkProtectedProxyAccess({
          req,
          url,
          matchingEnv: accessEnv,
          userToken,
          users: accessResult.users,
          apiBaseUrl: config.apiBaseUrl,
          logger,
          logContext,
          isSignedInternalControlPlaneRequest: signedInternalControlPlaneRequest,
        });
        if (protectionError) return { error: protectionError };

        return {
          projectId: routingResult.id,
          projectSlug: routingResult.slug,
          releaseId: routingEnv?.active_release_id ?? undefined,
          environmentId: routingEnv?.id,
        };
      },
    );
  }

  async function processRequest(
    req: Request,
    options: ProxyRequestOptions = {},
  ): Promise<ProxyContext> {
    const url = options.url ?? new URL(req.url);
    const rawHost = getRequestHost(req, url);
    const host = rawHost.replace(/:\d+$/, "");
    const parsedDomain = parseProjectDomain(host);
    const scope = getScope(parsedDomain.environment);
    const base = { scope, host, parsedDomain };

    // Verify the control-plane/dispatch signature once per request. This gates
    // both the protected-environment access bypass and the x-token forwarding
    // below, so it must be a real cryptographic check, not header presence.
    const signedInternalControlPlaneRequest = await isVerifiedInternalControlPlaneRequest(
      req,
      url,
    );

    let projectSlug = parsedDomain.slug ?? undefined;
    let projectId: string | undefined;
    let releaseId: string | undefined;
    let environmentId: string | undefined;

    const isCustomDomain = !projectSlug && !parsedDomain.isVeryfrontDomain;

    if (!projectSlug && parsedDomain.isVeryfrontDomain) {
      return {
        token: undefined,
        projectSlug: undefined,
        projectId: undefined,
        environment: "preview",
        contentSourceId: "no-project",
        localPath: undefined,
        host,
        parsedDomain,
        isLocalProject: false,
      };
    }

    const localPath = projectSlug ? await localProjectResolver.find(projectSlug) : undefined;
    const isLocalProject = !!localPath;

    logger?.debug("Processing request", {
      host,
      projectSlug,
      environment: scope,
      isLocalProject,
      isCustomDomain,
    });

    let userToken: string | undefined;
    let token: string | undefined;
    let tokenSource: "signed-internal" | "user" | "service" | "static" | undefined;
    let metadataToken: string | undefined;
    let tokenFetchError: unknown;

    async function resolveProjectMetadataWithTokenRetry(
      lookupKey: string,
      envMatcher: (env: ProjectLookupEnvironment) => boolean,
      timing: ProxyServerTiming | undefined,
      logContext: Record<string, unknown>,
      tokenIdentity: { projectSlug?: string; customDomain?: string },
    ): Promise<ResolvedProjectMetadata> {
      if (!metadataToken) {
        return { error: { status: 502, message: "Proxy API token unavailable" } };
      }

      const resolveWithCurrentToken = () =>
        resolveProjectMetadataAndProtection(
          req,
          url,
          metadataToken!,
          userToken,
          lookupKey,
          envMatcher,
          timing,
          logContext,
          signedInternalControlPlaneRequest,
        );

      try {
        return await resolveWithCurrentToken();
      } catch (error) {
        if (error instanceof ProxyRoutingInvalidationRaceError) {
          return { error: { status: 503, message: error.message } };
        }
        if (error instanceof ProxyLookupUnavailableError) {
          return { error: { status: 502, message: "Proxy metadata service unavailable" } };
        }
        if (!isProxyLookupAuthError(error)) throw error;

        const projectKey = tokenIdentity.projectSlug ?? tokenIdentity.customDomain;
        logger?.warn("Proxy API token rejected during metadata lookup; refreshing token", {
          lookupKey,
          host,
          scope,
          projectSlug: tokenIdentity.projectSlug,
          customDomain: tokenIdentity.customDomain,
          status: error.status,
          lookupType: error.lookupType,
        });

        routingLookupCache.delete(normalizeProjectLookupKey(lookupKey));
        await tokenManager.invalidateToken(scope, projectKey);

        try {
          metadataToken = await tokenManager.getToken(
            scope,
            tokenIdentity.projectSlug,
            tokenIdentity.customDomain,
          );
          if (tokenSource !== "user" && tokenSource !== "signed-internal") {
            token = metadataToken;
          }
        } catch (refreshError) {
          logger?.error(
            "Failed to refresh proxy API token after metadata auth rejection",
            refreshError as Error,
            {
              lookupKey,
              host,
              scope,
              projectSlug: tokenIdentity.projectSlug,
              customDomain: tokenIdentity.customDomain,
            },
          );
          return { error: { status: 502, message: "Failed to refresh proxy API token" } };
        }

        try {
          return await resolveWithCurrentToken();
        } catch (retryError) {
          if (retryError instanceof ProxyRoutingInvalidationRaceError) {
            return { error: { status: 503, message: retryError.message } };
          }
          if (retryError instanceof ProxyLookupUnavailableError) {
            return { error: { status: 502, message: "Proxy metadata service unavailable" } };
          }
          if (!isProxyLookupAuthError(retryError)) throw retryError;

          logger?.error("Proxy API token rejected after refresh", retryError, {
            lookupKey,
            host,
            scope,
            projectSlug: tokenIdentity.projectSlug,
            customDomain: tokenIdentity.customDomain,
            status: retryError.status,
            lookupType: retryError.lookupType,
          });
          return { error: { status: 502, message: "Proxy API token rejected by API" } };
        }
      }
    }

    if (isLocalProject) {
      logger?.debug("Local project, skipping token fetch", { localPath });
    } else {
      ({ token, tokenSource, userToken, tokenFetchError } = await resolveProxyRequestToken(
        {
          req,
          url,
          scope,
          host,
          projectSlug,
          config,
          tokenManager,
          logger,
          allowSignedInternalControlPlaneToken: true,
          signedInternalControlPlaneRequest,
          tokenFetchErrorMessage: "Token fetch failed",
        },
      ));
      metadataToken = token;

      if (tokenSource === "user" && config.apiClientId && config.apiClientSecret) {
        const customDomain = projectSlug ? undefined : host;
        metadataToken = undefined;
        try {
          metadataToken = await tokenManager.getToken(scope, projectSlug, customDomain);
        } catch (error) {
          tokenFetchError = error;
          if (!isMissingCustomDomainProjectError(error)) {
            logger?.error("Metadata service token fetch failed", error as Error, {
              projectSlug,
              customDomain,
            });
          }
        }
      }

      if (projectSlug && !token) {
        const status = parseStatusFromError(tokenFetchError);
        if (status === 404 || isMissingCustomDomainProjectError(tokenFetchError)) {
          if (scope === "preview") {
            logger?.info("Preview project not found", { projectSlug, host });
            return createProjectNotFoundProxyContext(base, "Preview project not found");
          }

          logger?.info("Project not found", { projectSlug, host, scope });
          return createProjectNotFoundProxyContext(base, "Project not found");
        }

        const message = scope === "preview"
          ? "Failed to authenticate preview request"
          : "Failed to authenticate project request";

        logger?.warn("Project request has no usable token", {
          projectSlug,
          host,
          scope,
          hadUserToken: !!userToken,
          hadTokenFetchError: !!tokenFetchError,
        });
        return createProxyErrorContext(base, { status: 502, message });
      }

      if (projectSlug && tokenSource === "user" && !metadataToken) {
        const status = parseStatusFromError(tokenFetchError);
        if (status === 404 || isMissingCustomDomainProjectError(tokenFetchError)) {
          if (scope === "preview") {
            logger?.info("Preview project not found", { projectSlug, host });
            return createProjectNotFoundProxyContext(base, "Preview project not found", token);
          }

          logger?.info("Project not found", { projectSlug, host, scope });
          return createProjectNotFoundProxyContext(base, "Project not found", token);
        }
      }

      if (isCustomDomain && !projectSlug) {
        if (!token) {
          if (isMissingCustomDomainProjectError(tokenFetchError)) {
            logger?.info("Custom domain project not found during token fetch", {
              domain: host,
            });
            return createProxyErrorContext(base, {
              status: 404,
              message: `No project configured for domain: ${host}`,
            });
          }

          logger?.error("Cannot process custom domain without token", undefined, { domain: host });
          return createProxyErrorContext(base, {
            status: 502,
            message: `Failed to authenticate for domain: ${host}`,
            token,
          });
        }

        const normalizedHost = host.toLowerCase().replace(/:\d+$/, "");
        const resolved = await resolveProjectMetadataWithTokenRetry(
          host,
          (env) => env.domains?.some((d) => d.toLowerCase() === normalizedHost) ?? false,
          options.timing,
          { domain: host },
          { customDomain: host },
        );

        if ("error" in resolved) {
          return createProxyErrorContext(base, {
            status: resolved.error.status,
            message: resolved.error.message,
            token,
            redirectUrl: resolved.error.redirectUrl,
          });
        }

        if (!resolved.projectId || !resolved.projectSlug) {
          logger?.info("Custom domain not found", { domain: host });
          return createProxyErrorContext(base, {
            status: 404,
            message: `No project configured for domain: ${host}`,
            token,
          });
        }

        projectSlug = resolved.projectSlug;
        projectId = resolved.projectId;
        releaseId = resolved.releaseId;
        environmentId = resolved.environmentId;

        logger?.info("Resolved custom domain to project", {
          domain: host,
          projectSlug,
          projectId,
          releaseId,
          environmentId,
        });
      } else if (projectSlug && scope === "production" && token && parsedDomain.environment) {
        const targetEnv = parsedDomain.environment.toLowerCase();

        const resolved = await resolveProjectMetadataWithTokenRetry(
          projectSlug,
          (env) => env.name.toLowerCase() === targetEnv,
          options.timing,
          { projectSlug },
          { projectSlug },
        );

        if ("error" in resolved) {
          return createProxyErrorContext(base, {
            status: resolved.error.status,
            message: resolved.error.message,
            token,
            redirectUrl: resolved.error.redirectUrl,
          });
        }

        if (!resolved.projectId) {
          logger?.info("Project not found after lookup", {
            projectSlug,
            host,
            scope,
            targetEnvName: parsedDomain.environment,
          });
          return createProjectNotFoundProxyContext(base, "Project not found", token);
        }

        projectId = resolved.projectId;
        releaseId = resolved.releaseId;
        environmentId = resolved.environmentId;

        logger?.info("Resolved veryfront domain to project", {
          projectSlug,
          projectId,
          releaseId,
          environmentId,
          targetEnvName: parsedDomain.environment,
        });
      } else if (projectSlug && scope === "preview" && token) {
        // Preview uses branch-based content (no releaseId needed), but must
        // still enforce the environment's `protected` flag like other scopes.
        const resolved = await resolveProjectMetadataWithTokenRetry(
          projectSlug,
          (env) => env.name.toLowerCase() === "preview",
          options.timing,
          { projectSlug },
          { projectSlug },
        );

        if ("error" in resolved) {
          return createProxyErrorContext(base, {
            status: resolved.error.status,
            message: resolved.error.message,
            token,
            redirectUrl: resolved.error.redirectUrl,
          });
        }

        if (!resolved.projectId) {
          logger?.info("Preview project not found after lookup", { projectSlug, host });
          return createProjectNotFoundProxyContext(base, "Preview project not found", token);
        }

        projectId = resolved.projectId;
        environmentId = resolved.environmentId;

        if (projectId) {
          logger?.info("Resolved preview project", {
            projectSlug,
            projectId,
            environmentId,
          });
        }
      }
    }

    if (scope === "production" && projectSlug && !releaseId && !isLocalProject) {
      logger?.warn("No active release found", {
        projectSlug,
        projectId,
        host,
        environment: scope,
      });
      return createReleaseNotFoundProxyContext({ scope, host, parsedDomain }, token);
    }

    const contentSourceId = computeContentSourceId(
      isLocalProject,
      scope,
      parsedDomain.branch,
      releaseId,
    );

    return {
      token,
      projectSlug,
      projectId,
      releaseId,
      environmentId,
      contentSourceId,
      environment: scope,
      localPath,
      host,
      parsedDomain,
      isLocalProject,
    };
  }

  async function getTokenForApi(
    req: Request,
    options: ProxyRequestOptions = {},
  ): Promise<string | undefined> {
    const url = options.url ?? new URL(req.url);
    const rawHost = getRequestHost(req, url);
    const host = rawHost.replace(/:\d+$/, "");
    const parsedDomain = parseProjectDomain(host);
    const scope = getScope(parsedDomain.environment);
    const projectSlug = parsedDomain.slug ?? undefined;
    const { token } = await resolveProxyRequestToken({
      req,
      url,
      scope,
      host,
      projectSlug,
      config,
      tokenManager,
      logger,
      signedInternalControlPlaneRequest: await isVerifiedInternalControlPlaneRequest(req, url),
      tokenFetchErrorMessage: "Token fetch failed for API",
    });
    return token;
  }

  async function getStats() {
    return tokenManager.getStats();
  }

  async function close() {
    await tokenManager.close();
  }

  return {
    processRequest,
    getTokenForApi,
    getStats,
    close,
    validateConfig,
    invalidateRoutingLookup,
    invalidateAndConfirmRoutingLookup,
    localProjects,
  };
}

/** Replace client-controlled routing headers with values from a resolved proxy context. */
export function injectContextHeaders(req: Request, ctx: ProxyContext): Request {
  const headers = new Headers(req.headers);
  for (const header of INTERNAL_PROXY_HEADERS) headers.delete(header);

  // The `x-veryfront-*-jws` signature headers are deliberately NOT stripped:
  // the downstream renderer re-verifies them against the raw request body and
  // project audience (`verifyDispatchJws` / `verifyControlPlaneJws`). Since the
  // proxy now trusts these headers only after cryptographic verification (see
  // isVerifiedInternalControlPlaneRequest), forwarding an unverified/forged one
  // is harmless because the renderer rejects it.

  if (ctx.token) headers.set("x-token", ctx.token);
  headers.set("x-project-slug", ctx.projectSlug ?? "");
  headers.set("x-environment", ctx.environment);
  headers.set("x-content-source-id", ctx.contentSourceId);
  headers.set("x-forwarded-host", ctx.host);
  headers.set("x-forwarded-proto", new URL(req.url).protocol.replace(/:$/, ""));
  if (ctx.localPath) headers.set("x-project-path", ctx.localPath);

  if (ctx.projectId) headers.set("x-project-id", ctx.projectId);
  if (ctx.releaseId) headers.set("x-release-id", ctx.releaseId);
  if (ctx.environmentId) headers.set("x-environment-id", ctx.environmentId);

  if (ctx.branchId) headers.set("x-branch-id", ctx.branchId);
  if (ctx.branchName) headers.set("x-branch-name", ctx.branchName);

  return new Request(req, {
    headers,
    redirect: "manual",
  });
}
