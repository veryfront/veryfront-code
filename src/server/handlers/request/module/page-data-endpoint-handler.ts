import type { HandlerContext, HandlerResult } from "../../types.ts";
import { computeEtag, hasMatchingEtag } from "../../utils/etag.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { getRendererForProject } from "../../../shared/renderer-factory.ts";
import { TimeoutError, withTimeoutThrow } from "#veryfront/rendering/utils/stream-utils.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { markRequestProfilePhase } from "#veryfront/observability/request-profiler.ts";
import { HTTP_GATEWAY_TIMEOUT } from "#veryfront/utils/constants/http.ts";
import { serverLogger } from "#veryfront/utils";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import { requestHasCacheSensitiveState } from "#veryfront/cache/request-cacheability.ts";
import type { PageDataResponse } from "#veryfront/rendering/orchestrator/types.ts";

const PAGE_DATA_TIMEOUT_MS = 25_000;
const PAGE_DATA_CACHE_TTL_MS = 60_000;
const PAGE_DATA_CACHE_MAX_ENTRIES = 500;

interface PageDataCacheEntry {
  body: string;
  etag: string;
  expiresAt: number;
}

const pageDataCache = new Map<string, PageDataCacheEntry>();
const pageDataFlight = new Singleflight<PageDataCacheEntry>();

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
      try {
        const slug = pathname
          .replace("/_veryfront/page-data/", "")
          .replace(/\.json$/, "") || "";

        const url = new URL(req.url);
        const renderer = await getRendererForProject(ctx);
        const cacheKey = requestHasCacheSensitiveState(req)
          ? null
          : buildPageDataCacheKey(ctx, slug, url);

        const payload = cacheKey
          ? await resolveCachedPageData(cacheKey, () =>
            withTimeoutThrow(
              renderer.resolvePageData(slug, { request: req, url }),
              PAGE_DATA_TIMEOUT_MS,
              `resolvePageData for ${slug}`,
            ))
          : await resolveUncachedPageData(() =>
            withTimeoutThrow(
              renderer.resolvePageData(slug, { request: req, url }),
              PAGE_DATA_TIMEOUT_MS,
              `resolvePageData for ${slug}`,
            )
          );
        const cacheStrategy = cacheKey ? { maxAge: 60, public: true } : "no-cache";

        const builder = createResponseBuilder(ctx).withCORS(
          req,
          ctx.securityConfig?.cors,
        );

        if (hasMatchingEtag(req, payload.etag)) {
          return respond(builder.notModified(payload.etag));
        }

        return respond(
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
          return respond(
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

        const errorMessage = getErrorMessage(e);
        const lower = errorMessage.toLowerCase();
        const isNotFound = lower.includes("not found") ||
          lower.includes("404") ||
          (e instanceof Error && e.message.toLowerCase().includes("no page"));
        const status = isNotFound ? 404 : 500;

        // Log the full error server-side but return a generic message
        // to avoid leaking internal details (file paths, DB schema, etc.)
        serverLogger.error("[page-data] Failed to resolve page data", {
          pathname,
          error: errorMessage,
          status,
        });

        return respond(
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
): Promise<PageDataCacheEntry> {
  const cached = getCachedPageData(cacheKey);
  if (cached) {
    markRequestProfilePhase("page_data.cache_hit");
    return cached;
  }

  markRequestProfilePhase("page_data.cache_miss");
  return await pageDataFlight.do(cacheKey, async () => {
    const concurrentCached = getCachedPageData(cacheKey);
    if (concurrentCached) {
      markRequestProfilePhase("page_data.cache_hit_after_wait");
      return concurrentCached;
    }

    const payload = await resolveUncachedPageData(resolve);
    setCachedPageData(cacheKey, payload);
    return payload;
  });
}

async function resolveUncachedPageData(
  resolve: () => Promise<PageDataResponse>,
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
    expiresAt: Date.now() + PAGE_DATA_CACHE_TTL_MS,
  };
}

function getCachedPageData(cacheKey: string): PageDataCacheEntry | null {
  const entry = pageDataCache.get(cacheKey);
  if (!entry) return null;

  if (Date.now() <= entry.expiresAt) return entry;

  pageDataCache.delete(cacheKey);
  markRequestProfilePhase("page_data.cache_expired");
  return null;
}

function setCachedPageData(cacheKey: string, entry: PageDataCacheEntry): void {
  if (pageDataCache.size >= PAGE_DATA_CACHE_MAX_ENTRIES && !pageDataCache.has(cacheKey)) {
    const oldestKey = pageDataCache.keys().next().value;
    if (oldestKey) pageDataCache.delete(oldestKey);
  }

  pageDataCache.set(cacheKey, entry);
}

function buildPageDataCacheKey(ctx: HandlerContext, slug: string, url: URL): string {
  const projectKey = ctx.projectId ?? ctx.projectSlug ?? ctx.projectDir;
  const environment = ctx.resolvedEnvironment ?? ctx.requestContext?.mode ?? "preview";
  const contentSource = ctx.enriched?.contentSourceId ??
    (environment === "production"
      ? ctx.releaseId ?? "release"
      : ctx.requestContext?.branch ?? "main");
  const query = buildSortedQueryKey(url);

  return [
    projectKey,
    environment,
    contentSource,
    slug || "index",
    query,
  ].join("|");
}

function buildSortedQueryKey(url: URL): string {
  const entries = Array.from(url.searchParams.entries());
  if (entries.length === 0) return "";

  return entries
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey)
    )
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}
