/**
 * Module Server
 *
 * Serves transformed ESM modules at /_vf_modules/* URLs.
 * Used by client-side for granular module loading and HMR.
 *
 * Security: Uses secure filesystem wrapper to prevent path traversal attacks
 */

import { join } from "std/path/mod.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { type TransformOptions, transformToESM } from "@veryfront/transforms/esm-transform.ts";
import { serverLogger, serverLogger as logger } from "@veryfront/utils";
import { HTTP_NOT_FOUND, HTTP_OK, HTTP_SERVER_ERROR } from "@veryfront/utils";
import { getContentTypeForPath } from "../../server/handlers/utils/content-types.ts";
import { createSecureFs } from "@veryfront/security";

const DEV_MODULE_PREFIX = /^\/(?:_vf_modules|_veryfront\/modules)\//;

export interface ModuleServerOptions {
  /** Project identifier */
  projectId: string;
  /** Project root directory */
  projectDir: string;
  /** Runtime adapter */
  adapter: RuntimeAdapter;
  /** Development mode */
  dev?: boolean;
}

/**
 * Serve module at /_vf_modules/* path
 *
 * Routes:
 * - /_vf_modules/components/app.js → components/app.tsx
 * - /_vf_modules/pages/index.js → pages/index.tsx
 * - /_vf_modules/lib/utils.js → lib/utils.ts
 *
 * Process:
 * 1. Map URL to file path
 * 2. Read source file
 * 3. Transform TS/JSX to ESM (cached)
 * 4. Return with application/javascript content type
 *
 * @param req - HTTP request
 * @param options - Module server options
 * @returns HTTP response with transformed module
 */
