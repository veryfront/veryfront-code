import type { HandlerContext, HandlerResult } from "../../types.ts";
import { computeEtag, hasMatchingEtag } from "../../utils/etag.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { getRendererForProject, type RendererAdapter } from "../../../shared/renderer-factory.ts";
import { TimeoutError, withTimeoutThrow } from "#veryfront/rendering/utils/stream-utils.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { markRequestProfilePhase } from "#veryfront/observability";
import { HTTP_GATEWAY_TIMEOUT } from "#veryfront/utils/constants/http.ts";
import { serverLogger } from "#veryfront/utils";
import { Singleflight, waitForSharedPromise } from "#veryfront/utils/singleflight.ts";
import { requestHasCacheSensitiveState } from "#veryfront/cache/request-cacheability.ts";
import {
  type QueryParamCacheOptions,
  sanitizeQueryParamsForCacheKey,
} from "#veryfront/cache/keys.ts";
import type { PageDataResponse } from "#veryfront/rendering/orchestrator/types.ts";
import { resolveSSRControlOutcome } from "#veryfront/rendering/ssr-outcome.ts";
import { isRedirectDestinationAllowed } from "#veryfront/utils/redirect-policy.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import {
  type DependencyPinningSnapshot,
  type DependencyPinningSourceInput,
} from "#veryfront/transforms/esm/package-registry.ts";
import { createHandlerDependencyPinningSource } from "#veryfront/server/handlers/utils/dependency-pinning-source.ts";
import {
  readSnapshotHeader,
  resolveSnapshotForRequest,
  snapshotConflictResponse,
  stripSnapshotHeader,
  withSnapshotResponseHeaders,
} from "#veryfront/server/handlers/utils/dependency-snapshot-protocol.ts";

const PAGE_DATA_TIMEOUT_MS = 25_000;
const PAGE_DATA_CACHE_TTL_MS = readPositiveIntegerEnv("VERYFRONT_PAGE_DATA_CACHE_TTL_MS", 60_000);
const PAGE_DATA_CACHE_STALE_MS = readPositiveIntegerEnv(
  "VERYFRONT_PAGE_DATA_CACHE_STALE_MS",
  30 * 60_000,
);
const PAGE_DATA_CACHE_MAX_ENTRIES = readPositiveIntegerEnv(
  "VERYFRONT_PAGE_DATA_CACHE_MAX_ENTRIES",
  500,
);
const PAGE_DATA_CACHE_MAX_AGE_SECONDS = Math.max(0, Math.floor(PAGE_DATA_CACHE_TTL_MS / 1000));
const PAGE_DATA_CACHE_STALE_SECONDS = Math.max(0, Math.floor(PAGE_DATA_CACHE_STALE_MS / 1000));

interface PageDataCachePolicy {
  ttlMs: number;
  staleMs: number;
  maxAgeSeconds: number;
  staleSeconds: number;
}

interface PageDataCacheEntry {
  body: string;
  etag: string;
  expiresAt: number;
  staleUntil: number;
}

const pageDataCache = new Map<string, PageDataCacheEntry>();
const pageDataFlight = new Singleflight<PageDataCacheEntry>();

const RELEASE_PAGE_DATA_CACHE_POLICY: PageDataCachePolicy = {
  ttlMs: PAGE_DATA_CACHE_TTL_MS,
  staleMs: PAGE_DATA_CACHE_STALE_MS,
  maxAgeSeconds: PAGE_DATA_CACHE_MAX_AGE_SECONDS,
  staleSeconds: PAGE_DATA_CACHE_STALE_SECONDS,
};

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = getEnv(name);
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

function getPageDataCachePolicy(ctx: HandlerContext): PageDataCachePolicy {
  const environment = ctx.resolvedEnvironment ?? ctx.requestContext?.mode ?? "preview";
  const isReleaseBackedProduction = environment === "production" && !!ctx.releaseId;
  if (isReleaseBackedProduction) return RELEASE_PAGE_DATA_CACHE_POLICY;

  return {
    ...RELEASE_PAGE_DATA_CACHE_POLICY,
    staleMs: 0,
    staleSeconds: 0,
  };
}

function isPageDataCacheEnabled(): boolean {
  return PAGE_DATA_CACHE_MAX_ENTRIES > 0;
}

