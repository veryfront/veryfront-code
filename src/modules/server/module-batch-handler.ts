/**
 * Module Batch Handler
 *
 * Resolves multiple module requests and returns one ESM manifest module.
 *
 * Endpoint: /_vf_modules/_batch
 *
 * Query params:
 * - paths: Comma-separated module paths (e.g., "pages/index.js,layouts/MainLayout.js")
 * - project: Project slug (optional, inferred from host)
 *
 * Response format:
 * A JavaScript module that imports and indexes all requested modules.
 *
 * @module module-system/server/module-batch-handler
 */

import {
  HTTP_BAD_REQUEST,
  HTTP_NOT_FOUND,
  HTTP_OK,
  MAX_BATCH_SIZE,
  serverLogger,
} from "#veryfront/utils";
import { HTTP_METHOD_NOT_ALLOWED } from "#veryfront/utils/constants/http.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createSecureFs } from "#veryfront/security";
import { transformToESM } from "#veryfront/transforms/esm-transform.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import {
  applySSRImportRewritesAsync,
  resolveSSRImportTargetModulePath,
  type SSRImportRewriteTarget,
  stripSSRModuleJsExtension,
} from "./ssr-import-rewriter.ts";
import { buildModuleTransformCacheKey } from "#veryfront/cache/keys.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getFrameworkSourceLookupDirs } from "#veryfront/platform/compat/framework-source-resolver.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerLRUCache } from "#veryfront/cache";
import { sha256Short } from "#veryfront/cache/hash.ts";
import {
  buildSourceMissCacheKey,
  clearSourceMissCache,
  hasSourceMiss,
  rememberSourceMiss,
} from "./module-source-resolution-cache.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const logger = serverLogger.component("module-batch");

/** Slow request threshold in milliseconds */

const SLOW_REQUEST_THRESHOLD_MS = 500;
/** Slow module transform threshold in milliseconds */
const SLOW_TRANSFORM_THRESHOLD_MS = 100;

/** Max entries in the per-project transform LRU cache */
const TRANSFORM_CACHE_MAX_ENTRIES = 1_000;
const TRANSFORM_BATCH_CONCURRENCY = 10;
const MAX_BATCH_PATH_LENGTH = 2_048;
const MAX_PATHS_PARAMETER_LENGTH = 64 * 1024;
const MAX_MODULE_SOURCE_BYTES = 5 * 1024 * 1024;

/** Immutable cache max-age in seconds (1 year) */
const IMMUTABLE_CACHE_MAX_AGE_SECONDS = 31_536_000;

interface CachedTransform {
  code: string;
  version: string;
}

/** Cache for transformed immutable release modules. */
const transformCache = new LRUCache<string, CachedTransform>({
  maxEntries: TRANSFORM_CACHE_MAX_ENTRIES,
});

// Register cache for monitoring
registerLRUCache("module-batch-transform-cache", transformCache);

const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"] as const;

// Extensions including .src for compiled binary embedded sources
const FRAMEWORK_EXTENSIONS = [
  ".tsx.src",
  ".ts.src",
  ".jsx.src",
  ".js.src", // Embedded sources for compiled binaries
  ".tsx",
  ".ts",
  ".jsx",
  ".js", // Regular sources for dev mode
] as const;

async function findFirstSecureFile(
  secureFs: ReturnType<typeof createSecureFs>,
  paths: string[],
): Promise<string | null> {
  for (const path of paths) {
    try {
      const stat = await secureFs.stat(path);
      if (stat.isFile) return path;
    } catch {
      // Try the next supported source extension.
    }
  }
  return null;
}

async function findFirstPlatformFile(
  platformFs: ReturnType<typeof createFileSystem>,
  paths: string[],
): Promise<string | null> {
  for (const path of paths) {
    try {
      const stat = await platformFs.stat(path);
      if (stat.isFile) return path;
    } catch {
      // Try the next supported source extension.
    }
  }
  return null;
}

