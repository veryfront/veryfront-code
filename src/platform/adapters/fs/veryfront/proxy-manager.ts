import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import { CACHE_INVARIANT_VIOLATION, INVALID_ARGUMENT } from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { buildProxyManagerCacheKey } from "#veryfront/cache/keys/index.ts";
import { VeryfrontFSAdapter } from "./adapter.ts";
import type { CacheStats, FSAdapterConfig, ResolvedContentContext } from "./types.ts";
import { getGetAdapterParamsSchema } from "./schemas/index.ts";
import { createDefaultInvalidationCallbacks } from "./default-invalidation-callbacks.ts";

const logger = baseLogger.component("proxy-fs-adapter-manager");

const DEFAULT_MAX_ADAPTERS = 100;
const DEFAULT_MAX_IDLE_MS = 30 * 60 * 1_000;

interface ProjectAdapter {
  adapter: VeryfrontFSAdapter;
  lastAccessed: number;
  initializing?: Promise<void>;
}

interface ProxyFSAdapterManagerConfig {
  baseConfig: FSAdapterConfig;
  maxAdapters?: number;
  cleanupIntervalMs?: number;
  maxIdleMs?: number;
}

interface NegativeCacheEntry {
  fallbackBranch: string | null;
  timer: ReturnType<typeof setTimeout>;
}

interface ApiErrorDetails {
  responseText?: string;
  url?: string;
}

function isPushPreviewBranch(branch: string | null | undefined, productionMode: boolean): boolean {
  return !productionMode && !!branch && branch !== "main" && branch.startsWith("push-");
}

function getApiErrorDetails(error: unknown): ApiErrorDetails | null {
  if (!(error instanceof VeryfrontError) || !error.context || typeof error.context !== "object") {
    return null;
  }

  const details =
    (error.context as { details?: { responseText?: unknown; url?: unknown } }).details;
  if (!details || typeof details !== "object") return null;

  const apiErrorDetails: ApiErrorDetails = {};
  if (typeof details.responseText === "string") {
    apiErrorDetails.responseText = details.responseText;
  }
  if (typeof details.url === "string") {
    apiErrorDetails.url = details.url;
  }

  return apiErrorDetails.responseText || apiErrorDetails.url ? apiErrorDetails : null;
}

function getProblemDetail(error: unknown): string | null {
  const responseText = getApiErrorDetails(error)?.responseText;
  if (!responseText) return null;

  try {
    const parsed = JSON.parse(responseText) as { detail?: unknown };
    return typeof parsed.detail === "string" ? parsed.detail : null;
  } catch {
    return null;
  }
}

export function getPushRefFallbackBranch(
  error: unknown,
  branch: string | null | undefined,
  productionMode = false,
): string | null {
  if (!branch || !isPushPreviewBranch(branch, productionMode)) return null;
  if (!(error instanceof VeryfrontError) || error.status !== 404) return null;

  const apiErrorDetails = getApiErrorDetails(error);
  if (
    !apiErrorDetails?.url?.includes("/files?") ||
    !apiErrorDetails.url.includes(`branch=${encodeURIComponent(branch)}`)
  ) {
    return null;
  }

  const detail = getProblemDetail(error);
  if (detail && !detail.includes(`Branch '${branch}' not found`)) {
    return null;
  }

  return "main";
}

export class ProxyFSAdapterManager {
  private adapters = new Map<string, ProjectAdapter>();
  private pendingAdapters = new Map<string, Promise<VeryfrontFSAdapter>>();
  private negativeCacheEntries = new Map<string, NegativeCacheEntry>();
  private baseConfig: FSAdapterConfig;
  private maxAdapters: number;
  private maxIdleMs: number;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(config: ProxyFSAdapterManagerConfig) {
    this.baseConfig = config.baseConfig;
    this.maxAdapters = config.maxAdapters ?? DEFAULT_MAX_ADAPTERS;
    this.maxIdleMs = config.maxIdleMs ?? DEFAULT_MAX_IDLE_MS;

    if (config.cleanupIntervalMs) {
      this.cleanupTimer = setInterval(
        (): void => this.cleanupIdleAdapters(),
        config.cleanupIntervalMs,
      );
    }

    logger.debug("Created", {
      maxAdapters: this.maxAdapters,
      maxIdleMs: this.maxIdleMs,
    });
  }

