import type { ProjectFile, VeryfrontApiClient } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import { buildFileCacheKeyPrefix, buildFileListCacheKey } from "./cache-keys.ts";
import { withRetryOnTransient } from "./retry.ts";
import type { ResolvedContentContext } from "./types.ts";

export interface ContentContextProvider {
  isProductionMode: () => boolean;
  getReleaseId: () => string | null;
  getContentContext: () => ResolvedContentContext | null;
  getFileList?: () => Promise<
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
}

export async function loadAllProjectFiles({
  client,
  cache,
  contextProvider,
  logger,
  operationLabel,
}: LoadAllProjectFilesOptions): Promise<ProjectFile[]> {
  const cacheStart = performance.now();
  const ctx = contextProvider?.getContentContext();
  const cacheKeyPrefix = buildFileCacheKeyPrefix(ctx);
  const skipPersistentCache = contextProvider?.isPersistentCacheInvalidated?.(cacheKeyPrefix) ??
    false;

  const adapterFiles = !skipPersistentCache ? await contextProvider?.getFileList?.() : undefined;

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
    logger.debug("getAllFilesRaw - skipping persistent cache");
  }

  const cached = skipPersistentCache ? undefined : await cache.getAsync<ProjectFile[]>(cacheKey);
  const cacheMs = Math.round(performance.now() - cacheStart);

  if (cached) {
    logger.debug("getAllFilesRaw - fallback cache HIT", {
      cacheMs,
      fileCount: cached.length,
    });
    return cached;
  }

  logger.warn("getAllFilesRaw - cache MISS, fetching from API", {
    cacheMs,
  });

  const isPublished = ctx?.sourceType !== "branch";
  logger.debug("Fetching files from API", {
    sourceType: ctx?.sourceType,
  });

  const files = await withRetryOnTransient(
    () =>
      isPublished
        ? client.listPublishedFiles(
          undefined,
          ctx?.releaseId ?? undefined,
          ctx?.environmentName ?? undefined,
        )
        : client.listAllFiles(),
    `getAllFilesRaw (${operationLabel})`,
  );

  cache.set(cacheKey, files);
  return files;
}