async function readBoundedSource(
  stat: () => Promise<{ isFile: boolean; size: number }>,
  read: () => Promise<string>,
): Promise<string> {
  const info = await stat();
  if (!info.isFile || info.size < 0 || info.size > MAX_MODULE_SOURCE_BYTES) {
    throw new Error("Module source exceeds the supported size");
  }
  const source = await read();
  if (new TextEncoder().encode(source).byteLength > MAX_MODULE_SOURCE_BYTES) {
    throw new Error("Module source exceeds the supported size");
  }
  return source;
}

export interface BatchHandlerOptions {
  projectDir: string;
  adapter: RuntimeAdapter;
  projectSlug?: string;
  projectId?: string;
  branch?: string | null;
  releaseId?: string | null;
  dev?: boolean;
  /**
   * Restrict module imports to specific directories (opt-in security).
   * When not set, users can import from any directory in the project.
   */
  allowedImportDirs?: string[];
  /** React version for transforms (from project config) */
  reactVersion?: string;
}

function isValidBatchModulePath(path: string): boolean {
  if (
    path.length === 0 || path.length > MAX_BATCH_PATH_LENGTH ||
    path.startsWith("/") || path.startsWith("\\") ||
    path.includes("\\") || path.includes("?") || path.includes("#") ||
    hasUnsafeControlCharacters(path) || /[\u2028\u2029]/.test(path)
  ) {
    return false;
  }

  const segments = path.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

async function mapInBatches<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let offset = 0; offset < items.length; offset += TRANSFORM_BATCH_CONCURRENCY) {
    const batch = items.slice(offset, offset + TRANSFORM_BATCH_CONCURRENCY);
    results.push(...await Promise.all(batch.map((item, index) => mapper(item, offset + index))));
  }
  return results;
}

function createBatchResponse(
  method: string,
  body: BodyInit | null,
  init: ResponseInit,
): Response {
  return new Response(method === "HEAD" ? null : body, init);
}

/**
 * Handle a batch module request
 */
