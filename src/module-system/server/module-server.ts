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
import { injectNodePositions } from "../../build/transforms/plugins/babel-node-positions.ts";
import { parseProjectDomain } from "../../server/utils/domain-parser.ts";

const DEV_MODULE_PREFIX = /^\/(?:_vf_modules|_veryfront\/modules)\//;
const SNIPPET_MODULE_PREFIX = /^\/_vf_modules\/_snippets\/([a-f0-9]+)\.js/;

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

  // Handle snippet module requests (/_vf_modules/_snippets/<hash>.js)
  const snippetMatch = url.pathname.match(SNIPPET_MODULE_PREFIX);
  if (snippetMatch) {
    const hash = snippetMatch[1];
    if (!hash) {
      return createModuleResponse(method, "Missing snippet hash", HTTP_NOT_FOUND, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      });
    }
    const { getCompiledSnippet } = await import("@veryfront/rendering/snippet-renderer.ts");
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
    const parsedDomain = parseProjectDomain(url.host);
    const snippetProjectSlug = parsedDomain.slug;
    const snippetBranch = parsedDomain.branch;

    // Apply same transformations as regular modules
    // Snippet code is already compiled JS, so use .tsx extension to skip MDX compilation
    // but still apply import rewrites (React, @/ paths, etc.)
    const userAgent = req.headers.get("user-agent") || "";
    const isDenoRequest = userAgent.startsWith("Deno/");
    const hasSSRParam = url.searchParams.get("ssr") === "true";
    const isSSR = hasSSRParam || isDenoRequest;

    logger.info("[ModuleServer] Transforming snippet", {
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
        { projectId, dev, ssr: isSSR },
      );

      // Apply SSR-specific rewrites (same as regular modules)
      if (isSSR && transformedCode) {
        const REACT_VERSION = "18.3.1";
        const cacheBuster = Date.now();

        // Transform esm.sh React URLs to npm: specifiers for consistency
        transformedCode = transformedCode.replace(
          /from\s+["']https:\/\/esm\.sh\/((?:@[^@/?]+\/[^@/?]+|[^@/?]+))(?:@[^/?]+)?(\/[^?"']+)?(?:\?[^"']*)?["']/g,
          (match, packageName, subpath) => {
            const normalized = packageName.replace(/\/$/, "");
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
            return match;
          },
        );

        // Transform bare imports to npm: specifiers
        transformedCode = transformedCode.replace(
          /from\s+["']([^"'./][^"']*)["']/g,
          (_match, specifier) => {
            if (
              specifier.startsWith("npm:") ||
              specifier.startsWith("http://") ||
              specifier.startsWith("https://") ||
              specifier.startsWith("file://") ||
              specifier.startsWith("node:")
            ) {
              return `from "${specifier}"`;
            }
            if (specifier.startsWith("@/")) {
              return `from "${specifier}"`;
            }
            if (specifier === "react") {
              return `from "npm:react@${REACT_VERSION}"`;
            }
            if (specifier.startsWith("react/")) {
              const subpath = specifier.slice(6);
              return `from "npm:react@${REACT_VERSION}/${subpath}"`;
            }
            if (specifier === "react-dom") {
              return `from "npm:react-dom@${REACT_VERSION}"`;
            }
            if (specifier.startsWith("react-dom/")) {
              const subpath = specifier.slice(10);
              return `from "npm:react-dom@${REACT_VERSION}/${subpath}"`;
            }
            return `from "https://esm.sh/${specifier}?external=react,react-dom"`;
          },
        );

        // Normalize any unversioned npm:react specifiers
        transformedCode = transformedCode.replace(
          /from\s+["']npm:react\/([^"'@]+)["']/g,
          `from "npm:react@${REACT_VERSION}/$1"`,
        );
        transformedCode = transformedCode.replace(
          /from\s+["']npm:react["']/g,
          `from "npm:react@${REACT_VERSION}"`,
        );
        transformedCode = transformedCode.replace(
          /from\s+["']npm:react-dom\/([^"'@]+)["']/g,
          `from "npm:react-dom@${REACT_VERSION}/$1"`,
        );
        transformedCode = transformedCode.replace(
          /from\s+["']npm:react-dom["']/g,
          `from "npm:react-dom@${REACT_VERSION}"`,
        );

        // Transform @/ path aliases to absolute /_vf_modules/ URLs for SSR
        // Include project slug and branch so module server can resolve files in the correct project/branch
        const projectParam = snippetProjectSlug ? `&project=${snippetProjectSlug}` : "";
        const branchParam = snippetBranch ? `&branch=${snippetBranch}` : "";
        transformedCode = transformedCode.replace(
          /from\s+["']@\/([^"']+)["']/g,
          (_match, path) => {
            const jsPath = path.endsWith(".js") ? path : `${path}.js`;
            return `from "/_vf_modules/${jsPath}?ssr=true${projectParam}${branchParam}&v=${cacheBuster}"`;
          },
        );

        // Add ?ssr=true, project param, branch param, and cache buster to relative imports
        transformedCode = transformedCode.replace(
          /from\s+["']((?:\.\.?\/|\/)[^"']+\.js)["']/g,
          (_match, path) => `from "${path}?ssr=true${projectParam}${branchParam}&v=${cacheBuster}"`,
        );
      }

      logger.info("[ModuleServer] Snippet transformed", {
        hash,
        isSSR,
        transformedLength: transformedCode.length,
      });

      return createModuleResponse(method, transformedCode, HTTP_OK, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-cache",
      });
    } catch (error) {
      logger.error("[ModuleServer] Snippet transform error", {
        hash,
        error: error instanceof Error ? error.message : String(error),
      });
      return createModuleResponse(
        method,
        `// Transform Error\nthrow new Error(${
          JSON.stringify(error instanceof Error ? error.message : String(error))
        });`,
        HTTP_SERVER_ERROR,
        { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache" },
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

  // Check for project context in query params (for SSR imports in proxy mode)
  // Also extract from hostname as fallback using domain parser
  // e.g., "shadcn-uizz--ffff.preview.lvh.me" → { slug: "shadcn-uizz", branch: "ffff" }
  let projectSlug = url.searchParams.get("project");
  let branch = url.searchParams.get("branch");
  if (!projectSlug) {
    const parsedHost = parseProjectDomain(url.host);
    projectSlug = parsedHost.slug;
    if (!branch) {
      branch = parsedHost.branch;
    }
  }

  // Helper function to run with optional proxy context
  const runWithOptionalContext = <T>(fn: () => Promise<T>): Promise<T> => {
    // Set branch context on FSAdapter if available (for branch-aware file resolution)
    const fsWrapper = adapter.fs as {
      runWithContext?: <T>(slug: string, token: string, fn: () => Promise<T>) => Promise<T>;
      setRequestBranch?: (b: string | null) => void;
    };

    if (typeof fsWrapper.setRequestBranch === "function") {
      fsWrapper.setRequestBranch(branch);
    }

    if (!projectSlug) {
      return fn();
    }

    // Try to use multi-project context if available
    if (typeof fsWrapper.runWithContext === "function") {
      logger.info("[ModuleServer] Using project context", { projectSlug, branch });
      return fsWrapper.runWithContext(projectSlug, "", fn);
    }

    return fn();
  };

  try {
    // Find source file (try .tsx, .ts, .jsx, .js, .mdx)
    const findStart = performance.now();

    const sourceFile = await runWithOptionalContext(() =>
      findSourceFile(secureFs, projectDir, filePathWithoutExt)
    );
    timings.findFile = performance.now() - findStart;

    if (!sourceFile) {
      logger.warn("Module not found", { modulePath, filePathWithoutExt, projectSlug, projectDir });
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
      let source = isFrameworkFile
        ? await Deno.readTextFile(sourceFile)
        : await runWithOptionalContext(() => secureFs.readFile(sourceFile));
      timings.readFile = performance.now() - readStart;

      // Inject source position data attributes for Studio Navigator
      // This adds data-node-line, data-node-column, etc. to JSX elements
      // Only apply to project TSX/JSX files (not framework files)
      const isJsxFile = /\.(tsx|jsx)$/i.test(sourceFile);
      if (!isFrameworkFile && isJsxFile) {
        const injectStart = performance.now();
        source = injectNodePositions(source, { filePath: sourceFile });
        timings.injectPositions = performance.now() - injectStart;
      }

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
        // @/shared/ui/Button → /_vf_modules/shared/ui/Button.js?ssr=true&project=...&branch=...&v=...
        // Include project slug and branch so module server can resolve files in the correct project/branch
        const projectParam = projectSlug ? `&project=${projectSlug}` : "";
        const branchParam = branch ? `&branch=${branch}` : "";
        code = code.replace(
          /from\s+["']@\/([^"']+)["']/g,
          (_match, path) => {
            const jsPath = path.endsWith(".js") ? path : `${path}.js`;
            return `from "/_vf_modules/${jsPath}?ssr=true${projectParam}${branchParam}&v=${cacheBuster}"`;
          },
        );

        // Add ?ssr=true, project param, branch param, and cache buster to relative and absolute module imports
        code = code.replace(
          /from\s+["']((?:\.\.?\/|\/)[^"']+\.js)["']/g,
          (_match, path) => `from "${path}?ssr=true${projectParam}${branchParam}&v=${cacheBuster}"`,
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
      injectPositionsMs: timings.injectPositions?.toFixed(1),
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
  const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"];

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
    ? basePath.replace(/\.(tsx|ts|jsx|js|mdx|md)$/, "")
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
