/** Module Server - serves transformed ESM modules at /_vf_modules/* URLs */

import { join } from "@veryfront/platform/compat/path/index.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import { type TransformOptions, transformToESM } from "@veryfront/transforms/esm-transform.ts";
import { serverLogger, serverLogger as logger } from "@veryfront/utils";
import { HTTP_NOT_FOUND, HTTP_OK, HTTP_SERVER_ERROR } from "@veryfront/utils";
import { getContentTypeForPath } from "@veryfront/server/handlers/utils/content-types.ts";
import { createSecureFs } from "@veryfront/security";
import { getErrorMessage } from "@veryfront/errors/veryfront-error.ts";
import { getApiBaseUrlEnv } from "@veryfront/config/env.ts";
import { injectContext } from "@veryfront/observability/tracing/otlp-setup.ts";
import { injectNodePositions } from "@veryfront/transforms/plugins/babel-node-positions.ts";
import { parseProjectDomain } from "@veryfront/server/utils/domain-parser.ts";
import { applySSRImportRewrites } from "./ssr-import-rewriter.ts";
import { addHMRTimestamps } from "@veryfront/transforms/esm/import-rewriter.ts";
// Note: React imports are kept as bare specifiers for SSR, resolved via deno.json to esm.sh

const DEV_MODULE_PREFIX = /^\/(?:_vf_modules|_veryfront\/modules)\//;
const SNIPPET_MODULE_PREFIX = /^\/_vf_modules\/_snippets\/([a-f0-9]+)\.js/;
// Cross-project import patterns: /_vf_modules/_cross/<slug>[@<version>]/@/<path>
const CROSS_PROJECT_VERSIONED_PREFIX =
  /^\/_vf_modules\/_cross\/([a-z0-9-]+)@([\d^~x][\d.x^~-]*)\/\@\/(.+)$/;
const CROSS_PROJECT_LATEST_PREFIX = /^\/_vf_modules\/_cross\/([a-z0-9-]+)\/\@\/(.+)$/;

export interface ModuleServerOptions {
  /** Project identifier (directory path, legacy naming) */
  projectId: string;
  /** Project root directory */
  projectDir: string;
  /** Runtime adapter */
  adapter: RuntimeAdapter;
  /** Development mode */
  dev?: boolean;
  /** Project UUID for multi-project mode (from domain lookup) */
  projectUUID?: string;
  /** Project slug for multi-project mode (from proxy headers or domain lookup) */
  projectSlug?: string;
  /** Branch name for branch-aware file resolution */
  branch?: string | null;
  /** Release ID for production mode (published files) */
  releaseId?: string | null;
  /**
   * Restrict module imports to specific directories (opt-in security).
   * When not set, users can import from any directory in the project.
   */
  allowedImportDirs?: string[];
}

