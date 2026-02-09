import { getApiBaseUrlEnv } from "#veryfront/config/env.ts";
import { injectContext } from "#veryfront/observability/tracing/otlp-setup.ts";
import { transformToESM } from "#veryfront/transforms/esm/index.ts";
import type { CrossProjectImport } from "#veryfront/transforms/esm/import-parser.ts";
import type { TransformOptions } from "#veryfront/transforms/esm/types.ts";
import { HTTP_FETCH_TIMEOUT_MS } from "#veryfront/utils/constants/http.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { globalCrossProjectCache } from "./cache/index.ts";
import type { SSRModuleLoaderOptions } from "./types.ts";

export interface CrossProjectImportCacheFs {
  mkdir(path: string, options: { recursive: boolean }): Promise<void>;
  writeTextFile(path: string, data: string): Promise<void>;
}

export interface CrossProjectImportCache {
  hashContentAsync(content: string): Promise<string>;
  getTempPath(filePath: string, contentHash?: string): Promise<string>;
  getFs(): CrossProjectImportCacheFs;
}

export interface TransformCrossProjectImportFlowOptions {
  crossProjectImport: CrossProjectImport;
  options: Pick<
    SSRModuleLoaderOptions,
    "projectId" | "projectDir" | "dev" | "apiBaseUrl" | "reactVersion" | "adapter"
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

function getRegistryBaseUrl(apiBaseUrl?: string): string {
  const resolvedApiBaseUrl = apiBaseUrl || getApiBaseUrlEnv();
  return resolvedApiBaseUrl.replace(/\/api\/?$/, "");
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

  const { specifier, projectSlug, version, path } = crossProjectImport;
  const reactVersion = options.reactVersion ?? "default";
  const cacheKey = `${specifier}:${options.projectId}:${reactVersion}`;

  const cachedEntry = globalCrossProjectCache.get(cacheKey);
  if (cachedEntry) return cachedEntry.tempPath;

  const registryBaseUrl = getRegistryBaseUrl(options.apiBaseUrl);
  const projectRef = `${projectSlug}@${version}`;
  const registryUrl = `${registryBaseUrl}/${projectRef}/@/${path}`;

  loggerImpl.debug("[SSR-MODULE-LOADER] Fetching cross-project import", {
    specifier,
    registryUrl,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);

  try {
    const headers = new Headers({
      Accept: "text/plain, application/javascript, */*",
    });
    injectContextImpl(headers);

    const response = await fetchImpl(registryUrl, { signal: controller.signal, headers });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${registryUrl}: ${response.status} ${response.statusText}`,
      );
    }

    const sourceCode = await response.text();
    const contentHash = await cache.hashContentAsync(sourceCode);

    const ext = path.match(/\.(tsx?|jsx?|mdx)$/)?.[0] ?? ".tsx";
    const syntheticFilePath = `cross-project/${projectRef}/@/${path}`;
    const tempPath = await cache.getTempPath(syntheticFilePath, contentHash);
    const fs = cache.getFs();
    await fs.mkdir(tempPath.substring(0, tempPath.lastIndexOf("/")), { recursive: true });

    return await withTransformCapacity(syntheticFilePath, async () => {
      const projectId = options.projectId;
      const transformOpts: TransformOptions = {
        projectId,
        dev: options.dev,
        ssr: true,
        apiBaseUrl: options.apiBaseUrl,
        reactVersion: options.reactVersion,
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

      await fs.writeTextFile(tempPath, transformed);

      globalCrossProjectCache.set(cacheKey, { tempPath, contentHash });

      loggerImpl.debug("[SSR-MODULE-LOADER] Cross-project import transformed", {
        specifier,
        tempPath,
      });

      return tempPath;
    });
  } catch (error) {
    clearTimeout(timeout);
    loggerImpl.error("[SSR-MODULE-LOADER] Failed to fetch cross-project import", {
      specifier,
      registryUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
