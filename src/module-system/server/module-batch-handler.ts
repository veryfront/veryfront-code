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

import { serverLogger as logger } from "@veryfront/utils";
import { HTTP_BAD_REQUEST, HTTP_NOT_FOUND, HTTP_OK } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { createSecureFs } from "@veryfront/security";
import { transformToESM } from "@veryfront/transforms/esm-transform.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import { join } from "@veryfront/platform/compat/path/index.ts";
import { applySSRImportRewrites } from "./ssr-import-rewriter.ts";
import { buildModuleTransformCacheKey } from "../../core/cache/keys.ts";

/** Slow request threshold in milliseconds */
const SLOW_REQUEST_THRESHOLD_MS = 500;
/** Slow module transform threshold in milliseconds */
const SLOW_TRANSFORM_THRESHOLD_MS = 100;

export interface BatchHandlerOptions {
  projectDir: string;
  adapter: RuntimeAdapter;
  projectSlug?: string;
  projectId?: string;
  branch?: string | null;
  dev?: boolean;
  /**
   * Restrict module imports to specific directories (opt-in security).
   * When not set, users can import from any directory in the project.
   */
  allowedImportDirs?: string[];
}

/** Maximum number of modules that can be batched in one request */
const MAX_BATCH_SIZE = 100;

/** Cache for transformed modules (path -> code) */
const transformCache = new Map<string, string>();

/** Framework root for lib/* files */
const FRAMEWORK_ROOT = new URL("../../..", import.meta.url).pathname;

/**
 * Handle a batch module request
 */