export function handleModuleBatch(req: Request, options: BatchHandlerOptions): Promise<Response> {
  const url = new URL(req.url);
  const pathsParam = url.searchParams.get("paths");
  const method = req.method.toUpperCase();

  return withSpan(
    "module.batch.handleModuleBatch",
    async () => {
      const startTime = performance.now();

      if (method !== "GET" && method !== "HEAD") {
        return createBatchResponse(method, "Method not allowed", {
          status: HTTP_METHOD_NOT_ALLOWED,
          headers: {
            "Allow": "GET, HEAD",
            "Content-Type": "text/plain",
          },
        });
      }

      if (!pathsParam) {
        return createBatchResponse(method, "Missing 'paths' parameter", {
          status: HTTP_BAD_REQUEST,
          headers: { "Content-Type": "text/plain" },
        });
      }

      if (pathsParam.length > MAX_PATHS_PARAMETER_LENGTH) {
        return createBatchResponse(method, "Paths parameter is too large", {
          status: HTTP_BAD_REQUEST,
          headers: { "Content-Type": "text/plain" },
        });
      }

      const parsedPaths = pathsParam
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      const paths = [...new Set(parsedPaths)];

      if (paths.length === 0) {
        return createBatchResponse(method, "No valid paths provided", {
          status: HTTP_BAD_REQUEST,
          headers: { "Content-Type": "text/plain" },
        });
      }

      if (paths.length > MAX_BATCH_SIZE) {
        return createBatchResponse(method, `Too many modules (max: ${MAX_BATCH_SIZE})`, {
          status: HTTP_BAD_REQUEST,
          headers: { "Content-Type": "text/plain" },
        });
      }

      if (paths.some((path) => !isValidBatchModulePath(path))) {
        return createBatchResponse(method, "Invalid module path", {
          status: HTTP_BAD_REQUEST,
          headers: { "Content-Type": "text/plain" },
        });
      }

      const {
        projectDir,
        adapter,
        projectSlug,
        projectId,
        branch,
        releaseId,
        dev = false,
        allowedImportDirs,
        reactVersion,
      } = options;

      const projectKey = projectId || projectSlug || projectDir;

      const userAgent = req.headers.get("user-agent") ?? "";
      const isSSR = url.searchParams.get("ssr") === "true" || userAgent.startsWith("Deno/");

      const secureFs = createSecureFs({
        baseDir: projectDir,
        adapter,
        context: "module-loading",
        contextOptions: { allowedImportDirs },
        throwOnError: false,
      });

      logger.debug("Processing batch request", {
        moduleCount: paths.length,
        isSSR,
      });

      const canCacheTransforms = !dev && typeof releaseId === "string" && releaseId.length > 0;
      const results = await mapInBatches(
        paths,
        async (modulePath, moduleIndex) => {
          const moduleStart = performance.now();
          const moduleIdentity = JSON.stringify([releaseId, reactVersion, modulePath]);
          const cacheKey = buildModuleTransformCacheKey(projectKey, moduleIdentity, isSSR);

          if (canCacheTransforms) {
            const cachedTransform = transformCache.get(cacheKey);
            if (cachedTransform != null) {
              return {
                path: modulePath,
                code: cachedTransform.code,
                version: cachedTransform.version,
                cached: true,
                transformDurationMs: 0,
              };
            }
          }

          try {
            const code = await loadAndTransformModule(modulePath, projectDir, adapter, secureFs, {
              dev,
              ssr: isSSR,
              projectSlug,
              branch,
              projectId,
              releaseId,
              reactVersion,
            });

            const transformDurationMs = performance.now() - moduleStart;

            if (!code) {
              return { path: modulePath, code: null, error: "Not found", transformDurationMs };
            }

            const version = await sha256Short(code);
            if (canCacheTransforms) transformCache.set(cacheKey, { code, version });

            return { path: modulePath, code, version, cached: false, transformDurationMs };
          } catch (error) {
            const transformDurationMs = performance.now() - moduleStart;

            logger.warn("Module transform failed", {
              moduleIndex,
              errorName: error instanceof Error ? error.name : "UnknownError",
              durationMs: Math.round(transformDurationMs),
            });

            return {
              path: modulePath,
              code: null,
              error: "Transform failed",
              transformDurationMs,
            };
          }
        },
      );

      const successes = results.filter((r): r is typeof r & { code: string } => r.code !== null);
      const failures = results.filter((r) => r.code === null);

      if (successes.length === 0) {
        return createBatchResponse(method, "No modules could be loaded", {
          status: HTTP_NOT_FOUND,
          headers: { "Content-Type": "text/plain" },
        });
      }

      const bundleStream = method === "HEAD" ? null : createBatchBundleStream(successes, failures, {
        isSSR,
        projectSlug,
        branch,
      });

      const duration = performance.now() - startTime;
      const isSlow = duration > SLOW_REQUEST_THRESHOLD_MS;

      const logMethod = isSlow ? logger.warn.bind(logger) : logger.info.bind(logger);
      logMethod("[ModuleBatch] Batch complete", {
        totalPaths: paths.length,
        successes: successes.length,
        failures: failures.length,
        cached: successes.filter((r) => r.cached).length,
        durationMs: Math.round(duration),
        slow: isSlow,
      });

      const slowModules = results.filter((r) =>
        r.transformDurationMs > SLOW_TRANSFORM_THRESHOLD_MS
      );
      if (slowModules.length > 0) {
        logger.warn("Slow module transforms detected", {
          count: slowModules.length,
          durationsMs: slowModules.map((module) => Math.round(module.transformDurationMs)),
        });
      }

      return createBatchResponse(method, bundleStream, {
        status: HTTP_OK,
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": dev
            ? "no-store"
            : releaseId
            ? `public, max-age=${IMMUTABLE_CACHE_MAX_AGE_SECONDS}, immutable`
            : "no-cache",
          "X-Batch-Modules": String(successes.length),
          "X-Batch-Duration": String(Math.round(duration)),
          "X-Batch-Slow": isSlow ? "true" : "false",
        },
      });
    },
    {
      "module.batch.moduleCount": pathsParam?.split(",").length ?? 0,
    },
  );
}

/**
 * Load and transform a single module
 */
