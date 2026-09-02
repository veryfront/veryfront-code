import { TokenManager, type TokenScope } from "./token-manager.ts";
import { isErrorAcrossRealms } from "#veryfront/platform/compat/error-introspection.ts";
import {
  isHostedVeryfrontDomain,
  type ParsedDomain,
  parseProjectDomain,
} from "#veryfront/server/utils/domain-parser.ts";
import type { TokenCache } from "./cache/types.ts";
import { computeContentSourceId } from "#veryfront/cache/keys.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { checkProtectedProxyAccess } from "./proxy-access-control.ts";
import { createLocalProjectResolver } from "./local-project-resolver.ts";
import {
  isMissingProxyProjectError,
  resolveProxyRequestToken,
  stripUserTokenCookie,
} from "./proxy-token-resolution.ts";
import {
  createProjectNotFoundProxyContext,
  createProxyErrorContext,
  createReleaseNotFoundProxyContext,
} from "./proxy-error-context.ts";
import { profileProxyServerTimingPhase, type ProxyServerTiming } from "./server-timing.ts";
import {
  classifyInternalControlPlaneRequest,
  ControlPlaneBranchBindingError,
  isAuthenticInternalControlPlaneCandidate,
  isVerifiedInternalControlPlaneRequest,
  resolveVerifiedControlPlaneBranchBinding,
} from "./control-plane-signature.ts";
import { encodeIdentityHeaderValue } from "#veryfront/utils/header-identity.ts";
import {
  createProjectMetadataClient,
  type DomainLookupResult,
  normalizeProjectLookupKey,
  type ProjectAccessLookupResult,
  type ProjectLookupEnvironment,
  type ProjectRoutingLookupResult,
  ProxyLookupAuthError,
  ProxyLookupFailure,
} from "./project-metadata-client.ts";
import { resolveProxyRequestAuthority, resolveProxyRequestHost } from "./request-host.ts";
import { createProxyEndToEndHeaders } from "./hop-by-hop-headers.ts";
import { withProxyStreamingBodyDuplex } from "./request-init.ts";

export const INTERNAL_PROXY_HEADERS = [
  "x-token",
  "x-project-slug",
  "x-environment",
  "x-environment-id",
  "x-environment-name",
  "x-content-source-id",
  "x-forwarded-host",
  "x-project-path",
  "x-project-id",
  "x-release-id",
  "x-branch-id",
  "x-branch-name",
  "x-default-branch-name",
] as const;

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
const MAX_PROXY_ROUTING_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_PROXY_ROUTING_CACHE_ENTRIES = 10_000;
const MAX_ROUTING_LOOKUP_INVALIDATION_RETRIES = 2;

function readBoundedNonNegativeIntegerEnv(
  name: string,
  fallback: number,
  maximum: number,
): number {
  const raw = getEnv(name);
  if (!raw) return fallback;
  if (!/^(?:0|[1-9]\d*)$/u.test(raw)) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > maximum) {
    throw new RangeError(`${name} cannot exceed ${maximum}`);
  }
  return value;
}

class ProxyRoutingInvalidationRaceError extends Error {
  constructor() {
    super("Project routing changed during request; retry");
    this.name = "ProxyRoutingInvalidationRaceError";
  }
}

function isProxyLookupAuthError(error: unknown): error is ProxyLookupAuthError {
  return error instanceof ProxyLookupAuthError;
}

export interface ProxyConfig {
  apiBaseUrl: string;
  apiClientId: string;
  apiClientSecret: string;
  previewApiClientId: string;
  previewApiClientSecret: string;
  apiToken?: string;
  localProjects?: Record<string, string>;
}

export interface ProxyContext {
  token?: string;
  projectSlug?: string;
  projectId?: string;
  releaseId?: string;
  branchId?: string;
  branchName?: string;
  defaultBranchName?: string;
  environmentId?: string;
  environmentName?: string;
  environment: "preview" | "production";
  contentSourceId: string;
  localPath?: string;
  host: string;
  requestAuthority?: string;
  parsedDomain: ParsedDomain;
  isLocalProject: boolean;
  error?: {
    status: number;
    message: string;
    slug?: string;
    redirectUrl?: string;
  };
}