  async getAdapter(
    projectSlug: string,
    token: string,
    projectId?: string,
    productionMode?: boolean,
    releaseId?: string | null,
    environmentName?: string | null,
    branch?: string | null,
  ): Promise<VeryfrontFSAdapter> {
    const getAdapterStartTime = performance.now();

    const effectiveProductionMode = productionMode ?? false;
    const effectiveReleaseId = releaseId ?? null;
    const effectiveEnvironmentName = environmentName ??
      (effectiveProductionMode ? "production" : null);
    const effectiveBranch = branch ?? (effectiveProductionMode ? null : "main");

    logger.debug("getAdapter START", {
      projectSlug,
      productionMode: effectiveProductionMode,
      releaseId: effectiveReleaseId,
      environmentName: effectiveEnvironmentName,
      branch: effectiveBranch,
    });

    const validationResult = getGetAdapterParamsSchema().safeParse({
      projectSlug,
      token,
      projectId,
      productionMode: effectiveProductionMode,
      releaseId: effectiveReleaseId,
      environmentName: effectiveEnvironmentName,
      branch: effectiveBranch,
    });

    if (!validationResult.success) {
      logger.error("Validation failed", {
        errors: validationResult.issues,
        params: {
          projectSlug,
          productionMode: effectiveProductionMode,
          releaseId: effectiveReleaseId,
          environmentName: effectiveEnvironmentName,
          branch: effectiveBranch,
        },
      });
      const detailMessage = validationResult.issues
        .map((issue) =>
          issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message
        )
        .join("; ");
      throw INVALID_ARGUMENT.create({
        detail: `[ProxyFSAdapterManager] Invalid getAdapter parameters: ${detailMessage}`,
      });
    }

    const cacheKey = buildProxyManagerCacheKey(
      projectSlug,
      effectiveProductionMode,
      effectiveReleaseId,
      effectiveBranch,
    );

    logger.debug("getAdapter called", {
      projectSlug,
      productionMode: effectiveProductionMode,
      releaseId: effectiveReleaseId,
      environmentName: effectiveEnvironmentName,
      branch: effectiveBranch,
      cacheKey,
      hasExisting: this.adapters.has(cacheKey),
      totalCachedAdapters: this.adapters.size,
    });

    const negativeEntry = this.negativeCacheEntries.get(cacheKey);
    if (negativeEntry?.fallbackBranch && negativeEntry.fallbackBranch !== effectiveBranch) {
      logger.warn("Using cached fallback branch for push ref", {
        branch: effectiveBranch,
        cacheKey,
        fallbackBranch: negativeEntry.fallbackBranch,
        projectSlug,
      });
      return this.getAdapter(
        projectSlug,
        token,
        projectId,
        effectiveProductionMode,
        effectiveReleaseId,
        effectiveEnvironmentName,
        negativeEntry.fallbackBranch,
      );
    }

    // Reject known-bad cache keys only when there is no fallback target.
    if (negativeEntry) {
      logger.warn("Rejecting adapter request for negatively-cached key", {
        cacheKey,
        projectSlug,
      });
      throw INVALID_ARGUMENT.create({
        detail:
          `Adapter for "${cacheKey}" is negatively cached (previous initialization returned 404). Retry after 60s.`,
      });
    }

    const existing = this.adapters.get(cacheKey);
    if (existing) {
      existing.lastAccessed = Date.now();
      existing.adapter.setRequestToken(token);

      const existingContext = existing.adapter.getContentContext();
      logger.debug("REUSING_CACHED_ADAPTER", {
        cacheKey,
        requestedReleaseId: effectiveReleaseId,
        cachedSourceType: existingContext?.sourceType,
        cachedReleaseId: existingContext?.releaseId,
      });

      this.assertContextMatches(cacheKey, existingContext, {
        productionMode: effectiveProductionMode,
        releaseId: effectiveReleaseId,
        environmentName: effectiveEnvironmentName,
        branch: effectiveBranch,
      });

      return existing.adapter;
    }

    const pending = this.pendingAdapters.get(cacheKey);
    if (pending) {
      logger.debug("Waiting for pending adapter creation", {
        cacheKey,
        projectSlug,
      });

      const waitStartTime = performance.now();
      const adapter = await pending;

      logger.debug("Pending adapter ready", {
        cacheKey,
        waitDuration: `${(performance.now() - waitStartTime).toFixed(2)}ms`,
        totalDuration: `${(performance.now() - getAdapterStartTime).toFixed(2)}ms`,
      });

      adapter.setRequestToken(token);
      return adapter;
    }

    if (this.adapters.size >= this.maxAdapters) {
      this.evictLeastRecentlyUsed();
    }

    logger.debug("Creating new adapter", {
      cacheKey,
      projectSlug,
      elapsedBeforeCreate: `${(performance.now() - getAdapterStartTime).toFixed(2)}ms`,
    });

    return this.createAdapter(
      cacheKey,
      projectSlug,
      token,
      projectId,
      effectiveProductionMode,
      effectiveReleaseId,
      effectiveEnvironmentName,
      effectiveBranch,
    );
  }