async function resolvePageDataWithinDeadline(
  renderer: RendererAdapter,
  slug: string,
  request: Request,
  url: URL,
  callerSignal: AbortSignal | undefined,
  dependencySnapshot: DependencyPinningSnapshot,
  dependencyPinningSource: DependencyPinningSourceInput,
): Promise<PageDataResponse> {
  const controller = new AbortController();
  const workRequest = callerSignal ? request : new Request(request, { signal: controller.signal });

  const pageData = await withTimeoutThrow(
    renderer.resolvePageData(slug, {
      request: workRequest,
      url,
      abortSignal: controller.signal,
      dependencyPinningCacheKey: dependencySnapshot.cacheKey,
      dependencyPinningDependencies: dependencySnapshot.dependencies,
      dependencyPinningSource,
    }),
    PAGE_DATA_TIMEOUT_MS,
    `resolvePageData for ${slug}`,
    {
      signal: callerSignal,
      onAbort: (reason) => controller.abort(reason),
      onTimeout: (error) => controller.abort(error),
    },
  );

  return dependencySnapshot.cacheKey === "off" ? pageData : {
    ...pageData,
    dependencyPinningCacheKey: dependencySnapshot.cacheKey,
  };
}

export function __clearPageDataEndpointCacheForTests(): void {
  pageDataCache.clear();
}

export function handlePageDataEndpoint(
  req: Request,
  pathname: string,
  ctx: HandlerContext,
  createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
  getErrorMessage: (error: unknown) => string,
): Promise<HandlerResult> {
  return withSpan(
    "module.pageData.handle",
    async () => {
      let dependencySnapshot: DependencyPinningSnapshot | undefined;
      const respondPageData = (response: Response): HandlerResult =>
        respond(withSnapshotResponseHeaders(response, dependencySnapshot?.cacheKey));
      try {
        const slug = pathname
          .replace("/_veryfront/page-data/", "")
          .replace(/\.json$/, "") || "";

        const requested = readSnapshotHeader(req.headers);
        const dependencySource = createHandlerDependencyPinningSource(ctx);
        const resolution = await resolveSnapshotForRequest(dependencySource, requested);
        if (resolution.kind === "conflict") {
          return respondPageData(
            snapshotConflictResponse(createResponseBuilder(ctx), req, ctx.securityConfig),
          );
        }
        const resolvedDependencySnapshot = resolution.snapshot;
        dependencySnapshot = resolvedDependencySnapshot;

        const url = new URL(req.url);
        const applicationRequest = requested.kind === "absent" ? req : new Request(req, {
          headers: stripSnapshotHeader(req.headers),
        });
        const renderer = await getRendererForProject(ctx);
        const isSpeculativePrefetch = req.headers.get("x-veryfront-prefetch") === "1";
        // The request reaches server-data hooks, so prefetch work cannot safely
        // populate or join the foreground response cache/singleflight.
        const canUsePageDataCache = isPageDataCacheEnabled() &&
          !requestHasCacheSensitiveState(applicationRequest) && !isSpeculativePrefetch;
        const cacheKey = canUsePageDataCache
          ? buildPageDataCacheKey(ctx, slug, url, resolvedDependencySnapshot.cacheKey)
          : null;
        const cachePolicy = cacheKey ? getPageDataCachePolicy(ctx) : null;

        const payload = cacheKey
          ? await waitForSharedPromise(
            resolveCachedPageData(
              cacheKey,
              () =>
                resolvePageDataWithinDeadline(
                  renderer,
                  slug,
                  applicationRequest,
                  url,
                  undefined,
                  resolvedDependencySnapshot,
                  dependencySource,
                ),
              cachePolicy!,
            ),
            req.signal,
          )
          : await resolveUncachedPageData(() =>
            resolvePageDataWithinDeadline(
              renderer,
              slug,
              applicationRequest,
              url,
              req.signal,
              resolvedDependencySnapshot,
              dependencySource,
            )
          );
        const cacheStrategy = cacheKey && resolvedDependencySnapshot.cacheKey === "off"
          ? {
            maxAge: cachePolicy!.maxAgeSeconds,
            public: true,
            ...(cachePolicy!.staleSeconds > 0
              ? { staleWhileRevalidate: cachePolicy!.staleSeconds }
              : {}),
          }
          : "no-cache";

        const builder = createResponseBuilder(ctx).withCORS(
          req,
          ctx.securityConfig?.cors,
        );

        if (hasMatchingEtag(req, payload.etag)) {
          return respondPageData(builder.notModified(payload.etag));
        }

        return respondPageData(
          builder
            .withSecurity(ctx.securityConfig ?? undefined, req)
            .withCache(cacheStrategy)
            .withETag(payload.etag)
            .withHeaders({ "content-type": "application/json" })
            .build(payload.body, 200),
        );
      } catch (e) {
        if (e instanceof TimeoutError) {
          serverLogger.warn("[page-data] Request timed out", {
            pathname,
            detail: e.message,
          });
          return respondPageData(
            ResponseBuilder.json(
              { error: "Page data request timed out", status: HTTP_GATEWAY_TIMEOUT },
              req,
              {
                securityConfig: ctx.securityConfig,
                corsConfig: ctx.securityConfig?.cors,
                status: HTTP_GATEWAY_TIMEOUT,
              },
            ),
          );
        }

        // The full-page render path turns a control outcome into a 302 or a 404
        // page. The SPA page-data endpoint has to encode the same decision as a
        // payload the client router can act on, rather than as an internal
        // error (which 500s and aborts navigation).
        const control = resolveSSRControlOutcome(e);

        // A destination the client refuses to follow is not a redirect the
        // endpoint can encode, so it falls through to normal error handling.
        if (
          control?.kind === "redirect" &&
          isFollowableRedirect(control.location) &&
          isRedirectDestinationAllowed(
            control.location,
            ctx.requestOrigin === undefined ? req.url : ctx.requestOrigin,
            ctx.securityConfig?.redirects,
          )
        ) {
          return respondPageData(
            ResponseBuilder.json(
              {
                redirect: { destination: control.location, permanent: control.permanent },
                ...(dependencySnapshot?.cacheKey.startsWith("on:")
                  ? { dependencyPinningCacheKey: dependencySnapshot.cacheKey }
                  : {}),
              },
              req,
              {
                securityConfig: ctx.securityConfig,
                corsConfig: ctx.securityConfig?.cors,
                status: 200,
              },
            ),
          );
        }

        const errorMessage = control?.kind === "redirect"
          ? "Redirect destination is not allowed"
          : getErrorMessage(e);
        const isNotFound = control?.kind === "not-found";
        const status = isNotFound ? 404 : 500;

        // Log the full error server-side but return a generic message
        // to avoid leaking internal details (file paths, DB schema, etc.)
        serverLogger.error("[page-data] Failed to resolve page data", {
          pathname,
          error: errorMessage,
          status,
        });

        return respondPageData(
          ResponseBuilder.json(
            { error: isNotFound ? "Page not found" : "Internal server error", status },
            req,
            {
              securityConfig: ctx.securityConfig,
              corsConfig: ctx.securityConfig?.cors,
              status,
            },
          ),
        );
      }
    },
    {
      "module.pageData.pathname": pathname,
      "module.pageData.projectSlug": ctx.projectSlug || "unknown",
    },
  );
}

