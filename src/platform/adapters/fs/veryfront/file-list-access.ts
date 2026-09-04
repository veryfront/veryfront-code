import type { ProjectFile, VeryfrontApiClient } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import { buildFileCacheKeyPrefix, buildFileListCacheKey } from "./cache-keys.ts";
import { withRetryOnTransient } from "./retry.ts";
import type { ResolvedContentContext } from "./types.ts";

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
  const cacheKeyPrefix = buildFileCacheKeyPrefix(ctx);
  const skipPersistentCache = contextProvider?.isPersistentCacheInvalidated?.(cacheKeyPrefix) ??
    false;

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
  const snapshotChanged = snapshotVersion !== undefined && currentSnapshotVersion !== undefined &&
    snapshotVersion !== currentSnapshotVersion;
  const invalidated = contextProvider?.isPersistentCacheInvalidated?.(cacheKeyPrefix) ?? false;
  const invalidatedDuringFetch = !skipPersistentCache && invalidated;
  if (snapshotChanged || invalidatedDuringFetch) {
    logger.debug("getAllFilesRaw - discarding fallback fetch across snapshot change", {
      cacheKey,
      snapshotVersion,
      currentSnapshotVersion,
      invalidated,
    });
    if (snapshotRetryCount === 0) {
      return await loadAllProjectFiles({
        client,
        cache,
        contextProvider,
        logger,
        operationLabel,
        contentContext: ctx,
        snapshotRetryCount: 1,
      });
    }
    throw new Error("Project file snapshot changed while its file list was loading");
  }

  if (!skipPersistentCache) cache.set(cacheKey, files);
  return files;
}
