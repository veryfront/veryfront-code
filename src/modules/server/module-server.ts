/** Module Server - serves transformed ESM modules at /_vf_modules/* URLs */

import { join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { type TransformOptions, transformToESM } from "#veryfront/transforms/esm-transform.ts";
import { serverLogger, VERSION } from "#veryfront/utils";
import { HTTP_NOT_FOUND, HTTP_OK, HTTP_SERVER_ERROR } from "#veryfront/utils";
import { getContentTypeForPath } from "#veryfront/server/handlers/utils/content-types.ts";
import { createSecureFs } from "#veryfront/security";
import { getErrorMessage } from "#veryfront/errors";
import { getApiBaseUrlEnv } from "#veryfront/config/env.ts";
import {
  markRequestProfilePhase,
  metrics,
  type ModuleServeStatus,
  profilePhase,
} from "#veryfront/observability";
import { injectContext, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { injectNodePositions } from "#veryfront/transforms/plugins/babel-node-positions.ts";
import { parseProjectDomain } from "#veryfront/server/utils/domain-parser.ts";
import {
  applySSRImportRewritesAsync,
  resolveSSRImportTargetModulePath,
  type SSRImportRewriteTarget,
  stripSSRModuleJsExtension,
} from "./ssr-import-rewriter.ts";
import { addHMRTimestamps } from "#veryfront/transforms/esm/import-rewriter.ts";
import { replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";
import {
  FRAMEWORK_ROOT,
  resolveFrameworkSourcePath,
} from "#veryfront/platform/compat/framework-source-resolver.ts";
import { getReactUrls, REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { readLimitedCrossProjectSource } from "./cross-project-source-limit.ts";
import { sha256Short } from "#veryfront/cache/hash.ts";
import {
  getReleaseDependencyRewriteManifestState,
  hasReleaseDependencyImportSpecifiers,
  rewriteReleaseDependencyImportsForModule,
} from "#veryfront/release-assets/module-consumption.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import {
  RELEASE_ASSET_IMMUTABLE_MAX_AGE_SECONDS,
  RELEASE_MODULE_RUNTIME_VERSION_PARAM,
  RELEASE_MODULE_VERSION_PARAM,
} from "#veryfront/release-assets/constants.ts";
import {
  buildSourceMissCacheKey,
  hasSourceMiss,
  rememberSourceMiss,
} from "./module-source-resolution-cache.ts";
import {
  buildReleaseModuleResponseCacheKey,
  getReleaseModuleResponse,
  rememberReleaseModuleResponse,
} from "./module-response-cache.ts";
import { ensureFilenameDefaultExport } from "#veryfront/modules/loader-shared/filename-default-export.ts";

const logger = serverLogger.component("module-server");
const PROJECT_FALLBACK_EMBEDDED_POLYFILLS = new Set(["deno"]);

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
  // dnt build artifacts — no-op in browser. These imports are injected by
  // dnt when building the npm package and must resolve when the module
  // server serves framework files from the npm cache.
  "_veryfront/_dnt.shims": [
    `export const Deno = undefined;`,
    `export const dntGlobalThis = globalThis;`,
    // Re-export browser globals that dnt would normally shim from Node packages.
    // Methods like fetch/setTimeout must be bound — destructuring detaches them
    // from window, causing "Illegal invocation" when called.
    `export const fetch = globalThis.fetch.bind(globalThis);`,
    `export const setTimeout = globalThis.setTimeout.bind(globalThis);`,
    `export const setInterval = globalThis.setInterval.bind(globalThis);`,
    `export const { Request, Response, Headers, Blob, File, FormData, crypto } = globalThis;`,
    `export default {};`,
  ].join("\n") + "\n",
  "_veryfront/_dnt.polyfills": `export default {};\n`,
  // Relative imports from deeply nested modules (e.g. ../../../../_dnt.shims.js)
  // resolve to paths outside the _veryfront/ prefix. Register without prefix too.
  "_dnt.shims": [
    `export const Deno = undefined;`,
    `export const dntGlobalThis = globalThis;`,
    `export const fetch = globalThis.fetch.bind(globalThis);`,
    `export const setTimeout = globalThis.setTimeout.bind(globalThis);`,
    `export const setInterval = globalThis.setInterval.bind(globalThis);`,
    `export const { Request, Response, Headers, Blob, File, FormData, crypto } = globalThis;`,
    `export default {};`,
  ].join("\n") + "\n",
  "_dnt.polyfills": `export default {};\n`,
  // Deno import-map alias stub for browser/HTTP-served framework modules.
  // Must be a JS module (not JSON): a browser refuses a JSON module unless the
  // importer carries `with { type: "json" }`, so serving JS keeps the stub
  // independent of how far import attribute support has reached the browser.
  "_veryfront/_deno-config": `export default ${JSON.stringify({ version: VERSION })};\n`,
  // dnt rewrites #deno-config to relative deno.js in npm framework modules.
  "deno": `export default ${JSON.stringify({ version: VERSION })};\n`,
};

const DEV_MODULE_PREFIX = /^\/(?:_vf_modules|_veryfront\/modules)\//;
const SNIPPET_MODULE_PREFIX = /^\/_vf_modules\/_snippets\/([a-f0-9]+)\.js/;
// Cross-project import patterns: /_vf_modules/_cross/<slug>[@<version>]/@/<path>
const CROSS_PROJECT_VERSIONED_PREFIX =
  /^\/_vf_modules\/_cross\/([a-z0-9-]+)@([\d^~x][\d.x^~-]*)\/\@\/(.+)$/;
const CROSS_PROJECT_LATEST_PREFIX = /^\/_vf_modules\/_cross\/([a-z0-9-]+)\/\@\/(.+)$/;

function appendReleaseModuleVersion(url: string, releaseId: string): string {
  if (
    url.includes(`${RELEASE_MODULE_VERSION_PARAM}=`) ||
    url.includes(`${RELEASE_MODULE_RUNTIME_VERSION_PARAM}=`)
  ) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  const params = new URLSearchParams({
    [RELEASE_MODULE_VERSION_PARAM]: releaseId,
    [RELEASE_MODULE_RUNTIME_VERSION_PARAM]: VERSION,
  });
  return `${url}${separator}${params.toString()}`;
}

function shouldCacheReleaseVersionedModule(
  url: URL,
  options: ModuleServerOptions,
  isSSR: boolean,
): boolean {
  if (options.dev || options.mode === "preview" || isSSR || !options.releaseId) return false;
  if (url.searchParams.get("studio_embed") === "true" || url.searchParams.has("t")) return false;
  return url.searchParams.get(RELEASE_MODULE_VERSION_PARAM) === options.releaseId &&
    url.searchParams.get(RELEASE_MODULE_RUNTIME_VERSION_PARAM) === VERSION;
}

function isSSRModuleRequest(req: Request, url: URL): boolean {
  const userAgent = req.headers.get("user-agent") ?? "";
  return url.searchParams.get("ssr") === "true" || userAgent.startsWith("Deno/");
}

async function addReleaseVersionToFallbackImports(
  code: string,
  modulePath: string,
  releaseId: string | null | undefined,
): Promise<string> {
  if (!releaseId) return code;
  const moduleBaseUrl = `https://veryfront.local/_vf_modules/${modulePath}`;

  return await replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("/_vf_modules/")) {
      return appendReleaseModuleVersion(specifier, releaseId);
    }
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;

    const resolved = new URL(specifier, moduleBaseUrl);
    if (resolved.origin !== "https://veryfront.local") return null;
    if (!resolved.pathname.startsWith("/_vf_modules/")) return null;
    return appendReleaseModuleVersion(
      `${resolved.pathname}${resolved.search}${resolved.hash}`,
      releaseId,
    );
  });
}