type ResolvedProjectMetadata =
  | {
    projectId?: string;
    projectSlug?: string;
    releaseId?: string;
    environmentId?: string;
    environmentName?: string;
    signedInternalControlPlaneRequest?: boolean;
  }
  | {
    error: {
      status: number;
      message: string;
      redirectUrl?: string;
      discardToken?: boolean;
    };
  };

type VerifySignedInternalControlPlaneBinding = (
  projectSlug: string,
  projectId: string,
) => Promise<boolean>;

export interface ProxyLogger {
  debug: (msg: string, extra?: Record<string, unknown>) => void;
  info: (msg: string, extra?: Record<string, unknown>) => void;
  warn: (msg: string, extra?: Record<string, unknown>) => void;
  error: (msg: string, error?: unknown, extra?: Record<string, unknown>) => void;
}

export interface ProxyHandlerOptions {
  config: ProxyConfig;
  cache?: TokenCache;
  logger?: ProxyLogger;
  metadataFetch?: typeof fetch;
  metadataTimeoutMs?: number;
  metadataMaxInflight?: number;
}

export interface ProxyRequestOptions {
  url?: URL;
  timing?: ProxyServerTiming;
}

export interface ProxyRoutingInvalidation {
  projectId: string;
  projectSlug?: string;
  deploymentId?: string;
  environmentId?: string;
  environmentName?: string;
  releaseId?: string;
}

export interface ConfirmedProxyRoutingInvalidation extends ProxyRoutingInvalidation {
  projectSlug: string;
  environmentId: string;
  environmentName: string;
  releaseId: string;
}

function getScope(environment: string | null): TokenScope {
  return environment === "preview" ? "preview" : "production";
}

function requestAbortReason(signal: AbortSignal): Error {
  return isErrorAcrossRealms(signal.reason)
    ? signal.reason
    : new DOMException("Proxy request was aborted", "AbortError");
}

