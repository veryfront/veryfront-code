import { getApiBaseUrlEnv } from "#veryfront/config/env.ts";
import { CACHE_ERROR, NETWORK_ERROR } from "#veryfront/errors";
import { type FileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { injectContext } from "#veryfront/observability/tracing/otlp-setup.ts";
import { transformToESM } from "#veryfront/transforms/esm/index.ts";
import type { CrossProjectImport } from "#veryfront/transforms/esm/import-parser.ts";
import type { TransformOptions } from "#veryfront/transforms/esm/types.ts";
import { HTTP_FETCH_TIMEOUT_MS } from "#veryfront/utils/constants/http.ts";
import { writeCacheFile } from "#veryfront/utils/cache-file-ops.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { globalCrossProjectCache, globalCrossProjectInProgress } from "./cache/index.ts";
import type { SSRModuleLoaderOptions } from "./types.ts";
import { readLimitedCrossProjectSource } from "#veryfront/modules/server/cross-project-source-limit.ts";
import { buildCrossProjectImportCacheKey } from "./cross-project-cache-key.ts";
import {
  assertCrossProjectReference,
  buildCrossProjectRegistryUrl,
  normalizeCrossProjectModulePath,
  normalizeCrossProjectRegistryBaseUrl,
} from "#veryfront/modules/loader-shared/cross-project-request.ts";

export { buildCrossProjectImportCacheKey } from "./cross-project-cache-key.ts";

interface CrossProjectImportCache {
  hashContentAsync(content: string): Promise<string>;
  getTempPath(filePath: string, contentHash?: string): Promise<string>;
  getFs(): FileSystem;
}

interface TransformCrossProjectImportFlowOptions {
  crossProjectImport: CrossProjectImport;
  options: Pick<
    SSRModuleLoaderOptions,
    | "projectId"
    | "projectDir"
    | "dev"
    | "apiBaseUrl"
    | "moduleServerOrigin"
    | "reactVersion"
    | "dependencyPinningCacheKey"
    | "dependencyPinningDependencies"
    | "dependencyPinningSource"
    | "adapter"
    | "importMapIdentity"
  >;
  cache: CrossProjectImportCache;
  withTransformCapacity: <T>(
    syntheticFilePath: string,
    operation: () => Promise<T>,
  ) => Promise<T>;
  fetchImpl?: typeof fetch;
  transformToESMImpl?: typeof transformToESM;
  injectContextImpl?: typeof injectContext;
  loggerImpl?: Pick<typeof logger, "debug" | "error">;
  fetchTimeoutMs?: number;
}

const MAX_CROSS_PROJECT_IN_PROGRESS = 500;

function getRegistryBaseUrl(apiBaseUrl?: string): string {
  return normalizeCrossProjectRegistryBaseUrl(
    apiBaseUrl?.trim() || getApiBaseUrlEnv().trim(),
  );
}

async function getCachedTempPath(
  cacheKey: string,
  cache: CrossProjectImportCache,
): Promise<string | null> {
  const cachedEntry = globalCrossProjectCache.get(cacheKey);
  if (!cachedEntry) return null;

  try {
    const stat = await cache.getFs().stat(cachedEntry.tempPath);
    if (stat.isFile) return cachedEntry.tempPath;
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  globalCrossProjectCache.delete(cacheKey);
  return null;
}

export async function transformCrossProjectImportFlow(
  flowOptions: TransformCrossProjectImportFlowOptions,
): Promise<string> {
  const {
    crossProjectImport,
    options,
    cache,
    withTransformCapacity,
    fetchImpl = fetch,
    transformToESMImpl = transformToESM,
    injectContextImpl = injectContext,
    loggerImpl = logger,
    fetchTimeoutMs = HTTP_FETCH_TIMEOUT_MS,
  } = flowOptions;

  const { specifier, projectSlug, version } = crossProjectImport;
  assertCrossProjectReference(projectSlug, version);
  const path = normalizeCrossProjectModulePath(crossProjectImport.path, {
    percentEncoded: true,
  });
  const registryBaseUrl = getRegistryBaseUrl(options.apiBaseUrl);
  const cacheKey = buildCrossProjectImportCacheKey({
    specifier,
    projectId: options.projectId,
    reactVersion: options.reactVersion,
    registryBaseUrl,
    importMapFingerprint: options.importMapIdentity?.fingerprint,
    moduleServerOrigin: options.moduleServerOrigin,
    dependencyPinningCacheKey: options.dependencyPinningCacheKey,
    dependencyPinningDependencies: options.dependencyPinningDependencies,
    dependencyPinningSource: options.dependencyPinningSource,
  });

  const cacheable = version !== "latest";
  if (cacheable) {
    const cachedTempPath = await getCachedTempPath(cacheKey, cache);
    if (cachedTempPath) return cachedTempPath;
  }

  const projectRef = `${projectSlug}@${version}`;
  const registryUrl = buildCrossProjectRegistryUrl({
    registryBaseUrl,
    projectSlug,
    version,
    modulePath: path,
    includeLatestVersion: true,
  });

  const existingOperation = globalCrossProjectInProgress.get(cacheKey);
  if (existingOperation) return await existingOperation;
  if (globalCrossProjectInProgress.size >= MAX_CROSS_PROJECT_IN_PROGRESS) {
    throw CACHE_ERROR.create({
      detail: `Cross-project transform admission limit reached (${MAX_CROSS_PROJECT_IN_PROGRESS})`,
    });
  }

  loggerImpl.debug("[SSR-MODULE-LOADER] Fetching cross-project import", {
    specifier,
    registryUrl,
  });

  if (!Number.isFinite(fetchTimeoutMs) || fetchTimeoutMs <= 0) {
    throw new RangeError("Cross-project fetch timeout must be a positive finite number");
  }

  const operation: Promise<string> = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);

    try {
      const headers = new Headers({
        Accept: "text/plain, application/javascript, */*",
      });
      injectContextImpl(headers);

      const response = await fetchImpl(registryUrl, {
        signal: controller.signal,
        headers,
      });

      if (!response.ok) {
        throw NETWORK_ERROR.create({
          detail: `Failed to fetch ${registryUrl}: ${response.status} ${response.statusText}`,
        });
      }

      const sourceCode = await readLimitedCrossProjectSource(
        response,
        registryUrl,
      );
      const contentHash = await cache.hashContentAsync(sourceCode);

      const ext = path.match(/\.(tsx?|jsx?|mdx)$/)?.[0] ?? ".tsx";
      const syntheticFilePath = `cross-project/${projectRef}/@/${path}`;
      const tempPath = await cache.getTempPath(syntheticFilePath, contentHash);

      return await withTransformCapacity(syntheticFilePath, async () => {
        const projectId = options.projectId;
        const importMap = options.importMapIdentity?.importMap;
        const transformOpts: TransformOptions = {
          projectId,
          dev: options.dev,
          ssr: true,
          apiBaseUrl: options.apiBaseUrl,
          moduleServerOrigin: options.moduleServerOrigin,
          reactVersion: options.reactVersion,
          dependencyPinningCacheKey: options.dependencyPinningCacheKey,
          dependencyPinningDependencies: options.dependencyPinningDependencies,
          dependencyPinningSource: options.dependencyPinningSource,
          loadImportMap: importMap ? async () => importMap : undefined,
        };

        const filePathWithExt = syntheticFilePath.endsWith(ext)
          ? syntheticFilePath
          : syntheticFilePath + ext;

        const transformed = await transformToESMImpl(
          sourceCode,
          filePathWithExt,
          options.projectDir,
          options.adapter,
          transformOpts,
        );

        const written = await writeCacheFile(
          cache.getFs(),
          tempPath,
          transformed,
          "SSR-MODULE-LOADER",
        );
        if (!written) {
          throw CACHE_ERROR.create({
            detail: `Failed to write cross-project import cache file: ${tempPath}`,
          });
        }

        if (
          cacheable &&
          globalCrossProjectInProgress.get(cacheKey) === operation
        ) {
          globalCrossProjectCache.set(cacheKey, {
            tempPath,
            contentHash,
          });
        }

        loggerImpl.debug("[SSR-MODULE-LOADER] Cross-project import transformed", {
          specifier,
          tempPath,
        });

        return tempPath;
      });
    } catch (error) {
      loggerImpl.error("[SSR-MODULE-LOADER] Failed to fetch cross-project import", {
        specifier,
        registryUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  })();

  globalCrossProjectInProgress.set(cacheKey, operation);
  try {
    return await operation;
  } finally {
    if (globalCrossProjectInProgress.get(cacheKey) === operation) {
      globalCrossProjectInProgress.delete(cacheKey);
    }
  }
}
