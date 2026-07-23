import { getApiBaseUrlEnv } from "#veryfront/config/env.ts";
import { CACHE_ERROR, INVALID_ARGUMENT, NETWORK_ERROR, VeryfrontError } from "#veryfront/errors";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import { injectContext } from "#veryfront/observability/tracing/otlp-setup.ts";
import { transformToESM } from "#veryfront/transforms/esm/index.ts";
import type { CrossProjectImport } from "#veryfront/transforms/esm/import-parser.ts";
import type { TransformOptions } from "#veryfront/transforms/esm/types.ts";
import { HTTP_FETCH_TIMEOUT_MS } from "#veryfront/utils/constants/http.ts";
import { writeCacheFile } from "#veryfront/utils/cache-file-ops.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { globalCrossProjectCache, globalCrossProjectInProgress } from "./cache/index.ts";
import type { SSRModuleLoaderOptions } from "./types.ts";
import {
  CrossProjectSourceEncodingError,
  CrossProjectSourceTooLargeError,
  readLimitedCrossProjectSource,
} from "#veryfront/modules/server/cross-project-source-limit.ts";
import { buildSSRModuleCacheKey } from "#veryfront/cache/keys.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const MAX_CROSS_PROJECT_IN_PROGRESS = 500;
const MAX_CROSS_PROJECT_PATH_LENGTH = 4_096;

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
    | "reactVersion"
    | "adapter"
    | "signal"
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
  const resolved = apiBaseUrl || getApiBaseUrlEnv();
  let parsed: URL;
  try {
    parsed = new URL(resolved);
  } catch {
    throw INVALID_ARGUMENT.create({ detail: "Cross-project registry URL is invalid" });
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username !== "" || parsed.password !== "" ||
    parsed.search !== "" || parsed.hash !== ""
  ) {
    throw INVALID_ARGUMENT.create({ detail: "Cross-project registry URL is invalid" });
  }
  const basePath = parsed.pathname.replace(/\/api\/?$/, "").replace(/\/+$/, "");
  return `${parsed.origin}${basePath}`;
}

function validateCrossProjectImport(value: CrossProjectImport): void {
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/.test(value.projectSlug) ||
    !/^[0-9A-Za-z.^~_-]{1,128}$/.test(value.version) ||
    value.specifier.length === 0 || value.specifier.length > MAX_CROSS_PROJECT_PATH_LENGTH ||
    value.path.length === 0 || value.path.length > MAX_CROSS_PROJECT_PATH_LENGTH ||
    value.path.includes("\\") || value.path.includes("%") ||
    hasUnsafeControlCharacters(value.path) ||
    value.path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw INVALID_ARGUMENT.create({ detail: "Cross-project import identity is invalid" });
  }
}

function buildRegistryUrl(
  registryBaseUrl: string,
  projectSlug: string,
  version: string,
  path: string,
): string {
  const projectRef = `${encodeURIComponent(projectSlug)}@${encodeURIComponent(version)}`;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${registryBaseUrl}/${projectRef}/@/${encodedPath}`;
}

function isImmutableVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version);
}

/** Whether a cross-project failure represents an unavailable remote source. */
export function isCrossProjectUnavailableError(error: unknown): boolean {
  return error instanceof CrossProjectSourceTooLargeError ||
    error instanceof CrossProjectSourceEncodingError ||
    (error instanceof VeryfrontError && error.slug === NETWORK_ERROR.slug);
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

  validateCrossProjectImport(crossProjectImport);
  if (!Number.isSafeInteger(fetchTimeoutMs) || fetchTimeoutMs <= 0) {
    throw INVALID_ARGUMENT.create({ detail: "Cross-project fetch timeout is invalid" });
  }

  const { projectSlug, version, path } = crossProjectImport;
  const reactVersion = options.reactVersion ?? "default";
  const registryBaseUrl = getRegistryBaseUrl(options.apiBaseUrl);
  const transformMode = options.dev ? "development" : "production";
  const cacheKey = buildSSRModuleCacheKey(
    `cross-project-${reactVersion}-${transformMode}`,
    options.projectId,
    JSON.stringify([registryBaseUrl, projectSlug, version, path]),
  );
  const canPersistCacheEntry = isImmutableVersion(version);

  const cachedEntry = canPersistCacheEntry ? globalCrossProjectCache.get(cacheKey) : undefined;
  if (cachedEntry) {
    try {
      const info = await cache.getFs().stat(cachedEntry.tempPath);
      if (info.isFile) return cachedEntry.tempPath;
    } catch {
      // The cached temp file is local to a process and may have been removed.
    }
    globalCrossProjectCache.delete(cacheKey);
  }

  const inProgress = globalCrossProjectInProgress.get(cacheKey);
  if (inProgress) return await inProgress;
  if (globalCrossProjectInProgress.size >= MAX_CROSS_PROJECT_IN_PROGRESS) {
    throw CACHE_ERROR.create({ detail: "Cross-project module capacity exceeded" });
  }

  const operation = (async (): Promise<string> => {
    const projectRef = `${projectSlug}@${version}`;
    const registryUrl = buildRegistryUrl(registryBaseUrl, projectSlug, version, path);
    loggerImpl.debug("[SSR-MODULE-LOADER] Fetching cross-project import");

    try {
      const headers = new Headers({
        Accept: "text/plain, application/javascript, */*",
      });
      injectContextImpl(headers);

      const timeoutSignal = AbortSignal.timeout(fetchTimeoutMs);
      const signal = options.signal
        ? AbortSignal.any([options.signal, timeoutSignal])
        : timeoutSignal;
      const response = await fetchImpl(registryUrl, { signal, headers });
      if (!response.ok) {
        throw NETWORK_ERROR.create({
          detail: `Cross-project module request failed with status ${response.status}`,
        });
      }

      const sourceCode = await readLimitedCrossProjectSource(response, registryUrl);
      const contentHash = await cache.hashContentAsync(sourceCode);
      const ext = path.match(/\.(tsx?|jsx?|mdx)$/)?.[0] ?? ".tsx";
      const syntheticFilePath = `cross-project/${projectRef}/@/${path}`;
      const tempPath = await cache.getTempPath(syntheticFilePath, contentHash);

      const result = await withTransformCapacity(syntheticFilePath, async () => {
        const transformOpts: TransformOptions = {
          projectId: options.projectId,
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
        const written = await writeCacheFile(
          cache.getFs(),
          tempPath,
          transformed,
          "SSR-MODULE-LOADER",
        );
        if (!written) {
          throw CACHE_ERROR.create({ detail: "Cross-project module cache write failed" });
        }

        if (canPersistCacheEntry) {
          globalCrossProjectCache.set(cacheKey, { tempPath, contentHash });
        }
        return tempPath;
      });

      loggerImpl.debug("[SSR-MODULE-LOADER] Cross-project import transformed");
      return result;
    } catch (error) {
      loggerImpl.error("[SSR-MODULE-LOADER] Failed to load cross-project import", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      if (
        error instanceof CrossProjectSourceTooLargeError ||
        error instanceof CrossProjectSourceEncodingError
      ) {
        throw error;
      }
      if (error instanceof VeryfrontError) throw error;
      throw NETWORK_ERROR.create({ detail: "Cross-project module could not be loaded" });
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
