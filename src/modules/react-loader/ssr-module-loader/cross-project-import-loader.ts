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
    | "reactVersion"
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

const MAX_CROSS_PROJECT_PATH_LENGTH = 4_096;
const MAX_CROSS_PROJECT_IN_PROGRESS = 500;

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function getRegistryBaseUrl(apiBaseUrl?: string): string {
  const resolvedApiBaseUrl = apiBaseUrl?.trim() || getApiBaseUrlEnv().trim();
  let url: URL;
  try {
    url = new URL(resolvedApiBaseUrl);
  } catch {
    throw new TypeError("Cross-project registry base URL must be an absolute URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("Cross-project registry base URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new TypeError("Cross-project registry base URL must not contain credentials");
  }
  if (url.search || url.hash) {
    throw new TypeError("Cross-project registry base URL must not contain a query or fragment");
  }

  let pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/api")) pathname = pathname.slice(0, -4);
  return `${url.origin}${pathname}`;
}

function normalizeCrossProjectPath(path: string): string {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > MAX_CROSS_PROJECT_PATH_LENGTH
  ) {
    throw new RangeError(
      `Cross-project module path must contain 1 to ${MAX_CROSS_PROJECT_PATH_LENGTH} characters`,
    );
  }
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    containsControlCharacter(path)
  ) {
    throw new TypeError("Cross-project module path must be a plain project-relative path");
  }

  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0)) {
    throw new TypeError("Cross-project module path must not contain empty segments");
  }

  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new TypeError("Cross-project module path contains malformed percent encoding");
    }
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      decoded.includes("?") ||
      decoded.includes("#") ||
      containsControlCharacter(decoded)
    ) {
      throw new TypeError("Cross-project module path contains an unsafe segment");
    }
  }

  return segments.join("/");
}

function assertCrossProjectReference(
  projectSlug: string,
  version: string,
): void {
  if (!/^[a-z0-9-]{1,128}$/.test(projectSlug)) {
    throw new TypeError("Cross-project project slug is invalid");
  }
  if (
    version !== "latest" &&
    !/^[\d^~x][\d.x^~-]{0,127}$/.test(version)
  ) {
    throw new TypeError("Cross-project project version is invalid");
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
  const path = normalizeCrossProjectPath(crossProjectImport.path);
  const registryBaseUrl = getRegistryBaseUrl(options.apiBaseUrl);
  const cacheKey = buildCrossProjectImportCacheKey({
    specifier,
    projectId: options.projectId,
    reactVersion: options.reactVersion,
    registryBaseUrl,
    importMapFingerprint: options.importMapIdentity?.fingerprint,
  });

  const cacheable = version !== "latest";
  if (cacheable) {
    const cachedTempPath = await getCachedTempPath(cacheKey, cache);
    if (cachedTempPath) return cachedTempPath;
  }

  const projectRef = `${projectSlug}@${version}`;
  const registryUrl = buildRegistryUrl(
    registryBaseUrl,
    projectSlug,
    version,
    path,
  );

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
          reactVersion: options.reactVersion,
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
