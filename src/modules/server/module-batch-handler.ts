/**
 * Module Batch Handler
 *
 * Coalesces multiple module requests into a single HTTP response.
 * This dramatically reduces HTTP overhead from 232 requests to ~5-10 batch requests.
 *
 * Endpoint: /_vf_modules/_batch
 *
 * Query params:
 * - paths: Comma-separated module paths (e.g., "pages/index.js,layouts/MainLayout.js")
 * - project: Project slug (optional, inferred from host)
 *
 * Response format:
 * A JavaScript module that re-exports all requested modules.
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
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createSecureFs } from "#veryfront/security";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import {
  resolveSSRImportTargetModulePath,
  type SSRImportRewriteTarget,
  stripSSRModuleJsExtension,
} from "./ssr-import-rewriter.ts";
import { transformModuleToServable } from "./module-transform.ts";
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

const logger = serverLogger.component("module-batch");

/** Slow request threshold in milliseconds */

const SLOW_REQUEST_THRESHOLD_MS = 500;
/** Slow module transform threshold in milliseconds */
const SLOW_TRANSFORM_THRESHOLD_MS = 100;

/** Max entries in the per-project transform LRU cache */
const TRANSFORM_CACHE_MAX_ENTRIES = 1_000;

/** Immutable cache max-age in seconds (1 year) */
const IMMUTABLE_CACHE_MAX_AGE_SECONDS = 31_536_000;