  private assertContextMatches(
    cacheKey: string,
    currentContext: ResolvedContentContext | null | undefined,
    expected: {
      productionMode: boolean;
      releaseId: string | null;
      environmentName: string | null;
      branch: string | null;
    },
  ): void {
    if (!currentContext) {
      logger.error("Null context detected", { cacheKey });
      throw CACHE_INVARIANT_VIOLATION.create({
        detail: `[ProxyFSAdapterManager] FATAL: Cached adapter has null context. ` +
          `This indicates a critical bug in adapter initialization. ` +
          `CacheKey: ${cacheKey}`,
      });
    }

    const mismatchReason = this.getContextMismatchReason(currentContext, expected);
    if (!mismatchReason) return;

    logger.error("Context mismatch detected", {
      cacheKey,
      currentContext,
      expected,
      mismatchReason,
    });

    throw CACHE_INVARIANT_VIOLATION.create({
      detail: `[ProxyFSAdapterManager] FATAL: Context mismatch for cached adapter. ` +
        `This indicates a critical bug in adapter caching. ` +
        `Reason: ${mismatchReason}. ` +
        `Expected: ${JSON.stringify(expected)} ` +
        `Got: ${JSON.stringify(currentContext)} ` +
        `CacheKey: ${cacheKey}`,
    });
  }

  private getContextMismatchReason(
    currentContext: ResolvedContentContext,
    expected: {
      productionMode: boolean;
      releaseId: string | null;
      environmentName: string | null;
      branch: string | null;
    },
  ): string | null {
    if (expected.productionMode) {
      if (currentContext.sourceType !== "release" && currentContext.sourceType !== "environment") {
        return `Expected sourceType "release" or "environment", got "${currentContext.sourceType}"`;
      }

      if (
        currentContext.sourceType === "release" && currentContext.releaseId !== expected.releaseId
      ) {
        return `Expected releaseId "${expected.releaseId}", got "${currentContext.releaseId}"`;
      }

      if (
        currentContext.sourceType === "environment" &&
        currentContext.environmentName !== expected.environmentName
      ) {
        return `Expected environmentName "${expected.environmentName}", got "${currentContext.environmentName}"`;
      }

      return null;
    }

    if (currentContext.sourceType !== "branch") {
      return `Expected sourceType "branch", got "${currentContext.sourceType}"`;
    }

    if (currentContext.branch !== expected.branch) {
      return `Expected branch "${expected.branch}", got "${currentContext.branch}"`;
    }

    return null;
  }

  private createAdapter(
    cacheKey: string,
    projectSlug: string,
    token: string,
    projectId: string | undefined,
    productionMode: boolean,
    releaseId: string | null,
    environmentName: string | null,
    branch: string | null,
  ): Promise<VeryfrontFSAdapter> {
    const effectiveToken = token || this.baseConfig.veryfront?.apiToken;

    logger.debug("Creating NEW adapter", {
      cacheKey,
      projectSlug,
      productionMode,
      releaseId,
      environmentName,
      branch,
      totalCachedAdapters: this.adapters.size,
    });

    const config: FSAdapterConfig = {
      ...this.baseConfig,
      veryfront: {
        ...this.baseConfig.veryfront,
        projectSlug,
        projectId,
        apiToken: effectiveToken,
      },
      invalidationCallbacks: createDefaultInvalidationCallbacks({
        ...this.baseConfig.invalidationCallbacks,
        evictCurrentAdapter: () =>
          this.evictAdapter(projectSlug, productionMode, releaseId, branch),
      }),
    };

    const adapter = new VeryfrontFSAdapter(config);

    let context: ResolvedContentContext;
    if (productionMode) {
      if (releaseId) {
        context = { sourceType: "release", projectSlug, releaseId };
      } else {
        context = { sourceType: "environment", projectSlug, environmentName: environmentName! };
      }
    } else {
      context = { sourceType: "branch", projectSlug, branch: branch! };
    }

    logger.debug("CONTENT_CONTEXT_SET", {
      cacheKey,
      projectSlug,
      productionMode,
      releaseId,
      environmentName,
      sourceType: context.sourceType,
      contextReleaseId: "releaseId" in context ? context.releaseId : "N/A",
    });

    adapter.setContentContext(context);

    const projectAdapter: ProjectAdapter = { adapter, lastAccessed: Date.now() };

    const initPromise = (async (): Promise<VeryfrontFSAdapter> => {
      const initStartTime = performance.now();

      logger.debug("Adapter initialization START", {
        cacheKey,
        projectSlug,
      });

      projectAdapter.initializing = adapter.initialize();

      try {
        await projectAdapter.initializing;

        logger.debug("Adapter initialization DONE", {
          cacheKey,
          projectSlug,
          duration: `${(performance.now() - initStartTime).toFixed(2)}ms`,
        });

        this.adapters.set(cacheKey, projectAdapter);
        return adapter;
      } catch (error) {
        const fallbackBranch = getPushRefFallbackBranch(error, branch, productionMode);

        if (fallbackBranch) {
          const NEGATIVE_CACHE_TTL_MS = 60_000;
          logger.warn("Push ref initialization returned 404, retrying with fallback branch", {
            branch,
            cacheKey,
            duration: `${(performance.now() - initStartTime).toFixed(2)}ms`,
            fallbackBranch,
            projectSlug,
          });
          const existingEntry = this.negativeCacheEntries.get(cacheKey);
          if (existingEntry) {
            clearTimeout(existingEntry.timer);
          }
          const timer = setTimeout(() => {
            this.negativeCacheEntries.delete(cacheKey);
            logger.debug("Negative cache sentinel expired", { cacheKey });
          }, NEGATIVE_CACHE_TTL_MS);
          // Unref so the timer doesn't keep processes/tests alive
          try {
            Deno.unrefTimer(timer);
          } catch {
            // Not available in all runtimes
          }
          this.negativeCacheEntries.set(cacheKey, { fallbackBranch, timer });

          return await this.getAdapter(
            projectSlug,
            token,
            projectId,
            productionMode,
            releaseId,
            environmentName,
            fallbackBranch,
          );
        }

        logger.error("Adapter initialization failed", {
          cacheKey,
          projectSlug,
          duration: `${(performance.now() - initStartTime).toFixed(2)}ms`,
          error: error instanceof Error ? error.message : String(error),
        });

        throw error;
      } finally {
        projectAdapter.initializing = undefined;
        this.pendingAdapters.delete(cacheKey);
      }
    })();

    this.pendingAdapters.set(cacheKey, initPromise);
    return initPromise;
  }