async function resolveCachedPageData(
  cacheKey: string,
  resolve: () => Promise<PageDataResponse>,
  cachePolicy: PageDataCachePolicy,
): Promise<PageDataCacheEntry> {
  const cached = getCachedPageData(cacheKey);
  if (cached?.state === "fresh") {
    markRequestProfilePhase("page_data.cache_hit");
    return cached.entry;
  }

  if (cached?.state === "stale") {
    markRequestProfilePhase("page_data.cache_stale");
    refreshStalePageData(cacheKey, resolve, cachePolicy);
    return cached.entry;
  }

  markRequestProfilePhase("page_data.cache_miss");
  return await pageDataFlight.do(cacheKey, async () => {
    const concurrentCached = getCachedPageData(cacheKey);
    if (concurrentCached?.state === "fresh") {
      markRequestProfilePhase("page_data.cache_hit_after_wait");
      return concurrentCached.entry;
    }

    if (concurrentCached?.state === "stale") {
      markRequestProfilePhase("page_data.cache_stale_after_wait");
      refreshStalePageData(cacheKey, resolve, cachePolicy);
      return concurrentCached.entry;
    }

    const payload = await resolveUncachedPageData(resolve, cachePolicy);
    setCachedPageData(cacheKey, payload);
    return payload;
  });
}

