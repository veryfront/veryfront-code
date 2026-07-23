import { requestHasCacheSensitiveState } from "#veryfront/cache/request-cacheability.ts";
import {
  type QueryParamCacheOptions,
  sanitizeQueryParamsForCacheKey,
} from "#veryfront/cache/keys.ts";
import { markRequestProfilePhase } from "#veryfront/observability";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import type { PageDataResponse } from "#veryfront/rendering/orchestrator/types.ts";
import { serverLogger } from "#veryfront/utils";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import { HTTP_INTERNAL_SERVER_ERROR } from "#veryfront/utils/constants/http.ts";
import type { HandlerContext } from "../../types.ts";
import { computeEtag } from "../../utils/etag.ts";
import { getSafeErrorName } from "../../../utils/error-name.ts";

const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_CACHE_STALE_MS = 30 * 60_000;
const DEFAULT_CACHE_MAX_ENTRIES = 500;
const DEFAULT_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const MAX_CACHE_DURATION_MS = 365 * 24 * 60 * 60_000;
const MAX_CACHE_ENTRIES = 100_000;
const textEncoder = new TextEncoder();

export interface PageDataCacheConfiguration {
  ttlMs: number;
  staleMs: number;
  maxEntries: number;
  maxBytes: number;
}

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
  sizeBytes: number;
}

export type PageDataCacheStrategy =
  | "no-cache"
  | {
    maxAge: number;
    public: true;
    staleWhileRevalidate?: number;
  };

export interface PageDataResolution {
  payload: Pick<PageDataCacheEntry, "body" | "etag">;
  cacheStrategy: PageDataCacheStrategy;
}

function readBoundedIntegerEnv(
  name: string,
  fallback: number,
  maximum: number,
): number {
  const raw = getEnv(name)?.trim();
  if (!raw || !/^(?:0|[1-9]\d*)$/.test(raw)) return fallback;

  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= maximum ? value : fallback;
}

export function readPageDataCacheConfiguration(): PageDataCacheConfiguration {
  return {
    ttlMs: readBoundedIntegerEnv(
      "VERYFRONT_PAGE_DATA_CACHE_TTL_MS",
      DEFAULT_CACHE_TTL_MS,
      MAX_CACHE_DURATION_MS,
    ),
    staleMs: readBoundedIntegerEnv(
      "VERYFRONT_PAGE_DATA_CACHE_STALE_MS",
      DEFAULT_CACHE_STALE_MS,
      MAX_CACHE_DURATION_MS,
    ),
    maxEntries: readBoundedIntegerEnv(
      "VERYFRONT_PAGE_DATA_CACHE_MAX_ENTRIES",
      DEFAULT_CACHE_MAX_ENTRIES,
      MAX_CACHE_ENTRIES,
    ),
    maxBytes: DEFAULT_CACHE_MAX_BYTES,
  };
}

export function buildPageDataCacheKey(ctx: HandlerContext, slug: string, url: URL): string {
  const projectKey = ctx.projectId ?? ctx.projectSlug ?? ctx.projectDir;
  const environment = ctx.resolvedEnvironment ?? ctx.requestContext?.mode ?? "preview";
  const contentSource = ctx.enriched?.contentSourceId ??
    (environment === "production"
      ? ctx.releaseId ?? "release"
      : ctx.requestContext?.branch ?? "main");
  const queryParamOptions = ctx.config?.cache?.queryParams as QueryParamCacheOptions | undefined;
  const query = sanitizeQueryParamsForCacheKey(url, queryParamOptions);

  return JSON.stringify([
    projectKey,
    environment,
    contentSource,
    slug || "index",
    query,
  ]);
}

function releasePolicy(config: PageDataCacheConfiguration): PageDataCachePolicy {
  return {
    ttlMs: config.ttlMs,
    staleMs: config.staleMs,
    maxAgeSeconds: Math.max(0, Math.floor(config.ttlMs / 1000)),
    staleSeconds: Math.max(0, Math.floor(config.staleMs / 1000)),
  };
}

function cachePolicyFor(
  ctx: HandlerContext,
  config: PageDataCacheConfiguration,
): PageDataCachePolicy {
  const policy = releasePolicy(config);
  const environment = ctx.resolvedEnvironment ?? ctx.requestContext?.mode ?? "preview";
  if (environment === "production" && ctx.releaseId) return policy;
  return { ...policy, staleMs: 0, staleSeconds: 0 };
}

function cacheStrategyFor(policy: PageDataCachePolicy): PageDataCacheStrategy {
  return {
    maxAge: policy.maxAgeSeconds,
    public: true,
    ...(policy.staleSeconds > 0 ? { staleWhileRevalidate: policy.staleSeconds } : {}),
  };
}

export class PageDataEndpointCache {
  readonly #entries = new Map<string, PageDataCacheEntry>();
  #flight = new Singleflight<PageDataCacheEntry>();
  #generation = 0;
  #storedBytes = 0;

  constructor(private readonly config: PageDataCacheConfiguration) {}

  clear(): void {
    this.#generation++;
    this.#entries.clear();
    this.#storedBytes = 0;
    this.#flight = new Singleflight<PageDataCacheEntry>();
  }

