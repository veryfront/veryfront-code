/** Module Server - serves transformed ESM modules at /_vf_modules/* URLs */

import { join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { type TransformOptions, transformToESM } from "#veryfront/transforms/esm-transform.ts";
import { serverLogger } from "#veryfront/utils";
import { HTTP_NOT_FOUND, HTTP_OK, HTTP_SERVER_ERROR } from "#veryfront/utils";
import { getContentTypeForPath } from "#veryfront/server/handlers/utils/content-types.ts";
import { createSecureFs } from "#veryfront/security";
import { getErrorMessage } from "#veryfront/errors/veryfront-error.ts";
import { getApiBaseUrlEnv } from "#veryfront/config/env.ts";
import { injectContext, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { injectNodePositions } from "#veryfront/transforms/plugins/babel-node-positions.ts";
import { parseProjectDomain } from "#veryfront/server/utils/domain-parser.ts";
import { applySSRImportRewrites } from "./ssr-import-rewriter.ts";
import { addHMRTimestamps } from "#veryfront/transforms/esm/import-rewriter.ts";
import { getFrameworkRootFromMeta } from "#veryfront/platform/compat/vfs-paths.ts";
import { isDenoCompiled } from "#veryfront/platform/compat/runtime.ts";

const logger = serverLogger.component("module-server");

/**
 * Embedded polyfills for compiled Deno binaries.
 *
 * In compiled binaries, framework source files are not accessible via filesystem
 * because they're not statically imported (only referenced as path strings).
 * These inline polyfills ensure browser compatibility without filesystem I/O.
 *
 * @see src/platform/polyfills/embedded-polyfills.test.ts - validates completeness
 * @see getRequiredPolyfillPaths() in node-builtin-strategy.ts - source of truth for required paths
 */
export const EMBEDDED_POLYFILLS: Record<string, string> = {
  "_veryfront/platform/polyfills/node-async-hooks": `/**
 * Browser polyfill for node:async_hooks.
 * Provides a no-op AsyncLocalStorage that safely does nothing in the browser.
 */
export class AsyncLocalStorage {
  run(_store, callback, ...args) {
    return callback(...args);
  }
  getStore() {
    return undefined;
  }
  disable() {}
  enterWith(_store) {}
}
`,
  "_veryfront/platform/polyfills/node-noop": `/**
 * Browser polyfill for unknown Node.js built-in modules.
 * Exports an empty object to prevent import crashes.
 */
export default {};
`,
};

/**
 * Validate that all required polyfills are embedded.
 * Call this at startup in compiled mode to fail fast if polyfills are missing.
 *
 * @throws Error if any required polyfill is missing from EMBEDDED_POLYFILLS
 */
export async function validateEmbeddedPolyfills(): Promise<void> {
  if (!isDenoCompiled) return; // Only validate in compiled mode

  // Dynamic import to avoid circular dependency at module load time
  const { getRequiredPolyfillPaths } = await import(
    "#veryfront/transforms/import-rewriter/strategies/node-builtin-strategy.ts"
  );

  const requiredPaths = getRequiredPolyfillPaths();
  const embeddedPaths = new Set(Object.keys(EMBEDDED_POLYFILLS));

  const missing = requiredPaths.filter((path: string) => !embeddedPaths.has(path));

  if (missing.length > 0) {
    const errorMsg = `FATAL: Missing embedded polyfills (will cause 404 errors in browser):\n` +
      missing.map((p: string) => `  - ${p}`).join("\n") +
      `\n\nAdd these to EMBEDDED_POLYFILLS in src/modules/server/module-server.ts`;

    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  logger.info(`Validated ${embeddedPaths.size} embedded polyfills`);
}

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
  /** React version for transforms (from project config) */
  reactVersion?: string;
}

/** Serve transformed module at /_vf_modules/* path */
export function serveModule(req: Request, options: ModuleServerOptions): Promise<Response> {
  const url = new URL(req.url);

  return withSpan(
    "modules.serve",
    async (): Promise<Response> => {
      const startTime = performance.now();

      const {
        projectId,
        projectDir,
        adapter,
        dev = true,
        projectUUID,
        allowedImportDirs,
        reactVersion,
      } = options;

      const effectiveProjectId = projectUUID ?? projectId;
      const method = req.method.toUpperCase();
      const isHeadRequest = method === "HEAD";

      const secureFs = createSecureFs({
        baseDir: projectDir,
        adapter,
        context: "module-loading",
        contextOptions: { allowedImportDirs },
        throwOnError: false,
        onSecurityEvent: (event) => {
          if (event.type !== "validation-failed") return;
          logger.warn("Security validation failed", {
            operation: event.operation,
            path: event.path,
            error: event.error,
          });
        },
      });

      const debugUserAgent = req.headers.get("user-agent") ?? "";
      logger.debug("Request", {
        pathname: url.pathname,
        userAgent: debugUserAgent.slice(0, 50),
      });

      if (!DEV_MODULE_PREFIX.test(url.pathname)) {
        return createModuleResponse(method, "Module not found", HTTP_NOT_FOUND, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
        });
      }

      const snippetMatch = url.pathname.match(SNIPPET_MODULE_PREFIX);
      if (snippetMatch) {
        const hash = snippetMatch[1];
        if (!hash) {
          return createModuleResponse(method, "Missing snippet hash", HTTP_NOT_FOUND, {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache",
          });
        }

        const { getCompiledSnippetAsync } = await import(
          "#veryfront/rendering/snippet-renderer.ts"
        );
        const snippetCode = await getCompiledSnippetAsync(hash);

        if (!snippetCode) {
          logger.warn("Snippet not found in cache", { hash });
          return createModuleResponse(method, "Snippet not found", HTTP_NOT_FOUND, {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache",
          });
        }

        const { slug: snippetProjectSlug, branch: snippetBranch } = parseProjectDomain(url.host);

        const userAgent = req.headers.get("user-agent") ?? "";
        const isSSR = url.searchParams.get("ssr") === "true" || userAgent.startsWith("Deno/");

        logger.debug("Transforming snippet", {
          hash,
          isSSR,
          snippetProjectSlug,
          codeLength: snippetCode.length,
        });

        try {
          let transformedCode = await transformToESM(
            snippetCode,
            `_snippets/${hash}.tsx`,
            projectDir,
            adapter,
            { projectId: effectiveProjectId, dev, ssr: isSSR, reactVersion },
          );

          if (isSSR) {
            transformedCode = applySSRImportRewrites(transformedCode, {
              projectSlug: snippetProjectSlug,
              branch: snippetBranch,
            });
          }

          logger.debug("Snippet transformed", {
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
          logger.error("Snippet transform error", { hash, error: errorMsg });
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

      const versionedMatch = url.pathname.match(CROSS_PROJECT_VERSIONED_PREFIX);
      const latestMatch = url.pathname.match(CROSS_PROJECT_LATEST_PREFIX);

      if (versionedMatch || latestMatch) {
        const crossProjectSlug = versionedMatch?.[1] ?? latestMatch?.[1];
        const crossVersion = versionedMatch?.[2] ?? "latest";
        const crossPath = versionedMatch?.[3] ?? latestMatch?.[2];

        if (!crossProjectSlug || !crossPath) {
          return createModuleResponse(method, "Invalid cross-project import path", HTTP_NOT_FOUND, {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache",
          });
        }

        const projectRef = crossVersion === "latest"
          ? crossProjectSlug
          : `${crossProjectSlug}@${crossVersion}`;

        logger.debug("Cross-project import", {
          projectRef,
          path: crossPath,
          isLatest: crossVersion === "latest",
        });

        try {
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

          const userAgent = req.headers.get("user-agent") ?? "";
          const isSSR = url.searchParams.get("ssr") === "true" || userAgent.startsWith("Deno/");

          let code = await transformToESM(source, crossPath, projectDir, adapter, {
            projectId: effectiveProjectId,
            dev,
            ssr: isSSR,
            moduleServerUrl: `http://${url.host}`,
            reactVersion,
          });

          if (isSSR) {
            code = applySSRImportRewrites(code, { crossProjectRef: projectRef });
          }

          return createModuleResponse(method, code, HTTP_OK, {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-cache",
          });
        } catch (error) {
          logger.error("Cross-project error", { projectRef, error: String(error) });
          return createModuleResponse(method, `// Error: ${String(error)}`, HTTP_SERVER_ERROR, {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-cache",
          });
        }
      }

      let modulePath = url.pathname.replace(DEV_MODULE_PREFIX, "");
      modulePath = modulePath.replace(/^\/+/, "");
      if (modulePath.startsWith("_vf_modules/")) {
        modulePath = modulePath.slice("_vf_modules/".length);
      }
      if (modulePath.startsWith("@/")) modulePath = modulePath.slice(2);

      const filePathWithoutExt = modulePath.replace(/\.(?:mjs|js)$/i, "");

      let projectSlug = options.projectSlug ?? url.searchParams.get("project");
      let branch = options.branch ?? url.searchParams.get("branch");
      if (!projectSlug) {
        const parsedHost = parseProjectDomain(url.host);
        projectSlug = parsedHost.slug;
        branch ??= parsedHost.branch;
      }

      try {
        const findResult = await findSourceFile(secureFs, projectDir, filePathWithoutExt);
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

        const { path: sourceFile, isFrameworkFile, embeddedContent } = findResult;

        let code = "";

        if (!isHeadRequest) {
          // Use embedded content for compiled polyfills (no filesystem I/O needed)
          let source: string;
          if (embeddedContent) {
            source = embeddedContent;
            logger.debug("Using embedded polyfill content", {
              path: sourceFile,
              contentLength: embeddedContent.length,
            });
          } else {
            const platformFs = createFileSystem();
            source = isFrameworkFile
              ? await platformFs.readTextFile(sourceFile)
              : await secureFs.readFile(sourceFile);
          }

          const userAgent = req.headers.get("user-agent") ?? "";
          const isSSR = url.searchParams.get("ssr") === "true" || userAgent.startsWith("Deno/");

          const studioEmbed = url.searchParams.get("studio_embed") === "true";
          const isJsxFile = /\.(tsx|jsx)$/i.test(sourceFile);
          if (studioEmbed && !isFrameworkFile && isJsxFile) {
            source = injectNodePositions(source, { filePath: sourceFile });
          }

          logger.debug("SSR mode check", {
            isSSR,
            isDenoRequest: userAgent.startsWith("Deno/"),
            hasSSRParam: url.searchParams.get("ssr") === "true",
            userAgent: userAgent.slice(0, 30),
          });

          const transformOpts: TransformOptions = {
            projectId: effectiveProjectId,
            dev,
            ssr: isSSR,
            studioEmbed,
            reactVersion,
          };

          code = await transformToESM(source, sourceFile, projectDir, adapter, transformOpts);

          if (isSSR) {
            code = applySSRImportRewrites(code, { projectSlug, branch });
          }

          const hmrTimestamp = url.searchParams.get("t");
          if (hmrTimestamp) {
            code = await addHMRTimestamps(code, hmrTimestamp);
            logger.debug("HMR timestamp injection", {
              path: modulePath,
              timestamp: hmrTimestamp,
            });
          }
        }

        const headers = getDevModuleHeaders(modulePath);
        logger.debug("Request complete", {
          path: modulePath,
          durationMs: (performance.now() - startTime).toFixed(1),
        });

        return createModuleResponse(method, code, HTTP_OK, headers);
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error("Module transform error", { modulePath, error: errorMsg });

        const headers = getDevModuleHeaders(modulePath);
        const errorBody = createDevModuleErrorBody(modulePath, errorMsg);

        return createModuleResponse(method, errorBody, HTTP_SERVER_ERROR, headers);
      }
    },
    { "modules.path": url.pathname, "modules.projectSlug": options.projectSlug || "unknown" },
  );
}

const FRAMEWORK_ROOT = getFrameworkRootFromMeta(import.meta.url);

// Embedded source directory for compiled binaries (created by prepare-framework-sources.ts)
const EMBEDDED_SRC_DIR = join(FRAMEWORK_ROOT, "dist", "framework-src");

interface FindSourceFileResult {
  path: string;
  isFrameworkFile: boolean;
  /** Embedded content for compiled binaries (no filesystem access needed) */
  embeddedContent?: string;
}

async function findSourceFile(
  secureFs: ReturnType<typeof createSecureFs>,
  projectDir: string,
  basePath: string,
): Promise<FindSourceFileResult | null> {
  // Extensions including .src for compiled binary embedded sources
  const extensions = [
    ".tsx.src",
    ".ts.src",
    ".jsx.src",
    ".js.src",
    ".mdx.src",
    ".md.src", // Embedded sources
    ".tsx",
    ".ts",
    ".jsx",
    ".js",
    ".mdx",
    ".md", // Regular sources
  ];

  logger.debug("findSourceFile called", { projectDir, basePath });

  const hasKnownExt = extensions.some((ext) => basePath.endsWith(ext));
  const rawBasePathWithoutExt = hasKnownExt
    ? basePath.replace(/\.(tsx|ts|jsx|js|mdx|md)(\.src)?$/, "")
    : basePath;
  let basePathWithoutExt = rawBasePathWithoutExt.replace(/^\/+/, "");
  if (basePathWithoutExt.startsWith("_vf_modules/")) {
    basePathWithoutExt = basePathWithoutExt.slice("_vf_modules/".length);
  }

  const frameworkLookups: [string, string, string, boolean][] = [
    // Embedded sources for compiled binaries (.src extensions)
    ["_veryfront/", EMBEDDED_SRC_DIR, "_veryfront-embedded", true],
    ["_veryfront/", join(FRAMEWORK_ROOT, "src"), "_veryfront", true],
    // Fallback to projectDir for local dev/proxy setups where FRAMEWORK_ROOT may differ.
    ["_veryfront/", join(projectDir, "src"), "_veryfront-project", true],
  ];
  const isFrameworkPath = basePathWithoutExt.startsWith("_veryfront/");

  async function resolveFrameworkFile(
    lookups: [string, string, string, boolean][],
  ): Promise<FindSourceFileResult | null> {
    // In compiled binaries, check for embedded polyfills first (no filesystem access)
    if (isDenoCompiled) {
      const embeddedContent = EMBEDDED_POLYFILLS[basePathWithoutExt];
      if (embeddedContent) {
        logger.debug("Using embedded polyfill for compiled binary", {
          basePath: basePathWithoutExt,
        });
        return {
          path: `embedded:${basePathWithoutExt}`,
          isFrameworkFile: true,
          embeddedContent,
        };
      }
    }

    // Look for framework files using native filesystem (not secureFs which goes to API)
    const platformFs = createFileSystem();
    for (const [prefix, frameworkDir, label, stripPrefix] of lookups) {
      if (!basePathWithoutExt.startsWith(prefix)) continue;

      const pathWithinFramework = stripPrefix
        ? basePathWithoutExt.slice(prefix.length)
        : basePathWithoutExt;

      for (const ext of extensions) {
        const frameworkPath = join(frameworkDir, pathWithinFramework + ext);
        try {
          const stat = await platformFs.stat(frameworkPath);
          if (stat.isFile) {
            logger.debug(`Found framework ${label} file`, {
              basePath: basePathWithoutExt,
              resolvedPath: frameworkPath,
            });
            return { path: frameworkPath, isFrameworkFile: true };
          }
        } catch {
          // continue
        }
      }
    }

    return null;
  }

  if (isFrameworkPath) {
    const frameworkResult = await resolveFrameworkFile(frameworkLookups);
    if (frameworkResult) {
      return frameworkResult;
    }

    // Framework path not found locally - log warning and fall back to project lookups
    logger.warn("Framework file not found locally", {
      basePath: basePathWithoutExt,
      frameworkRoot: FRAMEWORK_ROOT,
    });
  }

  if (hasKnownExt) {
    const fullPath = join(projectDir, basePath);
    try {
      const stat = await secureFs.stat(fullPath);
      if (stat?.isFile) {
        logger.debug("Found file with existing extension", {
          basePath,
          resolvedPath: fullPath,
        });
        return { path: fullPath, isFrameworkFile: false };
      }
    } catch {
      // continue
    }
  }

  // Project file lookups (using secureFs which may go through FSAdapter in proxy mode)
  for (const ext of extensions) {
    const fullPath = join(projectDir, basePathWithoutExt + ext);
    try {
      const stat = await secureFs.stat(fullPath);
      if (stat.isFile) {
        logger.debug("Found file", { basePath, resolvedPath: fullPath });
        return { path: fullPath, isFrameworkFile: false };
      }
    } catch {
      // continue
    }
  }

  const prefixesToStrip = ["components/", "pages/", "lib/", "app/", "src/"];
  for (const prefix of prefixesToStrip) {
    if (!basePathWithoutExt.startsWith(prefix)) continue;

    const strippedPath = basePathWithoutExt.slice(prefix.length);
    for (const ext of extensions) {
      const fullPath = join(projectDir, strippedPath + ext);
      try {
        const stat = await secureFs.stat(fullPath);
        if (stat.isFile) {
          logger.debug("Found file after stripping prefix", {
            originalPath: basePathWithoutExt,
            strippedPath,
            resolvedPath: fullPath,
          });
          return { path: fullPath, isFrameworkFile: false };
        }
      } catch {
        // continue
      }
    }
  }

  for (const ext of extensions) {
    const fullPath = join(projectDir, basePathWithoutExt, `index${ext}`);
    try {
      const stat = await secureFs.stat(fullPath);
      if (stat.isFile) {
        logger.debug("Found index file", {
          basePath: basePathWithoutExt,
          resolvedPath: fullPath,
        });
        return { path: fullPath, isFrameworkFile: false };
      }
    } catch {
      // continue
    }
  }

  // Try looking in common project directories
  const commonDirs = ["components", "app", "pages", "lib", "src"];
  for (const dir of commonDirs) {
    for (const ext of extensions) {
      const fullPath = join(projectDir, dir, basePathWithoutExt + ext);
      try {
        const stat = await secureFs.stat(fullPath);
        if (stat.isFile) {
          logger.debug("Found file in common directory", {
            basePath,
            resolvedPath: fullPath,
          });
          return { path: fullPath, isFrameworkFile: false };
        }
      } catch {
        // continue
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
  return {
    "Content-Type": getDevModuleContentType(modulePath),
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
  return new Response(method === "HEAD" ? null : body, { status, headers });
}

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
    logger.warn("Cross-project fetch failed", {
      registryUrl,
      status: response.status,
    });
    return null;
  }

  return response.text();
}