interface SourceLookupContext {
  projectId?: string;
  projectSlug?: string | null;
  branch?: string | null;
  releaseId?: string | null;
  reactVersion?: string;
}

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
  /** Request mode ("preview" | "production") for studio features like node positions */
  mode?: string;
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
      const platformFs = createFileSystem();

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

        const isSSR = isSSRModuleRequest(req, url);

        logger.debug("Transforming snippet", {
          hash,
          isSSR,
          snippetProjectSlug,
          codeLength: snippetCode.length,
        });

        try {
          let transformedCode = await profileModuleTransform(() =>
            transformToESM(
              snippetCode,
              `_snippets/${hash}.tsx`,
              projectDir,
              adapter,
              { projectId: effectiveProjectId, dev, ssr: isSSR, reactVersion },
            )
          );

          if (isSSR) {
            transformedCode = await applySSRImportRewritesAsync(transformedCode, {
              projectSlug: snippetProjectSlug,
              branch: snippetBranch,
              resolveCacheBuster: createSSRTargetCacheBusterResolver({
                secureFs,
                projectDir,
                currentModulePath: `_snippets/${hash}.js`,
                projectId: effectiveProjectId,
                projectSlug: snippetProjectSlug,
                branch: snippetBranch,
                releaseId: options.releaseId,
                reactVersion,
              }),
            });
          } else {
            transformedCode = await rewriteReleaseDependencyImportsForModule(transformedCode, {
              releaseId: options.releaseId,
              readDependencySource: (path) => platformFs.readTextFile(path),
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

          const isSSR = isSSRModuleRequest(req, url);

          let code = await profileModuleTransform(() =>
            transformToESM(source, crossPath, projectDir, adapter, {
              projectId: effectiveProjectId,
              dev,
              ssr: isSSR,
              moduleServerUrl: `http://${url.host}`,
              reactVersion,
            })
          );

          if (isSSR) {
            code = await applySSRImportRewritesAsync(code, {
              crossProjectRef: projectRef,
              resolveCacheBuster: createSSRTargetCacheBusterResolver({
                secureFs,
                projectDir,
                currentModulePath: crossPath,
                crossProjectRef: projectRef,
                projectId: effectiveProjectId,
                releaseId: options.releaseId,
                reactVersion,
              }),
            });
          } else {
            code = await rewriteReleaseDependencyImportsForModule(code, {
              releaseId: options.releaseId,
              readDependencySource: (path) => platformFs.readTextFile(path),
            });
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

      const isSSR = isSSRModuleRequest(req, url);
      const canUseReleaseModuleResponseCache = method === "GET" || method === "HEAD";
      const canCacheReleaseVersionedModule = canUseReleaseModuleResponseCache &&
        shouldCacheReleaseVersionedModule(url, options, isSSR);
      let releaseDependencyManifest: ReleaseAssetManifest | null = null;
      let releaseDependencyManifestVersion: number | null = null;
      let releaseDependencyRewriteEnabled = false;
      if (canCacheReleaseVersionedModule) {
        const manifestState = await getReleaseDependencyRewriteManifestState(options.releaseId, {
          refreshCachedNull: true,
        });
        if (manifestState.enabled) {
          releaseDependencyRewriteEnabled = true;
          releaseDependencyManifest = manifestState.manifest;
          releaseDependencyManifestVersion = manifestState.manifest?.manifestVersion ?? null;
        }
      }
      const releaseModuleResponseCacheKey = canCacheReleaseVersionedModule
        ? buildReleaseModuleResponseCacheKey({
          projectIdentity: effectiveProjectId,
          projectDir,
          projectSlug,
          branch,
          releaseId: options.releaseId!,
          runtimeVersion: VERSION,
          reactVersion,
          releaseDependencyManifestVersion,
          modulePath,
        })
        : null;

      if (releaseModuleResponseCacheKey) {
        const cachedResponse = await getReleaseModuleResponse(releaseModuleResponseCacheKey);
        if (cachedResponse?.entry) {
          const canUseCachedResponse = !releaseDependencyRewriteEnabled ||
            !(await hasReleaseDependencyImportSpecifiers(cachedResponse.entry.body));
          if (canUseCachedResponse) {
            markRequestProfilePhase("module.response_cache_hit");
            if (cachedResponse.source === "distributed") {
              markRequestProfilePhase("module.response_cache_distributed_hit");
            }
            return createModuleResponse(
              method,
              cachedResponse.entry.body,
              cachedResponse.entry.status,
              Object.fromEntries(cachedResponse.entry.headers),
            );
          }
          markRequestProfilePhase("module.response_cache_dependency_blocked");
        }
        markRequestProfilePhase("module.response_cache_miss");
      }

      try {
        const findResult = await profilePhase(
          "module.source_lookup",
          () =>
            findSourceFile(
              secureFs,
              projectDir,
              filePathWithoutExt,
              {
                projectId: effectiveProjectId,
                projectSlug,
                branch,
                releaseId: options.releaseId,
                reactVersion,
              },
              modulePath,
            ),
        );
        if (!findResult) {
          logger.warn("Module not found", {
            modulePath,
            filePathWithoutExt,
            projectSlug,
            projectDir,
          });
          return createModuleResponse(method, "Module not found", HTTP_NOT_FOUND, {
            "Content-Type": "text/plain",
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
            source = isFrameworkFile
              ? await platformFs.readTextFile(sourceFile)
              : await secureFs.readFile(sourceFile);
          }

          const userAgent = req.headers.get("user-agent") ?? "";

          const studioEmbed = url.searchParams.get("studio_embed") === "true";
          const shouldInjectPositions = dev || options.mode === "preview";
          const isJsxFile = /\.(tsx|jsx)$/i.test(sourceFile);
          if (shouldInjectPositions && !isFrameworkFile && isJsxFile) {
            const relativeFilePath = sourceFile.startsWith(projectDir)
              ? sourceFile.slice(projectDir.length).replace(/^\/+/, "")
              : sourceFile;
            source = injectNodePositions(source, { filePath: relativeFilePath });
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

          code = await profileModuleTransform(() =>
            transformToESM(source, sourceFile, projectDir, adapter, transformOpts)
          );
          code = ensureFilenameDefaultExport(modulePath, code);

          if (isSSR) {
            code = await applySSRImportRewritesAsync(code, {
              projectSlug,
              branch,
              resolveCacheBuster: createSSRTargetCacheBusterResolver({
                secureFs,
                projectDir,
                currentModulePath: modulePath,
                projectId: effectiveProjectId,
                projectSlug,
                branch,
                releaseId: options.releaseId,
                reactVersion,
              }),
            });
          }

          const hmrTimestamp = url.searchParams.get("t");
          if (hmrTimestamp) {
            code = await addHMRTimestamps(code, hmrTimestamp);
            logger.debug("HMR timestamp injection", {
              path: modulePath,
              timestamp: hmrTimestamp,
            });
          }

          if (!isSSR) {
            code = await rewriteReleaseDependencyImportsForModule(code, {
              releaseId: options.releaseId,
              manifest: releaseDependencyRewriteEnabled ? releaseDependencyManifest : undefined,
              manifestReadOptions: { refreshCachedNull: true },
              readDependencySource: (path) => platformFs.readTextFile(path),
            });
            code = await addReleaseVersionToFallbackImports(code, modulePath, options.releaseId);
          }
        }

        const hasUnrewrittenReleaseDependencyImports = releaseDependencyRewriteEnabled &&
          await hasReleaseDependencyImportSpecifiers(code);
        const canCacheModuleResponse = releaseModuleResponseCacheKey !== null &&
          !hasUnrewrittenReleaseDependencyImports;
        if (hasUnrewrittenReleaseDependencyImports) {
          markRequestProfilePhase("module.response_cache_dependency_blocked");
        }
        const headers = getModuleHeaders(modulePath, {
          cacheable: canCacheModuleResponse,
        });
        logger.debug("Request complete", {
          path: modulePath,
          durationMs: (performance.now() - startTime).toFixed(1),
        });

        if (canCacheModuleResponse && method === "GET") {
          void rememberReleaseModuleResponse(releaseModuleResponseCacheKey, {
            body: code,
            status: HTTP_OK,
            headers: Object.entries(headers),
          });
          markRequestProfilePhase("module.response_cache_store");
        }

        return createModuleResponse(method, code, HTTP_OK, headers);
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error("Module transform error", { modulePath, error: errorMsg });

        const headers = getModuleHeaders(modulePath);
        const errorBody = createDevModuleErrorBody(modulePath, errorMsg);

        return createModuleResponse(method, errorBody, HTTP_SERVER_ERROR, headers);
      }
    },
    { "modules.path": url.pathname, "modules.projectSlug": options.projectSlug || "unknown" },
  );
}

interface FindSourceFileResult {
  path: string;
  isFrameworkFile: boolean;
  /** Embedded content for compiled binaries (no filesystem access needed) */
  embeddedContent?: string;
}

async function readSourceFileForVersion(
  secureFs: ReturnType<typeof createSecureFs>,
  findResult: FindSourceFileResult,
): Promise<string> {
  if (findResult.embeddedContent !== undefined) return findResult.embeddedContent;

  const platformFs = createFileSystem();
  return findResult.isFrameworkFile
    ? await platformFs.readTextFile(findResult.path)
    : await secureFs.readFile(findResult.path);
}

function createSSRTargetCacheBusterResolver(options: {
  secureFs: ReturnType<typeof createSecureFs>;
  projectDir: string;
  currentModulePath: string;
  crossProjectRef?: string;
  projectId?: string;
  projectSlug?: string | null;
  branch?: string | null;
  releaseId?: string | null;
  reactVersion?: string;
}): (target: SSRImportRewriteTarget) => Promise<string | undefined> {
  const versions = new Map<string, Promise<string | undefined>>();

  return (target) => {
    const targetPath = resolveSSRImportTargetModulePath(target, options.currentModulePath);
    const key = `${options.crossProjectRef ?? "local"}\0${targetPath}`;
    let promise = versions.get(key);
    if (!promise) {
      promise = (async () => {
        if (options.crossProjectRef) {
          const source = await fetchCrossProjectSource(options.crossProjectRef, targetPath);
          return source === null ? undefined : await sha256Short(`${targetPath}\0${source}`);
        }

        const findResult = await findSourceFile(
          options.secureFs,
          options.projectDir,
          stripSSRModuleJsExtension(targetPath),
          {
            projectId: options.projectId,
            projectSlug: options.projectSlug,
            branch: options.branch,
            releaseId: options.releaseId,
            reactVersion: options.reactVersion,
          },
          targetPath,
        );
        if (!findResult) return undefined;

        const source = await readSourceFileForVersion(options.secureFs, findResult);
        return await sha256Short(`${findResult.path}\0${source}`);
      })();
      versions.set(key, promise);
    }
    return promise;
  };
}

const REACT_PACKAGE_ASSET_SPECIFIERS: Record<string, string> = {
  "react/react": "react",
  "react/react-dom": "react-dom",
  "react/react-dom-client": "react-dom/client",
  "react/react-dom-server": "react-dom/server",
  "react/jsx-runtime": "react/jsx-runtime",
  "react/jsx-dev-runtime": "react/jsx-dev-runtime",
};

function hasUnsafePackageAssetPath(path: string): boolean {
  return path.includes("\0") || path.includes("%") || /(^|[/\\])\.\.([/\\]|$)/.test(path);
}

function createBrowserReactPackageShim(
  basePathWithoutExt: string,
  reactVersion = REACT_DEFAULT_VERSION,
): string | null {
  const specifier = REACT_PACKAGE_ASSET_SPECIFIERS[basePathWithoutExt];
  if (!specifier) return null;

  const url = getReactUrls(reactVersion)[specifier];
  if (!url) return null;

  const defaultExport = specifier === "react" ||
      specifier === "react-dom" ||
      specifier === "react-dom/client" ||
      specifier === "react-dom/server"
    ? `export { default } from ${JSON.stringify(url)};\n`
    : "";

  return `export * from ${JSON.stringify(url)};\n${defaultExport}`;
}

async function findFrameworkPackageAssetFile(
  fs: ReturnType<typeof createFileSystem>,
  basePathWithoutExt: string,
  extensions: readonly string[],
): Promise<string | null> {
  if (hasUnsafePackageAssetPath(basePathWithoutExt)) return null;

  return await findFirstPlatformFile(
    fs,
    extensions.map((ext) => join(FRAMEWORK_ROOT, basePathWithoutExt + ext)),
  );
}

async function findFirstPlatformFile(
  fs: ReturnType<typeof createFileSystem>,
  paths: string[],
): Promise<string | null> {
  const results = await Promise.all(paths.map(async (path) => {
    try {
      const stat = await fs.stat(path);
      return stat.isFile ? path : null;
    } catch {
      return null;
    }
  }));

  return results.find((path): path is string => path !== null) ?? null;
}

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

async function findSourceFile(
  secureFs: ReturnType<typeof createSecureFs>,
  projectDir: string,
  basePath: string,
  context: SourceLookupContext,
  requestedModulePath = basePath,
): Promise<FindSourceFileResult | null> {
  const { reactVersion } = context;
  // Extensions including .src for compiled binary embedded sources
  const extensions = [
    ".json",
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

  const knownExtMatch = basePath.match(/\.(json|tsx|ts|jsx|js|mdx|md)(\.src)?$/);
  const requestedExtMatch = requestedModulePath.match(/\.(json|tsx|ts|jsx|js|mdx|md)(\.src)?$/);
  const hasKnownExt = knownExtMatch !== null;
  const requestedExt = requestedExtMatch?.[1] ?? knownExtMatch?.[1] ?? null;
  const rawBasePathWithoutExt = hasKnownExt
    ? basePath.replace(/\.(json|tsx|ts|jsx|js|mdx|md)(\.src)?$/, "")
    : basePath;
  let basePathWithoutExt = rawBasePathWithoutExt.replace(/^\/+/, "");
  if (basePathWithoutExt.startsWith("_vf_modules/")) {
    basePathWithoutExt = basePathWithoutExt.slice("_vf_modules/".length);
  }

  const isFrameworkPath = basePathWithoutExt.startsWith("_veryfront/");
  const isFrameworkPackageAssetPath = basePathWithoutExt.startsWith("react/") ||
    basePathWithoutExt.startsWith("deps/");
  const missCacheKey = buildSourceMissCacheKey({
    resolver: "module-server",
    projectDir,
    projectId: context.projectId,
    projectSlug: context.projectSlug,
    branch: context.branch,
    releaseId: context.releaseId,
    basePath: basePathWithoutExt,
    reactVersion,
  });

  // Check embedded polyfills first (no filesystem access needed).
  // These cover both compiled-binary polyfills (node:async_hooks etc.)
  // and dnt build artifacts (_dnt.shims, _dnt.polyfills) that don't
  // exist as source files but are imported by npm-cached framework modules.
  // Note: checked before isFrameworkPath guard because relative imports from
  // deeply nested modules (e.g. ../../../../_dnt.shims.js) resolve outside
  // the _veryfront/ prefix.
  const embeddedContent = PROJECT_FALLBACK_EMBEDDED_POLYFILLS.has(basePathWithoutExt)
    ? undefined
    : EMBEDDED_POLYFILLS[basePathWithoutExt];
  if (embeddedContent) {
    logger.debug("Using embedded polyfill", {
      basePath: basePathWithoutExt,
    });
    return {
      path: `embedded:${basePath}`,
      isFrameworkFile: true,
      embeddedContent,
    };
  }

  if (hasSourceMiss(missCacheKey)) return null;

  if (isFrameworkPackageAssetPath) {
    const browserReactShim = createBrowserReactPackageShim(basePathWithoutExt, reactVersion);
    if (browserReactShim) {
      return {
        path: `embedded:${basePathWithoutExt}.js`,
        isFrameworkFile: true,
        embeddedContent: browserReactShim,
      };
    }

    const packageAssetPath = await findFrameworkPackageAssetFile(
      createFileSystem(),
      basePathWithoutExt,
      extensions,
    );
    if (packageAssetPath) {
      return { path: packageAssetPath, isFrameworkFile: true };
    }
  }

  if (isFrameworkPath) {
    const frameworkResult = await resolveFrameworkSourcePath(
      basePathWithoutExt.slice("_veryfront/".length),
      {
        extraLookupDirs: [join(projectDir, "src")],
        extensions,
      },
    );
    if (frameworkResult) {
      logger.debug("Found framework source file", {
        basePath: basePathWithoutExt,
        resolvedPath: frameworkResult.path,
        lookupDir: frameworkResult.lookupDir,
      });
      return { path: frameworkResult.path, isFrameworkFile: true };
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
    } catch (_) {
      /* expected: file may not exist at this path */
    }
  }

  const projectLookupExtensions = requestedExt !== null && requestedExt !== "json"
    ? extensions.filter((ext) => ext !== ".json")
    : extensions;

  // Project file lookups (using secureFs which may go through FSAdapter in proxy mode)
  const projectFilePath = await findFirstSecureFile(
    secureFs,
    projectLookupExtensions.map((ext) => join(projectDir, basePathWithoutExt + ext)),
  );
  if (projectFilePath) {
    logger.debug("Found file", { basePath, resolvedPath: projectFilePath });
    return { path: projectFilePath, isFrameworkFile: false };
  }

  const prefixesToStrip = ["components/", "pages/", "lib/", "app/", "src/"];
  for (const prefix of prefixesToStrip) {
    if (!basePathWithoutExt.startsWith(prefix)) continue;

    const strippedPath = basePathWithoutExt.slice(prefix.length);
    const strippedFilePath = await findFirstSecureFile(
      secureFs,
      projectLookupExtensions.map((ext) => join(projectDir, strippedPath + ext)),
    );
    if (strippedFilePath) {
      logger.debug("Found file after stripping prefix", {
        originalPath: basePathWithoutExt,
        strippedPath,
        resolvedPath: strippedFilePath,
      });
      return { path: strippedFilePath, isFrameworkFile: false };
    }
  }

  const indexFilePath = await findFirstSecureFile(
    secureFs,
    projectLookupExtensions.map((ext) => join(projectDir, basePathWithoutExt, `index${ext}`)),
  );
  if (indexFilePath) {
    logger.debug("Found index file", {
      basePath: basePathWithoutExt,
      resolvedPath: indexFilePath,
    });
    return { path: indexFilePath, isFrameworkFile: false };
  }

  // Try looking in common project directories
  const commonDirs = ["components", "app", "pages", "lib", "src"];
  for (const dir of commonDirs) {
    const commonDirFilePath = await findFirstSecureFile(
      secureFs,
      projectLookupExtensions.map((ext) => join(projectDir, dir, basePathWithoutExt + ext)),
    );
    if (commonDirFilePath) {
      logger.debug("Found file in common directory", {
        basePath,
        resolvedPath: commonDirFilePath,
      });
      return { path: commonDirFilePath, isFrameworkFile: false };
    }
  }

  const projectFallbackEmbeddedContent = EMBEDDED_POLYFILLS[basePathWithoutExt];
  if (projectFallbackEmbeddedContent) {
    logger.debug("Using embedded polyfill after project lookup", {
      basePath: basePathWithoutExt,
    });
    return {
      path: `embedded:${basePath}`,
      isFrameworkFile: true,
      embeddedContent: projectFallbackEmbeddedContent,
    };
  }

  rememberSourceMiss(missCacheKey);
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

function getModuleHeaders(
  modulePath: string,
  options: { cacheable?: boolean } = {},
): Record<string, string> {
  return {
    "Content-Type": getDevModuleContentType(modulePath),
    "Cache-Control": options.cacheable
      ? `public, max-age=${RELEASE_ASSET_IMMUTABLE_MAX_AGE_SECONDS}, immutable`
      : "no-cache",
  };
}

/** Source extensions the module server compiles to JavaScript before serving. */
const COMPILED_TO_JS_EXTENSIONS = /\.(?:tsx?|jsx|mdx|md)$/;

/**
 * Content type for a dev module response.
 *
 * Exported for testing.
 */
export function getDevModuleContentType(modulePath: string): string {
  const normalizedPath = modulePath.toLowerCase();
  // The import rewriter appends `.js` to any specifier whose extension it does
  // not recognise, so `@/lib/data.json` arrives here as `lib/data.json.js`
  // while the source file, and therefore the body, is still raw JSON. Resolve
  // the source extension the same way the module lookup does before deciding.
  const sourcePath = normalizedPath.replace(/\.(?:mjs|js)$/, "");

  if (sourcePath.endsWith(".map") || sourcePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }

  if (sourcePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }

  // The request path can carry a source extension, but the body served for one
  // is the compiled JavaScript. Typing the response from the source extension
  // yields `application/typescript`, which browsers refuse to execute as a
  // module under strict MIME checking.
  if (COMPILED_TO_JS_EXTENSIONS.test(sourcePath)) {
    return "application/javascript; charset=utf-8";
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

async function profileModuleTransform<T>(fn: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    return await profilePhase("module.transform", fn);
  } finally {
    metrics.recordModuleTransform(performance.now() - startedAt);
  }
}

function classifyModuleServeStatus(status: number): ModuleServeStatus {
  if (status >= 200 && status < 300) return "ok";
  if (status === HTTP_NOT_FOUND) return "not_found";
  return "error";
}

function createModuleResponse(
  method: string,
  body: string,
  status: number,
  headers: Record<string, string>,
): Response {
  metrics.recordModuleServe(classifyModuleServeStatus(status));
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

  try {
    return await readLimitedCrossProjectSource(response, registryUrl);
  } catch (error) {
    logger.warn("Cross-project source too large", {
      registryUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