/** Serve transformed module at /_vf_modules/* path */
export async function serveModule(
  req: Request,
  options: ModuleServerOptions,
): Promise<Response> {
  const startTime = performance.now();
  const timings: Record<string, number> = {};
  // Note: projectUUID and releaseId are passed but not used here - context is set by handler layer
  const {
    projectId,
    projectDir,
    adapter,
    dev = true,
    projectUUID,
    releaseId: _releaseId,
    allowedImportDirs,
  } = options;
  const effectiveProjectId = projectUUID ?? projectId;
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const isHeadRequest = method === "HEAD";

  // Create secure filesystem wrapper for module loading
  const secureFs = createSecureFs({
    baseDir: projectDir,
    adapter,
    context: "module-loading",
    contextOptions: {
      allowedImportDirs, // Pass through from config (undefined = no restrictions)
    },
    throwOnError: false, // Don't throw, return appropriate HTTP error
    onSecurityEvent: (event) => {
      if (event.type === "validation-failed") {
        logger.warn("[ModuleServer] Security validation failed", {
          operation: event.operation,
          path: event.path,
          error: event.error,
        });
      }
    },
  });

  // Log User-Agent for debugging SSR detection
  const debugUserAgent = req.headers.get("user-agent") || "";
  logger.debug("[ModuleServer] Request", {
    pathname: url.pathname,
    userAgent: debugUserAgent.slice(0, 50),
  });

  if (!DEV_MODULE_PREFIX.test(url.pathname)) {
    return createModuleResponse(method, "Module not found", HTTP_NOT_FOUND, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    });
  }

  // Handle snippet module requests (/_vf_modules/_snippets/<hash>.js)
  const snippetMatch = url.pathname.match(SNIPPET_MODULE_PREFIX);
  if (snippetMatch) {
    const hash = snippetMatch[1];
    if (!hash) {
      return createModuleResponse(
        method,
        "Missing snippet hash",
        HTTP_NOT_FOUND,
        {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      );
    }
    const { getCompiledSnippet } = await import(
      "@veryfront/rendering/snippet-renderer.ts"
    );
    const snippetCode = getCompiledSnippet(hash);

    if (!snippetCode) {
      logger.warn("[ModuleServer] Snippet not found in cache", { hash });
      return createModuleResponse(method, "Snippet not found", HTTP_NOT_FOUND, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      });
    }

    // Extract project slug and branch from hostname using domain parser
    // e.g., "shadcn-uizz--ffff.preview.lvh.me" → { slug: "shadcn-uizz", branch: "ffff" }
    const { slug: snippetProjectSlug, branch: snippetBranch } = parseProjectDomain(url.host);

    // Apply same transformations as regular modules
    // Snippet code is already compiled JS, so use .tsx extension to skip MDX compilation
    // but still apply import rewrites (React, @/ paths, etc.)
    const userAgent = req.headers.get("user-agent") || "";
    const isDenoRequest = userAgent.startsWith("Deno/");
    const hasSSRParam = url.searchParams.get("ssr") === "true";
    const isSSR = hasSSRParam || isDenoRequest;

    logger.debug("[ModuleServer] Transforming snippet", {
      hash,
      isSSR,
      snippetProjectSlug,
      codeLength: snippetCode.length,
    });

    try {
      let transformedCode = await transformToESM(
        snippetCode,
        `_snippets/${hash}.tsx`, // Use .tsx to apply import rewrites without MDX compilation
        projectDir,
        adapter,
        { projectId: effectiveProjectId, dev, ssr: isSSR },
      );

      // Apply SSR-specific rewrites using shared utility
      if (isSSR && transformedCode) {
        transformedCode = applySSRImportRewrites(transformedCode, {
          projectSlug: snippetProjectSlug,
          branch: snippetBranch,
        });
      }

      logger.debug("[ModuleServer] Snippet transformed", {
        hash,
        isSSR,
        transformedLength: transformedCode.length,
      });

      return createModuleResponse(method, transformedCode, HTTP_OK, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-cache",
      });
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      logger.error("[ModuleServer] Snippet transform error", {
        hash,
        error: errorMsg,
      });
      return createModuleResponse(
        method,
        `// Transform Error\nthrow new Error(${JSON.stringify(errorMsg)});`,
        HTTP_SERVER_ERROR,
        {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      );
    }
  }

  // Handle cross-project module requests
  // Versioned: /_vf_modules/_cross/<projectSlug>@<version>/@/<path>
  // Versionless: /_vf_modules/_cross/<projectSlug>/@/<path> (defaults to "latest")
  const versionedMatch = url.pathname.match(CROSS_PROJECT_VERSIONED_PREFIX);
  const latestMatch = url.pathname.match(CROSS_PROJECT_LATEST_PREFIX);
  const crossProjectMatch = versionedMatch || latestMatch;

  if (crossProjectMatch) {
    let crossProjectSlug: string | undefined;
    let crossVersion: string | undefined;
    let crossPath: string | undefined;

    if (versionedMatch) {
      [, crossProjectSlug, crossVersion, crossPath] = versionedMatch;
    } else if (latestMatch) {
      [, crossProjectSlug, crossPath] = latestMatch;
      crossVersion = "latest";
    }

    if (!crossProjectSlug || !crossPath) {
      return createModuleResponse(
        method,
        "Invalid cross-project import path",
        HTTP_NOT_FOUND,
        {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      );
    }

    // Build projectRef - omit version for versionless (API resolves to latest release)
    const projectRef = crossVersion === "latest"
      ? crossProjectSlug
      : `${crossProjectSlug}@${crossVersion}`;
    logger.debug("[ModuleServer] Cross-project import", {
      projectRef,
      path: crossPath,
      isLatest: crossVersion === "latest",
    });

    try {
      // Fetch source from registry API
      const source = await fetchCrossProjectSource(projectRef, crossPath);
      if (!source) {
        return createModuleResponse(
          method,
          `Cross-project module not found: ${projectRef}/@/${crossPath}`,
          HTTP_NOT_FOUND,
          {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        );
      }

      // Detect SSR mode
      const userAgent = req.headers.get("user-agent") || "";
      const isSSR = url.searchParams.get("ssr") === "true" ||
        userAgent.startsWith("Deno/");

      // Transform using same pipeline as internal modules
      let code = await transformToESM(source, crossPath, projectDir, adapter, {
        projectId: effectiveProjectId,
        dev,
        ssr: isSSR,
        moduleServerUrl: `http://${url.host}`,
      });

      // SSR: Apply cross-project specific rewrites for @/ paths
      // @/ in cross-project code should resolve to the external project, not current
      if (isSSR && code) {
        code = applySSRImportRewrites(code, { crossProjectRef: projectRef });
      }

      return createModuleResponse(method, code, HTTP_OK, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-cache",
      });
    } catch (error) {
      logger.error("[ModuleServer] Cross-project error", {
        projectRef,
        error: String(error),
      });
      return createModuleResponse(
        method,
        `// Error: ${String(error)}`,
        HTTP_SERVER_ERROR,
        {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      );
    }
  }

  // Extract file path from URL
  // /_vf_modules/components/app.js → components/app
  let modulePath = url.pathname.replace(DEV_MODULE_PREFIX, "");

  // Handle @/ path alias - maps to project root
  // /_vf_modules/@/components/Button.js → components/Button
  if (modulePath.startsWith("@/")) {
    modulePath = modulePath.slice(2); // Remove @/ prefix
  }

  const filePathWithoutExt = modulePath.replace(/\.(?:mjs|js)$/i, "");

  // Get project context from options (set by handler from proxy headers/domain lookup)
  // Fall back to query params or hostname parsing for direct requests
  // Priority: options > query params > hostname parsing
  let projectSlug = options.projectSlug ?? url.searchParams.get("project");
  let branch = options.branch ?? url.searchParams.get("branch");
  if (!projectSlug) {
    const parsedHost = parseProjectDomain(url.host);
    projectSlug = parsedHost.slug;
    if (!branch) {
      branch = parsedHost.branch;
    }
  }

  // NOTE: In multi-project mode, the context (including token) is already set by the caller
  // (ModuleHandler.withProxyContext) via AsyncLocalStorage. File operations will automatically
  // use the existing context, so we don't need to call runWithContext again here.

  try {
    // Find source file (try .tsx, .ts, .jsx, .js, .mdx)
    const findStart = performance.now();

    const findResult = await findSourceFile(
      secureFs,
      projectDir,
      filePathWithoutExt,
    );
    timings.findFile = performance.now() - findStart;

    if (!findResult) {
      logger.warn("Module not found", {
        modulePath,
        filePathWithoutExt,
        projectSlug,
        projectDir,
      });
      return new Response("Module not found", {
        status: HTTP_NOT_FOUND,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const { path: sourceFile, isFrameworkFile } = findResult;

    // Read source content
    let code: string | undefined;

    if (!isHeadRequest) {
      // For framework lib files, read directly from filesystem instead of through adapter
      // isFrameworkFile flag is set by findSourceFile when file is from framework lib
      const readStart = performance.now();
      const platformFs = createFileSystem();
      let source = isFrameworkFile
        ? await platformFs.readTextFile(sourceFile)
        : await secureFs.readFile(sourceFile);
      timings.readFile = performance.now() - readStart;

      // Check for SSR mode via query parameter or Deno User-Agent
      // Deno's fetch uses "Deno/x.x.x" as User-Agent, while browsers use different UAs
      // This allows us to detect SSR requests even when query strings are lost
      const userAgent = req.headers.get("user-agent") || "";
      const isDenoRequest = userAgent.startsWith("Deno/");
      const hasSSRParam = url.searchParams.get("ssr") === "true";
      const isSSR = hasSSRParam || isDenoRequest;

      const studioEmbed = url.searchParams.get("studio_embed") === "true";
      const isJsxFile = /\.(tsx|jsx)$/i.test(sourceFile);
      if (studioEmbed && !isFrameworkFile && isJsxFile) {
        const injectStart = performance.now();
        source = injectNodePositions(source, { filePath: sourceFile });
        timings.injectPositions = performance.now() - injectStart;
      }
      logger.debug("[ModuleServer] SSR mode check", {
        isSSR,
        isDenoRequest,
        hasSSRParam,
        userAgent: userAgent.slice(0, 30),
      });

      // Transform to ESM
      const transformStart = performance.now();
      const transformOpts: TransformOptions = {
        projectId: effectiveProjectId,
        dev,
        ssr: isSSR,
        studioEmbed,
      };
      code = await transformToESM(
        source,
        sourceFile, // Pass actual source file path (with .mdx extension)
        projectDir,
        adapter,
        transformOpts,
      );
      timings.transform = performance.now() - transformStart;

      // Apply SSR-specific rewrites using shared utility
      if (isSSR && code) {
        code = applySSRImportRewrites(code, {
          projectSlug,
          branch,
        });
      }

      // Add HMR timestamps to all local imports for cache busting
      // This is crucial for HMR to work - without it, nested imports
      // would return cached versions even after file changes
      const hmrTimestamp = url.searchParams.get("t");
      if (hmrTimestamp && code) {
        const hmrStart = performance.now();
        code = await addHMRTimestamps(code, hmrTimestamp);
        timings.hmrTimestamps = performance.now() - hmrStart;
        logger.debug("[ModuleServer] HMR timestamp injection", {
          path: modulePath,
          timestamp: hmrTimestamp,
          durationMs: timings.hmrTimestamps?.toFixed(1),
        });
      }
    }

    const headers = getDevModuleHeaders(modulePath);
    logger.debug("[ModuleServer] Request complete", {
      path: modulePath,
      durationMs: (performance.now() - startTime).toFixed(1),
    });
    return createModuleResponse(method, code ?? "", HTTP_OK, headers);
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    logger.error("Module transform error", {
      modulePath,
      error: errorMsg,
    });

    const headers = getDevModuleHeaders(modulePath);
    const errorBody = createDevModuleErrorBody(modulePath, errorMsg);

    return createModuleResponse(method, errorBody, HTTP_SERVER_ERROR, headers);
  }
}

// Get the veryfront-private root directory (where this code is running from)
// From src/module-system/server/module-server.ts, go up 3 levels to reach veryfront-private/
const FRAMEWORK_ROOT = new URL("../../..", import.meta.url).pathname;

/**
 * Find source file by trying different extensions
 *
 * Tries in order: .tsx, .ts, .jsx, .js, .mdx
 * Also tries common directories (app/, pages/, lib/) if file not found at root
 * For lib/* imports, also checks framework lib directory as fallback
 *
 * @param secureFs - Secure filesystem wrapper
 * @param projectDir - Project root directory
 * @param basePath - Base path without extension
 * @returns Object with path and isFrameworkFile flag, or null if not found
 */
interface FindSourceFileResult {
  path: string;
  isFrameworkFile: boolean;
}

async function findSourceFile(
  secureFs: ReturnType<typeof createSecureFs>,
  projectDir: string,
  basePath: string,
): Promise<FindSourceFileResult | null> {
  const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"];

  serverLogger.debug("[ModuleServer] findSourceFile called", {
    projectDir,
    basePath,
  });

  // Check if basePath already has a known extension (e.g., DocsLayout.mdx from DocsLayout.mdx.js)
  const hasKnownExt = extensions.some((ext) => basePath.endsWith(ext));

  // If path already has extension, try it directly first
  if (hasKnownExt) {
    const fullPath = join(projectDir, basePath);
    try {
      const stat = await secureFs.stat(fullPath);
      if (stat?.isFile) {
        serverLogger.debug(
          "[ModuleServer] Found file with existing extension",
          {
            basePath,
            resolvedPath: fullPath,
          },
        );
        return { path: fullPath, isFrameworkFile: false };
      }
    } catch {
      // Continue trying other methods
    }
  }

  // Strip existing extension if present before adding new ones
  const basePathWithoutExt = hasKnownExt
    ? basePath.replace(/\.(tsx|ts|jsx|js|mdx|md)$/, "")
    : basePath;

  // Try the basePath with different extensions (PROJECT FILES FIRST)
  // This ensures user code takes precedence over framework lib files
  for (const ext of extensions) {
    const fullPath = join(projectDir, basePathWithoutExt + ext);

    try {
      // Use secure filesystem wrapper (automatic path validation)
      const stat = await secureFs.stat(fullPath);
      if (stat.isFile) {
        serverLogger.debug("[ModuleServer] Found file", {
          basePath,
          resolvedPath: fullPath,
        });
        return { path: fullPath, isFrameworkFile: false };
      }
    } catch {
      // Continue trying next extension
    }
  }

  // For paths starting with common directory prefixes (components/, pages/, etc.),
  // also try without the prefix since API files may be stored at root level
  const prefixesToStrip = ["components/", "pages/", "lib/", "app/", "src/"];
  for (const prefix of prefixesToStrip) {
    if (basePathWithoutExt.startsWith(prefix)) {
      const strippedPath = basePathWithoutExt.slice(prefix.length);
      for (const ext of extensions) {
        const fullPath = join(projectDir, strippedPath + ext);
        try {
          const stat = await secureFs.stat(fullPath);
          if (stat.isFile) {
            serverLogger.debug(
              "[ModuleServer] Found file after stripping prefix",
              {
                originalPath: basePathWithoutExt,
                strippedPath,
                resolvedPath: fullPath,
              },
            );
            return { path: fullPath, isFrameworkFile: false };
          }
        } catch {
          // Continue trying
        }
      }
    }
  }

  // Try index file in directory (e.g., constants/index.ts)
  for (const ext of extensions) {
    const fullPath = join(projectDir, basePathWithoutExt, `index${ext}`);

    try {
      const stat = await secureFs.stat(fullPath);
      if (stat.isFile) {
        serverLogger.debug("[ModuleServer] Found index file", {
          basePath: basePathWithoutExt,
          resolvedPath: fullPath,
        });
        return { path: fullPath, isFrameworkFile: false };
      }
    } catch {
      // Continue trying other extensions
    }
  }

  // If not found, try common directories as fallbacks
  // This handles imports like "components/Button" which should resolve to "app/components/Button"
  // Also handles @/ alias which maps to components/ in veryfront projects
  const commonDirs = ["components", "app", "pages", "lib", "src"];
  for (const dir of commonDirs) {
    for (const ext of extensions) {
      const fullPath = join(projectDir, dir, basePathWithoutExt + ext);

      try {
        const stat = await secureFs.stat(fullPath);
        if (stat.isFile) {
          serverLogger.debug("[ModuleServer] Found file in common directory", {
            basePath,
            resolvedPath: fullPath,
          });
          return { path: fullPath, isFrameworkFile: false };
        }
      } catch {
        // Continue trying other paths
      }
    }
  }

  // Framework file lookup configuration: [prefix, frameworkDir, logLabel]
  // Order matters: more specific prefixes should come first
  const frameworkLookups: [string, string, string][] = [
    ["lib/", join(FRAMEWORK_ROOT, "src"), "lib"],
    // Support both "exports/" and "src/exports/" paths for context module resolution
    // This is needed because lib/usePageContext.tsx imports "../src/exports/context.ts"
    // which becomes "src/exports/context.js" when resolved from "lib/usePageContext.js"
    ["src/exports/", FRAMEWORK_ROOT, "src/exports"],
    ["exports/", join(FRAMEWORK_ROOT, "src"), "exports"],
    ["react/", join(FRAMEWORK_ROOT, "src"), "react"],
  ];

  const platformFs = createFileSystem();
  for (const [prefix, frameworkDir, label] of frameworkLookups) {
    if (!basePathWithoutExt.startsWith(prefix)) continue;

    for (const ext of extensions) {
      const frameworkPath = join(frameworkDir, basePathWithoutExt + ext);
      try {
        const stat = await platformFs.stat(frameworkPath);
        if (stat.isFile) {
          serverLogger.debug(`[ModuleServer] Found framework ${label} file`, {
            basePath: basePathWithoutExt,
            resolvedPath: frameworkPath,
          });
          return { path: frameworkPath, isFrameworkFile: true };
        }
      } catch {
        // Continue trying other paths
      }
    }
  }

  return null;
}

/**
 * Check if request is for a module
 *
 * @param req - HTTP request
 * @returns true if request path starts with /_vf_modules/
 */
export function isModuleRequest(req: Request): boolean {
  const url = new URL(req.url);
  return DEV_MODULE_PREFIX.test(url.pathname);
}

function getDevModuleHeaders(modulePath: string): Record<string, string> {
  const contentType = getDevModuleContentType(modulePath);
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
  };
}

function getDevModuleContentType(modulePath: string): string {
  const normalizedPath = modulePath.toLowerCase();

  if (normalizedPath.endsWith(".map") || normalizedPath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }

  if (normalizedPath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }

  const detected = getContentTypeForPath(normalizedPath);
  // Default to JavaScript for module requests without known extensions
  // This handles extensionless imports like "utils" which resolve to .ts/.js files
  if (detected === "application/octet-stream") {
    return "application/javascript; charset=utf-8";
  }
  return detected ?? "application/javascript; charset=utf-8";
}

function createDevModuleErrorBody(
  modulePath: string,
  errorMessage: string,
): string {
  const normalizedPath = modulePath.toLowerCase();

  if (normalizedPath.endsWith(".css")) {
    const sanitized = errorMessage.replace(/\*\//g, "*\\/");
    return `/* Transform Error: ${sanitized} */`;
  }

  if (normalizedPath.endsWith(".json") || normalizedPath.endsWith(".map")) {
    return JSON.stringify({ error: errorMessage });
  }

  return `// Transform Error\nthrow new Error(${JSON.stringify(errorMessage)});`;
}

function createModuleResponse(
  method: string,
  body: string,
  status: number,
  headers: Record<string, string>,
): Response {
  return new Response(method === "HEAD" ? null : body, { status, headers });
}

/**
 * Fetch source code from registry API for cross-project imports.
 * Returns null if not found.
 */
async function fetchCrossProjectSource(
  projectRef: string,
  filePath: string,
): Promise<string | null> {
  const apiBaseUrl = getApiBaseUrlEnv();
  const registryBaseUrl = apiBaseUrl.replace(/\/api\/?$/, "");
  const registryUrl = `${registryBaseUrl}/${projectRef}/@/${filePath}`;

  const headers = new Headers();
  injectContext(headers);
  const response = await fetch(registryUrl, { headers });
  if (!response.ok) {
    logger.warn("[ModuleServer] Cross-project fetch failed", {
      registryUrl,
      status: response.status,
    });
    return null;
  }
  return response.text();
}