  private evictLeastRecentlyUsed(): void {
    let oldestCacheKey: string | null = null;
    let oldestTime = Infinity;

    for (const [cacheKey, adapter] of this.adapters) {
      if (adapter.lastAccessed < oldestTime) {
        oldestCacheKey = cacheKey;
        oldestTime = adapter.lastAccessed;
      }
    }

    if (!oldestCacheKey) return;

    logger.debug("Evicting LRU adapter", { cacheKey: oldestCacheKey });

    const adapter = this.adapters.get(oldestCacheKey);
    if (!adapter) return;

    adapter.adapter.dispose();
    this.adapters.delete(oldestCacheKey);
  }

  private cleanupIdleAdapters(): void {
    const now = Date.now();

    for (const [cacheKey, adapter] of this.adapters) {
      if (now - adapter.lastAccessed <= this.maxIdleMs) continue;

      logger.debug("Removing idle adapter", { cacheKey });
      adapter.adapter.dispose();
      this.adapters.delete(cacheKey);
    }
  }

  hasAdapter(
    projectSlug: string,
    productionMode?: boolean,
    releaseId?: string | null,
    branch?: string | null,
  ): boolean {
    const cacheKey = buildProxyManagerCacheKey(
      projectSlug,
      productionMode ?? false,
      releaseId ?? null,
      branch ?? null,
    );
    return this.adapters.has(cacheKey);
  }

  evictAdapter(
    projectSlug: string,
    productionMode?: boolean,
    releaseId?: string | null,
    branch?: string | null,
  ): void {
    const cacheKey = buildProxyManagerCacheKey(
      projectSlug,
      productionMode ?? false,
      releaseId ?? null,
      branch ?? null,
    );

    const adapter = this.adapters.get(cacheKey);
    if (!adapter) {
      logger.debug("No adapter to evict", { cacheKey });
      return;
    }

    logger.debug("Evicting adapter", { cacheKey });
    adapter.adapter.dispose();
    this.adapters.delete(cacheKey);
  }

  getStats(): { adapters: number; stats: Record<string, CacheStats> } {
    const stats: Record<string, CacheStats> = {};

    for (const [cacheKey, adapter] of this.adapters) {
      stats[cacheKey] = adapter.adapter.getCacheStats();
    }

    return { adapters: this.adapters.size, stats };
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    // Clear negative cache timers
    for (const entry of this.negativeCacheEntries.values()) {
      clearTimeout(entry.timer);
    }
    this.negativeCacheEntries.clear();

    for (const [cacheKey, adapter] of this.adapters) {
      logger.debug("Disposing adapter", { cacheKey });
      adapter.adapter.dispose();
    }

    this.adapters.clear();
    logger.debug("Disposed");
  }
}