  async resolve(
    req: Request,
    ctx: HandlerContext,
    slug: string,
    url: URL,
    resolvePageData: () => Promise<PageDataResponse>,
  ): Promise<PageDataResolution> {
    const cacheEnabled = this.config.maxEntries > 0 && this.config.maxBytes > 0;
    const cacheKey = cacheEnabled && !requestHasCacheSensitiveState(req)
      ? buildPageDataCacheKey(ctx, slug, url)
      : null;
    if (!cacheKey) {
      return {
        payload: await this.#resolvePayload(resolvePageData, releasePolicy(this.config)),
        cacheStrategy: "no-cache",
      };
    }

    const policy = cachePolicyFor(ctx, this.config);
    return {
      payload: await this.#resolveCached(cacheKey, resolvePageData, policy),
      cacheStrategy: cacheStrategyFor(policy),
    };
  }

  async #resolveCached(
    cacheKey: string,
    resolvePageData: () => Promise<PageDataResponse>,
    policy: PageDataCachePolicy,
  ): Promise<PageDataCacheEntry> {
    const cached = this.#get(cacheKey);
    if (cached?.state === "fresh") {
      markRequestProfilePhase("page_data.cache_hit");
      return cached.entry;
    }
    if (cached?.state === "stale") {
      markRequestProfilePhase("page_data.cache_stale");
      this.#refresh(cacheKey, resolvePageData, policy);
      return cached.entry;
    }

    markRequestProfilePhase("page_data.cache_miss");
    const generation = this.#generation;
    const flight = this.#flight;
    return await flight.do(cacheKey, async () => {
      const concurrent = this.#get(cacheKey);
      if (concurrent?.state === "fresh") {
        markRequestProfilePhase("page_data.cache_hit_after_wait");
        return concurrent.entry;
      }
      if (concurrent?.state === "stale") {
        markRequestProfilePhase("page_data.cache_stale_after_wait");
        this.#refresh(cacheKey, resolvePageData, policy);
        return concurrent.entry;
      }

      const payload = await this.#resolvePayload(resolvePageData, policy);
      if (generation === this.#generation) this.#set(cacheKey, payload);
      return payload;
    });
  }

  async #resolvePayload(
    resolvePageData: () => Promise<PageDataResponse>,
    policy: PageDataCachePolicy,
  ): Promise<PageDataCacheEntry> {
    const startedAt = performance.now();
    const pageData = await resolvePageData();
    markRequestProfilePhase("page_data.resolve", performance.now() - startedAt);

    const bodyStart = performance.now();
    const body = JSON.stringify(pageData);
    const bytes = textEncoder.encode(body);
    const etag = await computeEtag(bytes);
    markRequestProfilePhase("page_data.serialize", performance.now() - bodyStart);

    const now = Date.now();
    return {
      body,
      etag,
      expiresAt: now + policy.ttlMs,
      staleUntil: now + policy.ttlMs + policy.staleMs,
      sizeBytes: Math.max(bytes.byteLength, body.length * 2),
    };
  }

  #get(
    cacheKey: string,
  ): { entry: PageDataCacheEntry; state: "fresh" | "stale" } | null {
    const entry = this.#entries.get(cacheKey);
    if (!entry) return null;

    const now = Date.now();
    if (now <= entry.expiresAt) {
      this.#touch(cacheKey, entry);
      return { entry, state: "fresh" };
    }
    if (now <= entry.staleUntil) {
      this.#touch(cacheKey, entry);
      return { entry, state: "stale" };
    }

    this.#delete(cacheKey);
    markRequestProfilePhase("page_data.cache_expired");
    return null;
  }

  #touch(cacheKey: string, entry: PageDataCacheEntry): void {
    this.#entries.delete(cacheKey);
    this.#entries.set(cacheKey, entry);
  }

  #delete(cacheKey: string): void {
    const existing = this.#entries.get(cacheKey);
    if (!existing) return;
    this.#entries.delete(cacheKey);
    this.#storedBytes -= existing.sizeBytes;
  }

  #set(cacheKey: string, entry: PageDataCacheEntry): void {
    this.#delete(cacheKey);
    if (entry.sizeBytes > this.config.maxBytes) return;

    while (
      this.#entries.size >= this.config.maxEntries ||
      this.#storedBytes + entry.sizeBytes > this.config.maxBytes
    ) {
      const oldestKey = this.#entries.keys().next().value;
      if (typeof oldestKey !== "string") return;
      this.#delete(oldestKey);
    }

    this.#entries.set(cacheKey, entry);
    this.#storedBytes += entry.sizeBytes;
  }

  #refresh(
    cacheKey: string,
    resolvePageData: () => Promise<PageDataResponse>,
    policy: PageDataCachePolicy,
  ): void {
    const generation = this.#generation;
    const flight = this.#flight;
    void flight.do(cacheKey, async () => {
      const payload = await this.#resolvePayload(resolvePageData, policy);
      if (generation === this.#generation) this.#set(cacheKey, payload);
      return payload;
    }).then(
      () => markRequestProfilePhase("page_data.refresh_background"),
      (error) => {
        serverLogger.warn("[page-data] Background refresh failed", {
          errorName: getSafeErrorName(error),
          status: HTTP_INTERNAL_SERVER_ERROR,
        });
        const stale = this.#entries.get(cacheKey);
        if (stale && Date.now() > stale.staleUntil) this.#delete(cacheKey);
      },
    );
  }
}