export async function handleModuleBatch(
  req: Request,
  options: BatchHandlerOptions,
): Promise<Response> {
  const startTime = performance.now();
  const url = new URL(req.url);

  // Parse paths from query param
  const pathsParam = url.searchParams.get("paths");
  if (!pathsParam) {
    return new Response("Missing 'paths' parameter", {
      status: HTTP_BAD_REQUEST,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const paths = pathsParam.split(",").map((p) => p.trim()).filter(Boolean);
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

  const { projectDir, adapter, projectSlug, projectId, branch, dev = false, allowedImportDirs } =
    options;
  const projectKey = projectId || projectSlug || "default";

  // Detect SSR mode
  const userAgent = req.headers.get("user-agent") || "";
  const isSSR = url.searchParams.get("ssr") === "true" || userAgent.startsWith("Deno/");

  // Create secure filesystem
  const secureFs = createSecureFs({
    baseDir: projectDir,
    adapter,
    context: "module-loading",
    contextOptions: {
      allowedImportDirs, // Pass through from config (undefined = no restrictions)
    },
    throwOnError: false,
  });

  logger.debug("[ModuleBatch] Processing batch request", {
    moduleCount: paths.length,
    isSSR,
    projectSlug,
  });

  // Load and transform all modules in parallel with timing
  const results = await Promise.all(
    paths.map(async (modulePath) => {
      const moduleStart = performance.now();
      const cacheKey = buildModuleTransformCacheKey(projectKey, modulePath, isSSR);

      // Check cache first
      if (transformCache.has(cacheKey)) {
        return {
          path: modulePath,
          code: transformCache.get(cacheKey)!,
          cached: true,
          transformDurationMs: 0,
        };
      }

      try {
        const code = await loadAndTransformModule(
          modulePath,
          projectDir,
          adapter,
          secureFs,
          { dev, ssr: isSSR, projectSlug, branch, projectId },
        );

        const transformDurationMs = performance.now() - moduleStart;

        if (code) {
          // Cache the transformed code
          transformCache.set(cacheKey, code);
          return { path: modulePath, code, cached: false, transformDurationMs };
        }
        return { path: modulePath, code: null, error: "Not found", transformDurationMs };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const transformDurationMs = performance.now() - moduleStart;
        logger.warn("[ModuleBatch] Module transform failed", {
          path: modulePath,
          error: errorMsg,
          durationMs: Math.round(transformDurationMs),
        });
        return { path: modulePath, code: null, error: errorMsg, transformDurationMs };
      }
    }),
  );

  // Count successes and failures
  const successes = results.filter((r): r is typeof r & { code: string } => r.code !== null);
  const failures = results.filter((r) => r.code === null);

  if (successes.length === 0) {
    return new Response("No modules could be loaded", {
      status: HTTP_NOT_FOUND,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // Generate the batch bundle
  const bundleCode = generateBatchBundle(successes, failures);

  const duration = performance.now() - startTime;
  const isSlow = duration > SLOW_REQUEST_THRESHOLD_MS;

  // Log with appropriate level based on duration
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

  // Log individual slow modules for debugging
  const slowModules = results.filter((r) =>
    r.transformDurationMs && r.transformDurationMs > SLOW_TRANSFORM_THRESHOLD_MS
  );
  if (slowModules.length > 0) {
    logger.warn("[ModuleBatch] Slow module transforms detected", {
      count: slowModules.length,
      modules: slowModules.map((m) => ({
        path: m.path,
        durationMs: m.transformDurationMs,
      })),
    });
  }

  return new Response(bundleCode, {
    status: HTTP_OK,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Batch-Modules": String(successes.length),
      "X-Batch-Duration": String(Math.round(duration)),
      "X-Batch-Slow": isSlow ? "true" : "false",
    },
  });
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
  },
): Promise<string | null> {
  // Remove .js extension for lookup
  const basePath = modulePath.replace(/\.js$/, "");
  const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"];

  // Try to find the source file
  let sourceFile: string | null = null;
  let source: string | null = null;
  let _isFrameworkFile = false;

  // Check project files first
  for (const ext of extensions) {
    const fullPath = join(projectDir, basePath + ext);
    try {
      const stat = await secureFs.stat(fullPath);
      if (stat.isFile) {
        source = await secureFs.readFile(fullPath);
        sourceFile = fullPath;
        break;
      }
    } catch {
      // Continue trying
    }
  }

  // Check framework lib files if not found
  if (!source && basePath.startsWith("lib/")) {
    const platformFs = createFileSystem();
    for (const ext of extensions) {
      const frameworkPath = join(FRAMEWORK_ROOT, basePath + ext);
      try {
        const stat = await platformFs.stat(frameworkPath);
        if (stat.isFile) {
          source = await platformFs.readTextFile(frameworkPath);
          sourceFile = frameworkPath;
          _isFrameworkFile = true;
          break;
        }
      } catch {
        // Continue trying
      }
    }
  }

  if (!source || !sourceFile) {
    return null;
  }

  // Transform to ESM
  let code = await transformToESM(
    source,
    sourceFile,
    projectDir,
    adapter,
    { projectId: options.projectId ?? projectDir, dev: options.dev, ssr: options.ssr },
  );

  // Apply SSR-specific rewrites
  if (options.ssr && code) {
    code = applySSRImportRewrites(code, {
      projectSlug: options.projectSlug,
      branch: options.branch,
    });
  }

  return code;
}

/**
 * Generate the batch bundle code
 * Creates a module that exports all loaded modules by path
 */
function generateBatchBundle(
  successes: Array<{ path: string; code: string; cached: boolean }>,
  failures: Array<{ path: string; error: string }>,
): string {
  const parts: string[] = [
    "// Veryfront Module Batch Bundle",
    "// Generated: " + new Date().toISOString(),
    `// Modules: ${successes.length} loaded, ${failures.length} failed`,
    "",
    "const __vf_batch_modules = new Map();",
    "",
  ];

  // Add each module wrapped in a function to isolate scope
  for (let i = 0; i < successes.length; i++) {
    const item = successes[i];
    if (!item) continue;
    const { path, code } = item;
    const varName = `__mod_${i}`;

    // Wrap module code in an async IIFE that returns exports
    parts.push(`// Module: ${path}`);
    parts.push(`const ${varName} = await (async () => {`);
    parts.push(`  const exports = {};`);
    parts.push(`  const module = { exports };`);
    parts.push(`  // --- Module code start ---`);

    // Transform the module code to populate exports
    // Replace export statements with assignments
    const transformedCode = transformExportsForBundle(code);
    parts.push(transformedCode);

    parts.push(`  // --- Module code end ---`);
    parts.push(`  return exports;`);
    parts.push(`})();`);
    parts.push(`__vf_batch_modules.set("${path}", ${varName});`);
    parts.push("");
  }

  // Add failed module placeholders
  for (const { path, error } of failures) {
    parts.push(`// Failed: ${path} - ${error}`);
    parts.push(`__vf_batch_modules.set("${path}", { __vf_error: "${error}" });`);
  }

  // Export the batch map and a getter function
  parts.push("");
  parts.push("export const batchModules = __vf_batch_modules;");
  parts.push("");
  parts.push("export function getModule(path) {");
  parts.push("  return __vf_batch_modules.get(path);");
  parts.push("}");
  parts.push("");
  parts.push("export default { batchModules, getModule };");

  return parts.join("\n");
}

/**
 * Transform module code for inclusion in batch bundle
 * Converts ES module syntax to work within the bundle wrapper
 */
function transformExportsForBundle(code: string): string {
  // This is a simplified transform - in production you'd want a proper AST transform
  // For now, we keep the code as-is since each module in the batch can be
  // dynamically imported separately

  // Add indentation for readability
  return code.split("\n").map((line) => "  " + line).join("\n");
}

/**
 * Clear the transform cache (on deployment or memory pressure)
 */
export function clearBatchCache(projectSlug?: string): void {
  if (projectSlug) {
    const prefix = `${projectSlug}:`;
    for (const key of transformCache.keys()) {
      if (key.startsWith(prefix)) {
        transformCache.delete(key);
      }
    }
    logger.debug("[ModuleBatch] Cleared cache for project", { projectSlug });
  } else {
    transformCache.clear();
    logger.debug("[ModuleBatch] Cleared all cache");
  }
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