async function loadAndTransformModule(
  modulePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  secureFs: ReturnType<typeof createSecureFs>,
  options: {
    dev: boolean;
    ssr: boolean;
    projectSlug?: string;
    branch?: string | null;
    projectId?: string;
    releaseId?: string | null;
    reactVersion?: string;
  },
): Promise<string | null> {
  const basePath = modulePath.replace(/\.js$/, "");
  const missCacheKey = buildSourceMissCacheKey({
    resolver: "module-batch",
    projectDir,
    projectId: options.projectId,
    projectSlug: options.projectSlug,
    branch: options.branch,
    releaseId: options.releaseId,
    basePath,
    reactVersion: options.reactVersion,
  });
  if (hasSourceMiss(missCacheKey)) return null;

  const sourcePath = await findFirstSecureFile(
    secureFs,
    EXTENSIONS.map((ext) => join(projectDir, basePath + ext)),
  );
  if (sourcePath) {
    const source = await readBoundedSource(
      () => secureFs.stat(sourcePath),
      () => secureFs.readFile(sourcePath),
    );
    return transformModule(source, sourcePath, modulePath, projectDir, adapter, secureFs, options);
  }

  if (!basePath.startsWith("lib/")) {
    rememberSourceMiss(missCacheKey);
    return null;
  }

  const frameworkLookupDirs = getFrameworkSourceLookupDirs();

  const platformFs = createFileSystem();
  for (const lookupDir of frameworkLookupDirs) {
    const frameworkPath = await findFirstPlatformFile(
      platformFs,
      FRAMEWORK_EXTENSIONS.map((ext) => join(lookupDir, basePath + ext)),
    );
    if (frameworkPath) {
      const source = await readBoundedSource(
        () => platformFs.stat(frameworkPath),
        () => platformFs.readTextFile(frameworkPath),
      );
      return transformModule(
        source,
        frameworkPath,
        modulePath,
        projectDir,
        adapter,
        secureFs,
        options,
      );
    }
  }

  rememberSourceMiss(missCacheKey);
  return null;
}

async function transformModule(
  source: string,
  sourceFile: string,
  modulePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  secureFs: ReturnType<typeof createSecureFs>,
  options: {
    dev: boolean;
    ssr: boolean;
    projectSlug?: string;
    branch?: string | null;
    projectId?: string;
    reactVersion?: string;
  },
): Promise<string> {
  let code = await transformToESM(source, sourceFile, projectDir, adapter, {
    projectId: options.projectId ?? projectDir,
    dev: options.dev,
    ssr: options.ssr,
    reactVersion: options.reactVersion,
  });

  if (options.ssr) {
    code = await applySSRImportRewritesAsync(code, {
      projectSlug: options.projectSlug,
      branch: options.branch,
      resolveCacheBuster: createBatchSSRTargetCacheBusterResolver({
        projectDir,
        secureFs,
        currentModulePath: modulePath,
      }),
    });
  }

  return code;
}

async function readBatchTargetSource(
  projectDir: string,
  secureFs: ReturnType<typeof createSecureFs>,
  modulePath: string,
): Promise<{ path: string; source: string } | null> {
  const basePath = stripSSRModuleJsExtension(modulePath);

  for (const ext of EXTENSIONS) {
    const fullPath = join(projectDir, basePath + ext);
    let stat: Awaited<ReturnType<typeof secureFs.stat>>;
    try {
      stat = await secureFs.stat(fullPath);
    } catch (_) {
      /* expected: file may not exist at this extension */
      continue;
    }
    if (!stat.isFile) continue;

    return {
      path: fullPath,
      source: await readBoundedSource(
        () => secureFs.stat(fullPath),
        () => secureFs.readFile(fullPath),
      ),
    };
  }

  if (!basePath.startsWith("lib/")) return null;

  const frameworkLookupDirs = getFrameworkSourceLookupDirs();
  const platformFs = createFileSystem();
  for (const lookupDir of frameworkLookupDirs) {
    for (const ext of FRAMEWORK_EXTENSIONS) {
      const frameworkPath = join(lookupDir, basePath + ext);
      let stat: Awaited<ReturnType<typeof platformFs.stat>>;
      try {
        stat = await platformFs.stat(frameworkPath);
      } catch (_) {
        /* expected: framework file may not exist at this extension */
        continue;
      }
      if (!stat.isFile) continue;

      return {
        path: frameworkPath,
        source: await readBoundedSource(
          () => platformFs.stat(frameworkPath),
          () => platformFs.readTextFile(frameworkPath),
        ),
      };
    }
  }

  return null;
}