/** Cache for transformed modules (path -> code) */
const transformCache = new LRUCache<string, string>({
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
  const results = await Promise.all(paths.map(async (path) => {
    try {
      const stat = await secureFs.stat(path);
      return stat.isFile ? path : null;
    } catch {
      return null;
    }
  }));

  return results.find((path): path is string => path !== null) ?? null;
}

async function findFirstPlatformFile(
  platformFs: ReturnType<typeof createFileSystem>,
  paths: string[],
): Promise<string | null> {
  const results = await Promise.all(paths.map(async (path) => {
    try {
      const stat = await platformFs.stat(path);
      return stat.isFile ? path : null;
    } catch {
      return null;
    }
  }));

  return results.find((path): path is string => path !== null) ?? null;
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

/**
 * Handle a batch module request
 */
export function handleModuleBatch(req: Request, options: BatchHandlerOptions): Promise<Response> {
  const url = new URL(req.url);
  const pathsParam = url.searchParams.get("paths");

  return withSpan(
    "module.batch.handleModuleBatch",
    async () => {
      const startTime = performance.now();

      if (!pathsParam) {
        return new Response("Missing 'paths' parameter", {
          status: HTTP_BAD_REQUEST,
          headers: { "Content-Type": "text/plain" },
        });
      }

      const paths = pathsParam
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);

      if (paths.length === 0) {
        return new Response("No valid paths provided", {
          status: HTTP_BAD_REQUEST,
          headers: { "Content-Type": "text/plain" },
        });
      }

      if (paths.length > MAX_BATCH_SIZE) {
        return new Response(`Too many modules (max: ${MAX_BATCH_SIZE})`, {
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

      const projectKey = projectId || projectSlug || "default";

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
        projectSlug,
      });

      const results = await Promise.all(
        paths.map(async (modulePath) => {
          const moduleStart = performance.now();
          const cacheKey = buildModuleTransformCacheKey(projectKey, modulePath, isSSR);

          if (!dev) {
            const cachedCode = transformCache.get(cacheKey);
            if (cachedCode != null) {
              return {
                path: modulePath,
                code: cachedCode,
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

            if (!dev) transformCache.set(cacheKey, code);

            return { path: modulePath, code, cached: false, transformDurationMs };
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const transformDurationMs = performance.now() - moduleStart;

            logger.warn("Module transform failed", {
              path: modulePath,
              error: errorMsg,
              durationMs: Math.round(transformDurationMs),
            });

            return { path: modulePath, code: null, error: errorMsg, transformDurationMs };
          }
        }),
      );

      const successes = results.filter((r): r is typeof r & { code: string } => r.code !== null);
      const failures = results.filter((r) => r.code === null);

      if (successes.length === 0) {
        return new Response("No modules could be loaded", {
          status: HTTP_NOT_FOUND,
          headers: { "Content-Type": "text/plain" },
        });
      }

      const bundleStream = createBatchBundleStream(successes, failures);

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
        projectSlug,
      });

      const slowModules = results.filter((r) =>
        r.transformDurationMs > SLOW_TRANSFORM_THRESHOLD_MS
      );
      if (slowModules.length > 0) {
        logger.warn("Slow module transforms detected", {
          count: slowModules.length,
          modules: slowModules.map((m) => ({
            path: m.path,
            durationMs: m.transformDurationMs,
          })),
        });
      }

      return new Response(bundleStream, {
        status: HTTP_OK,
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": `public, max-age=${IMMUTABLE_CACHE_MAX_AGE_SECONDS}, immutable`,
          "X-Batch-Modules": String(successes.length),
          "X-Batch-Duration": String(Math.round(duration)),
          "X-Batch-Slow": isSlow ? "true" : "false",
        },
      });
    },
    {
      "module.batch.moduleCount": pathsParam?.split(",").length ?? 0,
      "module.batch.projectSlug": options.projectSlug || "unknown",
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
    const source = await secureFs.readFile(sourcePath);
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
      const source = await platformFs.readTextFile(frameworkPath);
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
  return transformModuleToServable({
    source,
    sourceFile,
    projectDir,
    adapter,
    transformOpts: {
      projectId: options.projectId ?? projectDir,
      dev: options.dev,
      ssr: options.ssr,
      reactVersion: options.reactVersion,
    },
    isSSR: options.ssr,
    ssrRewriteOptions: {
      projectSlug: options.projectSlug,
      branch: options.branch,
      resolveCacheBuster: createBatchSSRTargetCacheBusterResolver({
        projectDir,
        secureFs,
        currentModulePath: modulePath,
      }),
    },
    // No releaseRewriteOptions: the batch handler does not rewrite release
    // dependency imports on the non-SSR path (intentional difference vs
    // the module-server paths — reported in module-transform.ts JSDoc).
  });
}

async function readBatchTargetSource(
  projectDir: string,
  secureFs: ReturnType<typeof createSecureFs>,
  modulePath: string,
): Promise<{ path: string; source: string } | null> {
  const basePath = stripSSRModuleJsExtension(modulePath);

  for (const ext of EXTENSIONS) {
    const fullPath = join(projectDir, basePath + ext);
    try {
      const stat = await secureFs.stat(fullPath);
      if (!stat.isFile) continue;

      return {
        path: fullPath,
        source: await secureFs.readFile(fullPath),
      };
    } catch (_) {
      /* expected: file may not exist at this extension */
    }
  }

  if (!basePath.startsWith("lib/")) return null;

  const frameworkLookupDirs = getFrameworkSourceLookupDirs();
  const platformFs = createFileSystem();
  for (const lookupDir of frameworkLookupDirs) {
    for (const ext of FRAMEWORK_EXTENSIONS) {
      const frameworkPath = join(lookupDir, basePath + ext);
      try {
        const stat = await platformFs.stat(frameworkPath);
        if (!stat.isFile) continue;

        return {
          path: frameworkPath,
          source: await platformFs.readTextFile(frameworkPath),
        };
      } catch (_) {
        /* expected: framework file may not exist at this extension */
      }
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
  successes: Array<{ path: string; code: string; cached: boolean }>,
  failures: Array<{ path: string; error: string }>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let isFirstChunk = true;

      for (const chunk of generateBatchBundleChunks(successes, failures)) {
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
  successes: Array<{ path: string; code: string; cached: boolean }>,
  failures: Array<{ path: string; error: string }>,
): IterableIterator<string> {
  yield "// Veryfront Module Batch Bundle";
  yield "// Generated: " + new Date().toISOString();
  yield `// Modules: ${successes.length} loaded, ${failures.length} failed`;
  yield "";
  yield "const __vf_batch_modules = new Map();";
  yield "";

  for (let i = 0; i < successes.length; i++) {
    const item = successes[i];
    if (!item) continue;
    const { path, code } = item;
    const varName = `__mod_${i}`;

    yield `// Module: ${path}`;
    yield `const ${varName} = await (async () => {`;
    yield "  const exports = {};";
    yield "  const module = { exports };";
    yield "  // --- Module code start ---";
    yield transformExportsForBundle(code);
    yield "  // --- Module code end ---";
    yield "  return exports;";
    yield "})();";
    yield `__vf_batch_modules.set("${path}", ${varName});`;
    yield "";
  }

  for (const { path, error } of failures) {
    yield `// Failed: ${path} - ${error}`;
    yield `__vf_batch_modules.set("${path}", { __vf_error: "${error}" });`;
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
 * Transform module code for inclusion in batch bundle
 * Converts ES module syntax to work within the bundle wrapper
 */
function transformExportsForBundle(code: string): string {
  // Indent every line by two spaces. A single regex avoids allocating an
  // intermediate array of lines per module on the batch hot path.
  return code.replace(/^/gm, "  ");
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

  const prefix = `${projectSlug}:`;
  for (const key of [...transformCache.keys()]) {
    if (key.startsWith(prefix)) transformCache.delete(key);
  }
  logger.debug("Cleared cache for project", { projectSlug });
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
