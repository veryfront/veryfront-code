import type { ProjectFile, VeryfrontApiClient } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import { buildFileCacheKeyPrefix, buildFileListCacheKey } from "./cache-keys.ts";
import { withRetryOnTransient } from "./retry.ts";
import type { ResolvedContentContext } from "./types.ts";
import { currentRequestContext } from "#veryfront/platform/request-context-access.ts";

export interface ContentContextProvider {
  isProductionMode: () => boolean;
  getReleaseId: () => string | null;
  getContentContext: () => ResolvedContentContext | null;
  getFileList?: (contentContext?: ResolvedContentContext | null) => Promise<
    Array<{
      id?: string;
      path: string;
      content?: string;
      type?: string;
      size?: number;
      updated_at?: string;
    }> | undefined
  >;
  hasCachedFileList?: () => Promise<boolean>;
  getSourceSnapshotVersion?: () => number | undefined;
  getSourceSnapshotIdentity?: () => string | undefined;
  isPersistentCacheInvalidated?: (prefix: string) => boolean;
  isReleaseBeingInvalidated?: (releaseId: string) => boolean;
}

interface FileListLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
}

interface LoadAllProjectFilesOptions {
  client: VeryfrontApiClient;
  cache: FileCache;
  contextProvider?: ContentContextProvider;
  logger: FileListLogger;
  operationLabel: string;
  contentContext?: ResolvedContentContext | null;
  snapshotRetryCount?: number;
}

const MAX_SNAPSHOT_RETRIES = 3;

export async function loadAllProjectFiles({
  client,
  cache,
  contextProvider,
  logger,
  operationLabel,
  contentContext,
  snapshotRetryCount = 0,
}: LoadAllProjectFilesOptions): Promise<ProjectFile[]> {
  const snapshotVersion = contextProvider?.getSourceSnapshotVersion?.();
  const cacheStart = performance.now();
  const ctx = contentContext === undefined ? contextProvider?.getContentContext() : contentContext;
  const snapshotIdentity = ctx
    ? ctx.sourceType === "branch"
      ? `branch:${ctx.projectSlug}:${ctx.branch ?? "main"}`
      : ctx.sourceType === "environment"
      ? `environment:${ctx.projectSlug}:${ctx.environmentName ?? ""}:${ctx.releaseId ?? ""}`
      : `release:${ctx.projectSlug}:${ctx.releaseId ?? ""}`
    : undefined;
  const cacheKeyPrefix = buildFileCacheKeyPrefix(ctx);
  const skipPersistentCache = !!currentRequestContext()?.token ||
    (contextProvider?.isPersistentCacheInvalidated?.(cacheKeyPrefix) ?? false);

  const adapterFiles = !skipPersistentCache ? await contextProvider?.getFileList?.(ctx) : undefined;

  if (adapterFiles) {
    const cacheMs = Math.round(performance.now() - cacheStart);
    logger.debug("getAllFilesRaw - from adapter cache", {
      cacheMs,
      fileCount: adapterFiles.length,
    });
    return adapterFiles as ProjectFile[];
  }

  const cacheKey = buildFileListCacheKey(ctx);

  if (skipPersistentCache) {
    logger.debug("getAllFilesRaw - skipping persistent cache", {
      cacheKey,
      cacheKeyPrefix,
    });
  }

  const cached = skipPersistentCache ? undefined : await cache.getAsync<ProjectFile[]>(cacheKey);
  const cacheMs = Math.round(performance.now() - cacheStart);

  if (cached) {
    logger.debug("getAllFilesRaw - fallback cache HIT", {
      cacheKey,
      cacheMs,
      fileCount: cached.length,
    });
    return cached;
  }

  logger.warn("getAllFilesRaw - cache MISS, fetching from API", {
    cacheKey,
    cacheMs,
  });

  const isPublished = ctx?.sourceType !== "branch";
  logger.debug("Fetching files from API", {
    sourceType: ctx?.sourceType,
    cacheKey,
  });

  const files = await withRetryOnTransient(
    () =>
      isPublished
        ? client.listPublishedFiles(
          undefined,
          ctx?.releaseId ?? undefined,
          ctx?.environmentName ?? undefined,
        )
        : client.listAllFiles({}, {
          type: "branch",
          name: ctx?.branch ?? "main",
        }),
    `getAllFilesRaw (${operationLabel})`,
  );

  const currentSnapshotVersion = contextProvider?.getSourceSnapshotVersion?.();
  const currentSnapshotIdentity = contextProvider?.getSourceSnapshotIdentity?.();
  const snapshotChanged = snapshotVersion !== undefined && currentSnapshotVersion !== undefined &&
    snapshotVersion !== currentSnapshotVersion &&
    (snapshotIdentity === undefined || currentSnapshotIdentity === undefined ||
      snapshotIdentity === currentSnapshotIdentity);
  const invalidated = contextProvider?.isPersistentCacheInvalidated?.(cacheKeyPrefix) ?? false;
  const invalidatedDuringFetch = !skipPersistentCache && invalidated;
  if (snapshotChanged || invalidatedDuringFetch) {
    logger.debug("getAllFilesRaw - discarding fallback fetch across snapshot change", {
      cacheKey,
      snapshotVersion,
      currentSnapshotVersion,
      invalidated,
    });
    if (snapshotRetryCount < MAX_SNAPSHOT_RETRIES) {
      return await loadAllProjectFiles({
        client,
        cache,
        contextProvider,
        logger,
        operationLabel,
        contentContext: ctx,
        snapshotRetryCount: snapshotRetryCount + 1,
      });
    }
    logger.warn("getAllFilesRaw - snapshot kept changing, returning uncached API result", {
      cacheKey,
      snapshotRetryCount,
    });
    return files;
  }

  if (!skipPersistentCache) cache.set(cacheKey, files);
  return files;
}