function createBatchSSRTargetCacheBusterResolver(options: {
  projectDir: string;
  secureFs: ReturnType<typeof createSecureFs>;
  currentModulePath: string;
}): (target: SSRImportRewriteTarget) => Promise<string | undefined> {
  const versions = new Map<string, Promise<string | undefined>>();

  return (target) => {
    const targetPath = resolveSSRImportTargetModulePath(target, options.currentModulePath);
    let promise = versions.get(targetPath);
    if (!promise) {
      promise = (async () => {
        const resolved = await readBatchTargetSource(
          options.projectDir,
          options.secureFs,
          targetPath,
        );
        if (!resolved) return undefined;
        return await sha256Short(`${resolved.path}\0${resolved.source}`);
      })();
      versions.set(targetPath, promise);
    }
    return promise;
  };
}

function createBatchBundleStream(
  successes: Array<{ path: string; code: string; version: string; cached: boolean }>,
  failures: Array<{ path: string; error: string }>,
  options: { isSSR: boolean; projectSlug?: string; branch?: string | null },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let isFirstChunk = true;

      for (const chunk of generateBatchBundleChunks(successes, failures, options)) {
        if (!isFirstChunk) controller.enqueue(encoder.encode("\n"));
        controller.enqueue(encoder.encode(chunk));
        isFirstChunk = false;
      }

      controller.close();
    },
  });
}

/**
 * Generate the batch bundle code chunks.
 * Creates a module that exports all loaded modules by path.
 */
function* generateBatchBundleChunks(
  successes: Array<{ path: string; code: string; version: string; cached: boolean }>,
  failures: Array<{ path: string; error: string }>,
  options: { isSSR: boolean; projectSlug?: string; branch?: string | null },
): IterableIterator<string> {
  yield "// Veryfront Module Batch Bundle";
  yield `// Modules: ${successes.length} loaded, ${failures.length} failed`;
  yield "";

  for (let i = 0; i < successes.length; i++) {
    const item = successes[i];
    if (!item) continue;
    const encodedPath = item.path.split("/").map(encodeURIComponent).join("/");
    const search = new URLSearchParams();
    if (options.isSSR) search.set("ssr", "true");
    if (options.projectSlug) search.set("project", options.projectSlug);
    if (options.branch) search.set("branch", options.branch);
    search.set("v", item.version);
    yield `import * as __mod_${i} from ${JSON.stringify(`/_vf_modules/${encodedPath}?${search}`)};`;
  }

  yield "";
  yield "const __vf_batch_modules = new Map();";
  yield "";

  for (let i = 0; i < successes.length; i++) {
    const item = successes[i];
    if (!item) continue;
    yield `__vf_batch_modules.set(${JSON.stringify(item.path)}, __mod_${i});`;
  }

  for (const { path } of failures) {
    yield `// Failed: ${path}`;
    yield `__vf_batch_modules.set(${JSON.stringify(path)}, { __vf_error: "Module unavailable" });`;
  }

  yield "";
  yield "export const batchModules = __vf_batch_modules;";
  yield "";
  yield "export function getModule(path) {";
  yield "  return __vf_batch_modules.get(path);";
  yield "}";
  yield "";
  yield "export default { batchModules, getModule };";
}

/**
 * Clear the transform cache (on deployment or memory pressure)
 */
export function clearBatchCache(projectSlug?: string): void {
  clearSourceMissCache("module-batch");

  if (!projectSlug) {
    transformCache.clear();
    logger.debug("Cleared all cache");
    return;
  }

  const sampleKey = buildModuleTransformCacheKey(projectSlug, "_", false);
  const prefix = sampleKey.slice(0, sampleKey.indexOf(":") + 1);
  for (const key of [...transformCache.keys()]) {
    if (key.startsWith(prefix)) transformCache.delete(key);
  }
  logger.debug("Cleared cache for project");
}

/**
 * Get cache statistics
 */
export function getBatchCacheStats(): { size: number; keys: string[] } {
  return {
    size: transformCache.size,
    keys: [...transformCache.keys()],
  };
}