async function resolveUncachedPageData(
  resolve: () => Promise<PageDataResponse>,
  cachePolicy = RELEASE_PAGE_DATA_CACHE_POLICY,
): Promise<PageDataCacheEntry> {
  const startedAt = performance.now();
  const pageData = await resolve();
  markRequestProfilePhase("page_data.resolve", performance.now() - startedAt);

  const bodyStart = performance.now();
  const body = JSON.stringify(pageData);
  const etag = computeEtag(body);
  markRequestProfilePhase("page_data.serialize", performance.now() - bodyStart);

  return {
    body,
    etag,
    expiresAt: Date.now() + cachePolicy.ttlMs,
    staleUntil: Date.now() + cachePolicy.ttlMs + cachePolicy.staleMs,
  };
}

function getCachedPageData(
  cacheKey: string,
): { entry: PageDataCacheEntry; state: "fresh" | "stale" } | null {
  const entry = pageDataCache.get(cacheKey);
  if (!entry) return null;

  const now = Date.now();
  if (now <= entry.expiresAt) {
    pageDataCache.delete(cacheKey);
    pageDataCache.set(cacheKey, entry);
    return { entry, state: "fresh" };
  }

  if (now <= entry.staleUntil) {
    pageDataCache.delete(cacheKey);
    pageDataCache.set(cacheKey, entry);
    return { entry, state: "stale" };
  }

  pageDataCache.delete(cacheKey);
  markRequestProfilePhase("page_data.cache_expired");
  return null;
}

function setCachedPageData(cacheKey: string, entry: PageDataCacheEntry): void {
  if (!isPageDataCacheEnabled()) return;

  if (pageDataCache.size >= PAGE_DATA_CACHE_MAX_ENTRIES && !pageDataCache.has(cacheKey)) {
    const oldestKey = pageDataCache.keys().next().value;
    if (oldestKey) pageDataCache.delete(oldestKey);
  }

  pageDataCache.set(cacheKey, entry);
}

function refreshStalePageData(
  cacheKey: string,
  resolve: () => Promise<PageDataResponse>,
  cachePolicy: PageDataCachePolicy,
): void {
  void pageDataFlight.do(cacheKey, async () => {
    const payload = await resolveUncachedPageData(resolve, cachePolicy);
    setCachedPageData(cacheKey, payload);
    return payload;
  }).then(
    () => {
      markRequestProfilePhase("page_data.refresh_background");
    },
    (error) => {
      serverLogger.warn("[page-data] Background refresh failed", {
        detail: error instanceof Error ? error.message : String(error),
      });
      const stale = pageDataCache.get(cacheKey);
      if (stale && Date.now() > stale.staleUntil) {
        pageDataCache.delete(cacheKey);
      }
    },
  );
}

/**
 * Only http(s) and root-relative destinations may be encoded for the client to
 * follow. The client follows the destination with `window.location.href`, which
 * would EXECUTE a `javascript:`/`data:` URL — unlike the full-page 302 path where
 * the browser ignores such a Location. Protocol-relative `//host` is rejected too
 * (it is easy to smuggle past a naive "starts with /" check). Blocked
 * destinations fall through to normal error handling instead of being followed.
 */
function isFollowableRedirect(destination: string): boolean {
  if (destination.startsWith("/")) {
    const baseOrigin = "https://veryfront.local";
    try {
      return new URL(destination, baseOrigin).origin === baseOrigin;
    } catch {
      return false;
    }
  }
  return /^https?:\/\//i.test(destination);
}

function buildPageDataCacheKey(
  ctx: HandlerContext,
  slug: string,
  url: URL,
  dependencyPinningCacheKey = "off",
): string {
  const projectKey = ctx.projectId ?? ctx.projectSlug ?? ctx.projectDir;
  const environment = ctx.resolvedEnvironment ?? ctx.requestContext?.mode ?? "preview";
  const contentSource = ctx.enriched?.contentSourceId ??
    (environment === "production"
      ? ctx.releaseId ?? "release"
      : ctx.requestContext?.branch ?? "main");
  const queryParamOptions = ctx.config?.cache?.queryParams as QueryParamCacheOptions | undefined;
  const query = sanitizeQueryParamsForCacheKey(url, queryParamOptions);

  const baseKey = [
    projectKey,
    environment,
    contentSource,
    slug || "index",
    query,
  ].join("|");
  return dependencyPinningCacheKey.startsWith("on:")
    ? `${baseKey}|pins:${dependencyPinningCacheKey}`
    : baseKey;
}