async function awaitForRequest<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return await promise;
  if (signal.aborted) throw requestAbortReason(signal);
  return await new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(requestAbortReason(signal));
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export function createProxyHandler(options: ProxyHandlerOptions) {
  const { config, cache, logger } = options;
  const routingCacheTtlMs = readBoundedNonNegativeIntegerEnv(
    "VERYFRONT_PROXY_ROUTING_CACHE_TTL_MS",
    DEFAULT_PROXY_ROUTING_CACHE_TTL_MS,
    MAX_PROXY_ROUTING_CACHE_TTL_MS,
  );
  const routingCacheMaxEntries = readBoundedNonNegativeIntegerEnv(
    "VERYFRONT_PROXY_ROUTING_CACHE_MAX_ENTRIES",
    DEFAULT_PROXY_ROUTING_CACHE_MAX_ENTRIES,
    MAX_PROXY_ROUTING_CACHE_ENTRIES,
  );
  const localProjectResolver = createLocalProjectResolver({
    localProjects: config.localProjects,
    logger,
    allowDiscovery: getEnv("NODE_ENV") !== "production",
  });
  const localProjects = localProjectResolver.localProjects;
  const metadataClient = createProjectMetadataClient({
    apiBaseUrl: config.apiBaseUrl,
    fetchImpl: options.metadataFetch,
    logger,
    maxInflight: options.metadataMaxInflight,
    timeoutMs: options.metadataTimeoutMs,
  });

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
    timing?: ProxyServerTiming,
    signal?: AbortSignal,
  ): Promise<DomainLookupResult | null> {
    return await profileProxyServerTimingPhase(
      timing ?? { enabled: false, startedAt: 0, phases: new Map() },
      "proxy.project_lookup",
      () => metadataClient.lookupDomain(lookupKey, token, { signal }),
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

  function hasActiveReleaseForMatchedEnvironment(
    result: ProjectRoutingLookupResult,
    envMatcher: (env: ProjectLookupEnvironment) => boolean,
  ): boolean {
    return result.environments?.some((env) => envMatcher(env) && !!env.active_release_id) ?? false;
  }

  function pruneInvalidationGenerations(generations: Map<string, number>): void {
    const oldestActiveGeneration = activeRoutingLookupGenerations.size > 0
      ? Math.min(...activeRoutingLookupGenerations.keys())
      : Number.POSITIVE_INFINITY;

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
    signal?: AbortSignal,
    isResultUsable?: (result: ProjectRoutingLookupResult) => boolean,
  ): Promise<ProjectRoutingLookupResult | null> {
    const cacheKey = normalizeProjectLookupKey(lookupKey);
    const canUseResult = (result: ProjectRoutingLookupResult | null): boolean =>
      !result || !isResultUsable || isResultUsable(result);
    const discardIncompleteResult = (): void => {
      routingLookupCache.delete(cacheKey);
      logger?.info("Refreshing incomplete proxy routing metadata", { lookupKey });
    };
    let hasRejectedIncompleteResult = false;

    return await profileProxyServerTimingPhase(
      timing ?? { enabled: false, startedAt: 0, phases: new Map() },
      "proxy.routing_lookup",
      async () => {
        const cached = getCachedRoutingLookup(cacheKey);
        if (cached && canUseResult(cached)) {
          logger?.debug("Proxy routing metadata cache hit", { lookupKey });
          return cached;
        }
        if (cached) {
          discardIncompleteResult();
          hasRejectedIncompleteResult = true;
        }

        while (true) {
          const existingLookup = routingLookupInflight.get(cacheKey);
          if (!existingLookup || existingLookup.generation !== routingLookupGeneration) break;

          logger?.debug("Proxy routing metadata lookup joined in-flight request", { lookupKey });
          const result = await awaitForRequest(existingLookup.promise, signal);
          if (hasRejectedIncompleteResult || canUseResult(result)) return result;

          discardIncompleteResult();
          hasRejectedIncompleteResult = true;
          if (routingLookupInflight.get(cacheKey) === existingLookup) {
            routingLookupInflight.delete(cacheKey);
          }
        }

        const lookupPromise = (async () => {
          for (let attempt = 0; attempt <= MAX_ROUTING_LOOKUP_INVALIDATION_RETRIES; attempt++) {
            const startedAtGeneration = routingLookupGeneration;
            beginRoutingLookup(startedAtGeneration);
            try {
              const result = await metadataClient.lookupRouting(lookupKey, token);

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
        lookupPromise.then(
          () => {
            if (routingLookupInflight.get(cacheKey) === inflightEntry) {
              routingLookupInflight.delete(cacheKey);
            }
          },
          () => {
            if (routingLookupInflight.get(cacheKey) === inflightEntry) {
              routingLookupInflight.delete(cacheKey);
            }
          },
        );

        return await awaitForRequest(lookupPromise, signal);
      },
    );
  }

  async function resolveProjectAccessLookup(
    lookupKey: string,
    token: string,
    includeUsers: boolean,
    timing?: ProxyServerTiming,
    signal?: AbortSignal,
  ): Promise<ProjectAccessLookupResult | null> {
    return await profileProxyServerTimingPhase(
      timing ?? { enabled: false, startedAt: 0, phases: new Map() },
      "proxy.access_lookup",
      () => metadataClient.lookupAccess(lookupKey, token, includeUsers, { signal }),
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
    signedInternalControlPlaneCandidate: boolean,
    verifySignedInternalControlPlaneBinding: VerifySignedInternalControlPlaneBinding,
  ): Promise<ResolvedProjectMetadata> {
    const lookupResult = await resolveProjectLookup(lookupKey, token, timing, req.signal);
    if (!lookupResult) return { projectId: undefined, releaseId: undefined };

    const matchingEnv = lookupResult.environments.find(envMatcher);
    if (!matchingEnv) return { projectId: undefined, releaseId: undefined };

    const signedInternalControlPlaneRequest = signedInternalControlPlaneCandidate &&
      await verifySignedInternalControlPlaneBinding(lookupResult.slug, lookupResult.id);
    if (signedInternalControlPlaneCandidate && !signedInternalControlPlaneRequest) {
      return {
        error: {
          status: 401,
          message: "Control-plane project binding failed",
          discardToken: true,
        },
      };
    }

    const protectionError = await checkProtectedProxyAccess({
      url,
      matchingEnv,
      projectId: lookupResult.id,
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
      environmentName: matchingEnv?.name,
      signedInternalControlPlaneRequest,
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
    signedInternalControlPlaneCandidate: boolean,
    verifySignedInternalControlPlaneBinding: VerifySignedInternalControlPlaneBinding,
    requireActiveRelease: boolean,
  ): Promise<ResolvedProjectMetadata> {
    return await profileProxyServerTimingPhase(
      timing ?? { enabled: false, startedAt: 0, phases: new Map() },
      "proxy.project_lookup",
      async () => {
        const routingResult = await resolveProjectRoutingLookup(
          lookupKey,
          token,
          timing,
          req.signal,
          requireActiveRelease
            ? (result) => hasActiveReleaseForMatchedEnvironment(result, envMatcher)
            : undefined,
        );
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
            signedInternalControlPlaneCandidate,
            verifySignedInternalControlPlaneBinding,
          );
        }

        const accessResult = await resolveProjectAccessLookup(
          lookupKey,
          token,
          !!userToken,
          timing,
          req.signal,
        );
        if (
          !accessResult ||
          accessResult.id !== routingResult.id ||
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
            signedInternalControlPlaneCandidate,
            verifySignedInternalControlPlaneBinding,
          );
        }

        const routingEnv = routingResult.environments.find(envMatcher);
        const accessEnv = accessResult.environments.find(envMatcher);
        if (
          !routingEnv ||
          !accessEnv ||
          routingEnv.id !== accessEnv.id ||
          routingEnv.name !== accessEnv.name
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
            signedInternalControlPlaneCandidate,
            verifySignedInternalControlPlaneBinding,
          );
        }

        const signedInternalControlPlaneRequest = signedInternalControlPlaneCandidate &&
          await verifySignedInternalControlPlaneBinding(routingResult.slug, routingResult.id);
        if (signedInternalControlPlaneCandidate && !signedInternalControlPlaneRequest) {
          return {
            error: {
              status: 401,
              message: "Control-plane project binding failed",
              discardToken: true,
            },
          };
        }

        const protectionError = await checkProtectedProxyAccess({
          url,
          matchingEnv: accessEnv,
          projectId: routingResult.id,
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
          environmentName: routingEnv?.name,
          signedInternalControlPlaneRequest,
        };
      },
    );
  }

  async function processRequest(
    req: Request,
    options: ProxyRequestOptions = {},
  ): Promise<ProxyContext> {
    const url = options.url ?? new URL(req.url);
    const host = resolveProxyRequestHost(req, url);
    const requestAuthority = resolveProxyRequestAuthority(req, url);
    const parsedDomain = parseProjectDomain(host);
    const scope = getScope(parsedDomain.environment);
    const base = { scope, host, requestAuthority, parsedDomain };

    const internalRouteKind = classifyInternalControlPlaneRequest(req.method, url.pathname);
    if (internalRouteKind === "reserved") {
      return createProxyErrorContext(base, { status: 404, message: "Not found" });
    }

    let projectSlug = parsedDomain.slug ?? undefined;
    let projectId: string | undefined;
    let releaseId: string | undefined;
    let environmentId: string | undefined;
    let environmentName: string | undefined;
    let branchId: string | undefined;
    let branchName: string | undefined;
    let defaultBranchName: string | undefined;
    const isCustomDomain = !projectSlug && !parsedDomain.isVeryfrontDomain;

    // The first pass authenticates the candidate so its x-token can perform the
    // project metadata lookup. Known slugs are audience-bound immediately;
    // custom domains are audience- and id-bound after lookup. No authorization
    // bypass or renderer forwarding is granted before that second binding.
    let signedInternalControlPlaneCandidate = false;
    if (projectSlug !== undefined) {
      signedInternalControlPlaneCandidate = await isVerifiedInternalControlPlaneRequest(
        req,
        url,
        { audience: projectSlug },
        logger,
      );
    } else if (isCustomDomain) {
      signedInternalControlPlaneCandidate = await isAuthenticInternalControlPlaneCandidate(
        req,
        url,
        logger,
      );
    }
    let signedInternalControlPlaneRequest = false;

    const verifySignedInternalControlPlaneBinding: VerifySignedInternalControlPlaneBinding = async (
      resolvedProjectSlug,
      resolvedProjectId,
    ) =>
      await isVerifiedInternalControlPlaneRequest(req, url, {
        audience: resolvedProjectSlug,
        expectedProjectId: resolvedProjectId,
      }, logger);

    if (!projectSlug && parsedDomain.isVeryfrontDomain) {
      // A hosted environment root (staging.veryfront.com) names no project and
      // nothing downstream can supply one, so forwarding only sends
      // x-project-slug: "" and earns 502 "Missing project context" — a
      // configuration gap reported as an upstream failure. A custom domain in
      // that state already answers 404.
      //
      // Locally the same shape means something else: on localhost a
      // project-less host is how the project chooser is reached, so those keep
      // forwarding. See ProjectsHandler, enabled for exactly this state.
      if (isHostedVeryfrontDomain(host)) {
        logger?.info("No project for hosted veryfront domain", { host });
        return createProxyErrorContext(base, {
          status: 404,
          message: `No project configured for domain: ${host}`,
        });
      }

      return {
        token: undefined,
        projectSlug: undefined,
        projectId: undefined,
        environment: "preview",
        contentSourceId: "no-project",
        localPath: undefined,
        host,
        requestAuthority,
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
          signedInternalControlPlaneCandidate,
          verifySignedInternalControlPlaneBinding,
          scope === "production",
        );

      try {
        return await resolveWithCurrentToken();
      } catch (error) {
        if (error instanceof ProxyRoutingInvalidationRaceError) {
          return { error: { status: 503, message: error.message } };
        }
        if (error instanceof ProxyLookupFailure) {
          logger?.error("Proxy metadata lookup failed closed", error, {
            lookupKey,
            host,
            scope,
            lookupType: error.lookupType,
            status: error.publicStatus,
            upstreamStatus: error.upstreamStatus,
          });
          return {
            error: {
              status: error.publicStatus,
              message: error.message,
            },
          };
        }
        if (!isProxyLookupAuthError(error)) throw error;

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
        await tokenManager.invalidateToken(
          scope,
          tokenIdentity.projectSlug,
          tokenIdentity.customDomain,
        );

        try {
          metadataToken = await tokenManager.getToken(
            scope,
            tokenIdentity.projectSlug,
            tokenIdentity.customDomain,
            { signal: req.signal },
          );
          if (tokenSource !== "user" && tokenSource !== "signed-internal") {
            token = metadataToken;
          }
        } catch (refreshError) {
          if (req.signal.aborted) throw requestAbortReason(req.signal);
          logger?.error(
            "Failed to refresh proxy API token after metadata auth rejection",
            refreshError,
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
          if (retryError instanceof ProxyLookupFailure) {
            logger?.error("Proxy metadata lookup failed closed after token refresh", retryError, {
              lookupKey,
              host,
              scope,
              lookupType: retryError.lookupType,
              status: retryError.publicStatus,
              upstreamStatus: retryError.upstreamStatus,
            });
            return {
              error: {
                status: retryError.publicStatus,
                message: retryError.message,
              },
            };
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
          signedInternalControlPlaneRequest: signedInternalControlPlaneCandidate,
          tokenFetchErrorMessage: "Token fetch failed",
        },
      ));
      metadataToken = token;

      if (tokenSource === "user" && config.apiClientId && config.apiClientSecret) {
        const customDomain = projectSlug ? undefined : host;
        metadataToken = undefined;
        try {
          metadataToken = await tokenManager.getToken(
            scope,
            projectSlug,
            customDomain,
            { signal: req.signal },
          );
        } catch (error) {
          if (req.signal.aborted) throw requestAbortReason(req.signal);
          tokenFetchError = error;
          if (!isMissingProxyProjectError(error)) {
            logger?.error("Metadata service token fetch failed", error, {
              projectSlug,
              customDomain,
            });
          }
        }
      }

      if (projectSlug && !token) {
        if (isMissingProxyProjectError(tokenFetchError)) {
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
        if (isMissingProxyProjectError(tokenFetchError)) {
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
          if (isMissingProxyProjectError(tokenFetchError)) {
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

        const normalizedHost = host;
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
            token: resolved.error.discardToken ? undefined : token,
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
        environmentName = resolved.environmentName;
        signedInternalControlPlaneRequest = resolved.signedInternalControlPlaneRequest ?? false;

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
            token: resolved.error.discardToken ? undefined : token,
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
        environmentName = resolved.environmentName;
        signedInternalControlPlaneRequest = resolved.signedInternalControlPlaneRequest ?? false;

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
            token: resolved.error.discardToken ? undefined : token,
            redirectUrl: resolved.error.redirectUrl,
          });
        }

        if (!resolved.projectId) {
          logger?.info("Preview project not found after lookup", { projectSlug, host });
          return createProjectNotFoundProxyContext(base, "Preview project not found", token);
        }

        projectId = resolved.projectId;
        environmentId = resolved.environmentId;
        environmentName = resolved.environmentName;
        signedInternalControlPlaneRequest = resolved.signedInternalControlPlaneRequest ?? false;

        if (projectId) {
          logger?.info("Resolved preview project", {
            projectSlug,
            projectId,
            environmentId,
          });
        }
      }
    }

    if (signedInternalControlPlaneCandidate && !signedInternalControlPlaneRequest) {
      return createProxyErrorContext(base, {
        status: 401,
        message: "Control-plane project binding failed",
      });
    }

    if (signedInternalControlPlaneRequest && projectSlug && projectId) {
      try {
        const branchBinding = await resolveVerifiedControlPlaneBranchBinding(req, url, {
          audience: projectSlug,
          expectedProjectId: projectId,
        });
        branchId = branchBinding?.branchId;
        branchName = branchBinding?.branchName;
        defaultBranchName = branchBinding?.defaultBranchName;
      } catch (error) {
        if (error instanceof ControlPlaneBranchBindingError) {
          // The rejection body reaches only the calling control plane, so log
          // a sanitized server-side warning before returning it.
          logger?.warn("Control-plane branch binding rejected", {
            status: error.status,
            message: error.message,
            projectSlug,
            projectId,
            host,
            pathname: "/api/control-plane/runs/<RUN_ID>/stream",
          });
          return createProxyErrorContext(base, {
            status: error.status,
            message: error.message,
          });
        }
        throw error;
      }
    }

    if (scope === "production" && projectSlug && !releaseId && !isLocalProject) {
      logger?.warn("No active release found", {
        projectSlug,
        projectId,
        host,
        environment: scope,
      });
      return createReleaseNotFoundProxyContext(base, token);
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
      branchId,
      branchName,
      defaultBranchName,
      environmentId,
      environmentName,
      contentSourceId,
      environment: scope,
      localPath,
      host,
      requestAuthority,
      parsedDomain,
      isLocalProject,
    };
  }

  async function getTokenForApi(
    req: Request,
    options: ProxyRequestOptions = {},
  ): Promise<string | undefined> {
    const url = options.url ?? new URL(req.url);
    const host = resolveProxyRequestHost(req, url);
    const parsedDomain = parseProjectDomain(host);
    const scope = getScope(parsedDomain.environment);
    const projectSlug = parsedDomain.slug ?? undefined;
    const signedInternalControlPlaneRequest = projectSlug !== undefined &&
      await isVerifiedInternalControlPlaneRequest(req, url, { audience: projectSlug }, logger);
    const { token } = await resolveProxyRequestToken({
      req,
      url,
      scope,
      host,
      projectSlug,
      config,
      tokenManager,
      logger,
      signedInternalControlPlaneRequest,
      tokenFetchErrorMessage: "Token fetch failed for API",
    });
    return token;
  }

  async function getStats() {
    return tokenManager.getStats();
  }

  async function close() {
    localProjectResolver.clear();
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

export type ProxyHandler = ReturnType<typeof createProxyHandler>;

export function createProxyContextHeaders(
  sourceHeaders: Headers,
  ctx: ProxyContext,
): Headers {
  if (Boolean(ctx.environmentId) !== Boolean(ctx.environmentName)) {
    throw new TypeError(
      "Proxy environment identity requires both environmentId and environmentName",
    );
  }
  if (Boolean(ctx.branchId) !== Boolean(ctx.branchName)) {
    throw new TypeError("Proxy preview branch identity requires both branchId and branchName");
  }
  if (ctx.branchId && ctx.defaultBranchName) {
    throw new TypeError("Proxy branch identity cannot be both preview and default");
  }
  const headers = createProxyEndToEndHeaders(sourceHeaders);
  for (const header of INTERNAL_PROXY_HEADERS) headers.delete(header);

  // The `authToken` cookie carries the caller's Veryfront credential (a user
  // session JWT, or an exchanged environment access token). The proxy has
  // already consumed it (resolveProxyRequestToken) and forwards the resolved
  // identity via `x-token`; the raw credential must never reach
  // tenant-controlled project code. Application cookies pass through intact.
  const cookieHeader = headers.get("cookie");
  if (cookieHeader !== null) {
    const remainingCookies = stripUserTokenCookie(cookieHeader);
    if (remainingCookies === undefined) headers.delete("cookie");
    else headers.set("cookie", remainingCookies);
  }

  // The `x-veryfront-*-jws` signature headers are deliberately NOT stripped:
  // the downstream renderer re-verifies them against the raw request body and
  // project audience (`verifyDispatchJws` / `verifyControlPlaneJws`). Since the
  // proxy now trusts these headers only after cryptographic verification (see
  // isVerifiedInternalControlPlaneRequest), forwarding an unverified/forged one
  // is harmless — the renderer rejects it.

  if (ctx.token) headers.set("x-token", ctx.token);
  headers.set("x-project-slug", ctx.projectSlug ?? "");
  headers.set("x-environment", ctx.environment);
  headers.set("x-content-source-id", ctx.contentSourceId);
  headers.set("x-forwarded-host", ctx.requestAuthority ?? ctx.host);
  if (ctx.localPath) headers.set("x-project-path", ctx.localPath);

  if (ctx.projectId) headers.set("x-project-id", ctx.projectId);
  if (ctx.releaseId) headers.set("x-release-id", ctx.releaseId);
  if (ctx.environmentId) headers.set("x-environment-id", ctx.environmentId);
  if (ctx.environmentName) headers.set("x-environment-name", ctx.environmentName);

  if (ctx.branchId) headers.set("x-branch-id", ctx.branchId);
  if (ctx.branchName) headers.set("x-branch-name", encodeIdentityHeaderValue(ctx.branchName));
  if (ctx.defaultBranchName) {
    headers.set("x-default-branch-name", encodeIdentityHeaderValue(ctx.defaultBranchName));
  }

  headers.delete("host");
  return headers;
}

export function injectContextHeaders(req: Request, ctx: ProxyContext): Request {
  return new Request(
    req.url,
    withProxyStreamingBodyDuplex({
      method: req.method,
      headers: createProxyContextHeaders(req.headers, ctx),
      body: req.body,
      redirect: "manual",
      signal: req.signal,
    }),
  );
}