export async function serveModule(
  req: Request,
  options: ModuleServerOptions,
): Promise<Response> {
  const startTime = performance.now();
  const timings: Record<string, number> = {};
  const { projectId, projectDir, adapter, dev = true } = options;
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const isHeadRequest = method === "HEAD";

  // Create secure filesystem wrapper for module loading
  const secureFs = createSecureFs({
    baseDir: projectDir,
    adapter,
    context: "module-loading",
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
  console.log("[ModuleServer] Request", {
    pathname: url.pathname,
    userAgent: debugUserAgent.slice(0, 50),
  });

  if (!DEV_MODULE_PREFIX.test(url.pathname)) {
    return createModuleResponse(method, "Module not found", HTTP_NOT_FOUND, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    });
  }

  // Extract file path from URL
  // /_vf_modules/components/app.js → components/app
  const modulePath = url.pathname.replace(DEV_MODULE_PREFIX, "");
  const filePathWithoutExt = modulePath.replace(/\.(?:mjs|js)$/i, "");

  try {
    // Find source file (try .tsx, .ts, .jsx, .js, .mdx)
    const findStart = performance.now();
    const sourceFile = await findSourceFile(secureFs, projectDir, filePathWithoutExt);
    timings.findFile = performance.now() - findStart;

    if (!sourceFile) {
      logger.warn("Module not found", { modulePath, filePathWithoutExt });
      return new Response("Module not found", {
        status: HTTP_NOT_FOUND,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Read source content
    let code: string | undefined;

    if (!isHeadRequest) {
      // For framework lib files, read directly from filesystem instead of through adapter
      // Only files specifically under FRAMEWORK_ROOT/lib/ are framework files
      const frameworkLibDir = join(FRAMEWORK_ROOT, "lib");
      const isFrameworkFile = sourceFile.startsWith(frameworkLibDir + "/") ||
        sourceFile.startsWith(frameworkLibDir + "\\");
      const readStart = performance.now();
      const source = isFrameworkFile
        ? await Deno.readTextFile(sourceFile)
        : await secureFs.readFile(sourceFile);
      timings.readFile = performance.now() - readStart;

      // Check for SSR mode via query parameter or Deno User-Agent
      // Deno's fetch uses "Deno/x.x.x" as User-Agent, while browsers use different UAs
      // This allows us to detect SSR requests even when query strings are lost
      const userAgent = req.headers.get("user-agent") || "";
      const isDenoRequest = userAgent.startsWith("Deno/");
      const hasSSRParam = url.searchParams.get("ssr") === "true";
      const isSSR = hasSSRParam || isDenoRequest;
      logger.info("[ModuleServer] SSR mode check", {
        isSSR,
        isDenoRequest,
        hasSSRParam,
        userAgent: userAgent.slice(0, 30),
      });

      // Transform to ESM
      const transformStart = performance.now();
      const transformOpts: TransformOptions = { projectId, dev, ssr: isSSR };
      code = await transformToESM(
        source,
        sourceFile, // Pass actual source file path (with .mdx extension)
        projectDir,
        adapter,
        transformOpts,
      );
      timings.transform = performance.now() - transformStart;

      // For SSR mode, transform imports for Deno compatibility
      // IMPORTANT: Use npm: for React to match third-party packages like @tanstack/react-query
      // which always import React via bare specifiers resolved to npm:.
      if (isSSR && code) {
        const REACT_VERSION = "18.3.1";
        const cacheBuster = Date.now();

        // Transform esm.sh React URLs to npm: specifiers for consistency
        // Keep other packages as esm.sh (better CJS to ESM conversion)
        code = code.replace(
          /from\s+["']https:\/\/esm\.sh\/((?:@[^@/?]+\/[^@/?]+|[^@/?]+))(?:@[^/?]+)?(\/[^?"']+)?(?:\?[^"']*)?["']/g,
          (match, packageName, subpath) => {
            const normalized = packageName.replace(/\/$/, "");
            // For React, use npm: to match third-party packages
            if (normalized === "react") {
              const path = subpath ? `react@${REACT_VERSION}${subpath}` : `react@${REACT_VERSION}`;
              return `from "npm:${path}"`;
            }
            if (normalized === "react-dom") {
              const path = subpath
                ? `react-dom@${REACT_VERSION}${subpath}`
                : `react-dom@${REACT_VERSION}`;
              return `from "npm:${path}"`;
            }
            // Keep other packages as esm.sh - it handles CJS properly
            return match;
          },
        );

        // Transform bare imports to npm: specifiers
        code = code.replace(
          /from\s+["']([^"'./][^"']*)["']/g,
          (_match, specifier) => {
            // Skip if already has protocol prefix
            if (
              specifier.startsWith("npm:") ||
              specifier.startsWith("http://") ||
              specifier.startsWith("https://") ||
              specifier.startsWith("file://") ||
              specifier.startsWith("node:")
            ) {
              return `from "${specifier}"`;
            }
            // Skip @/ path aliases - these are handled below
            if (specifier.startsWith("@/")) {
              return `from "${specifier}"`;
            }
            // Use versioned specifier for React packages
            if (specifier === "react") {
              return `from "npm:react@${REACT_VERSION}"`;
            }
            if (specifier.startsWith("react/")) {
              const subpath = specifier.slice(6); // Remove "react/"
              return `from "npm:react@${REACT_VERSION}/${subpath}"`;
            }
            if (specifier === "react-dom") {
              return `from "npm:react-dom@${REACT_VERSION}"`;
            }
            if (specifier.startsWith("react-dom/")) {
              const subpath = specifier.slice(10); // Remove "react-dom/"
              return `from "npm:react-dom@${REACT_VERSION}/${subpath}"`;
            }
            // Convert other bare imports to esm.sh URLs
            // esm.sh handles CJS to ESM conversion properly (npm: doesn't always expose named exports)
            return `from "https://esm.sh/${specifier}?external=react,react-dom"`;
          },
        );

        // Normalize any unversioned npm:react specifiers to versioned ones
        code = code.replace(
          /from\s+["']npm:react\/([^"'@]+)["']/g,
          `from "npm:react@${REACT_VERSION}/$1"`,
        );
        code = code.replace(
          /from\s+["']npm:react["']/g,
          `from "npm:react@${REACT_VERSION}"`,
        );
        code = code.replace(
          /from\s+["']npm:react-dom\/([^"'@]+)["']/g,
          `from "npm:react-dom@${REACT_VERSION}/$1"`,
        );
        code = code.replace(
          /from\s+["']npm:react-dom["']/g,
          `from "npm:react-dom@${REACT_VERSION}"`,
        );

        // Transform @/ path aliases to absolute /_vf_modules/ URLs for SSR
        // @/shared/ui/Button → /_vf_modules/shared/ui/Button.js?ssr=true&v=...
        code = code.replace(
          /from\s+["']@\/([^"']+)["']/g,
          (_match, path) => {
            const jsPath = path.endsWith(".js") ? path : `${path}.js`;
            return `from "/_vf_modules/${jsPath}?ssr=true&v=${cacheBuster}"`;
          },
        );

        // Add ?ssr=true and cache buster to relative and absolute module imports
        code = code.replace(
          /from\s+["']((?:\.\.?\/|\/)[^"']+\.js)["']/g,
          (_match, path) => `from "${path}?ssr=true&v=${cacheBuster}"`,
        );
      }
    }

    const headers = getDevModuleHeaders(modulePath);
    const endTime = performance.now();
    logger.info("[ModuleServer] Request complete", {
      path: modulePath,
      durationMs: (endTime - startTime).toFixed(1),
      findFileMs: timings.findFile?.toFixed(1),
      readFileMs: timings.readFile?.toFixed(1),
      transformMs: timings.transform?.toFixed(1),
    });
    return createModuleResponse(method, code ?? "", HTTP_OK, headers);
  } catch (error) {
    logger.error("Module transform error", {
      modulePath,
      error: error instanceof Error ? error.message : String(error),
    });

    const headers = getDevModuleHeaders(modulePath);
    const errorBody = createDevModuleErrorBody(
      modulePath,
      error instanceof Error ? error.message : String(error),
    );

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
 * For lib/* imports, also checks framework lib directory
 *
 * @param secureFs - Secure filesystem wrapper
 * @param projectDir - Project root directory
 * @param basePath - Base path without extension
 * @returns Full path to source file or null if not found
 */
async function findSourceFile(
  secureFs: ReturnType<typeof createSecureFs>,
  projectDir: string,
  basePath: string,
): Promise<string | null> {
  const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx"];

  // Check if basePath already has a known extension (e.g., DocsLayout.mdx from DocsLayout.mdx.js)
  const hasKnownExt = extensions.some((ext) => basePath.endsWith(ext));

  // If path already has extension, try it directly first
  if (hasKnownExt) {
    const fullPath = join(projectDir, basePath);
    try {
      const stat = await secureFs.stat(fullPath);
      if (stat?.isFile) {
        serverLogger.debug("[ModuleServer] Found file with existing extension", {
          basePath,
          resolvedPath: fullPath,
        });
        return fullPath;
      }
    } catch {
      // Continue trying other methods
    }
  }

  // Strip existing extension if present before adding new ones
  const basePathWithoutExt = hasKnownExt
    ? basePath.replace(/\.(tsx|ts|jsx|js|mdx)$/, "")
    : basePath;

  // For lib/* imports, first check the framework lib directory
  // This allows framework-provided modules like lib/Router, lib/Head, lib/usePageContext
  if (basePathWithoutExt.startsWith("lib/")) {
    for (const ext of extensions) {
      const frameworkPath = join(FRAMEWORK_ROOT, basePathWithoutExt + ext);
      try {
        const stat = await Deno.stat(frameworkPath);
        if (stat.isFile) {
          serverLogger.debug("[ModuleServer] Found framework lib file", {
            basePath: basePathWithoutExt,
            resolvedPath: frameworkPath,
          });
          return frameworkPath;
        }
      } catch {
        // Continue trying other paths
      }
    }
  }

  // Try the basePath with different extensions
  for (const ext of extensions) {
    const fullPath = join(projectDir, basePathWithoutExt + ext);

    try {
      // Use secure filesystem wrapper (automatic path validation)
      const stat = await secureFs.stat(fullPath);
      if (stat.isFile) {
        return fullPath;
      }
    } catch (error) {
      serverLogger.debug("[ModuleServer] File not found, trying next extension", {
        fullPath,
        error,
      });
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
        return fullPath;
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
          return fullPath;
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

function createDevModuleErrorBody(modulePath: string, errorMessage: string): string {
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
  if (method === "HEAD") {
    return new Response(null, { status, headers });
  }

  return new Response(body, { status, headers });
}
