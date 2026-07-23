/** Module Server - serves transformed ESM modules at /_vf_modules/* URLs */

import { join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { type TransformOptions, transformToESM } from "#veryfront/transforms/esm-transform.ts";
import { serverLogger, VERSION } from "#veryfront/utils";
import { HTTP_BAD_REQUEST, HTTP_NOT_FOUND, HTTP_OK, HTTP_SERVER_ERROR } from "#veryfront/utils";
import { getContentTypeForPath } from "#veryfront/server/handlers/utils/content-types.ts";
import { createSecureFs } from "#veryfront/security";
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
import { HTTP_FETCH_TIMEOUT_MS, HTTP_METHOD_NOT_ALLOWED } from "#veryfront/utils/constants/http.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const logger = serverLogger.component("module-server");
const PROJECT_FALLBACK_EMBEDDED_POLYFILLS = new Set(["deno"]);
const MAX_MODULE_PATH_LENGTH = 2_048;
const MAX_QUERY_IDENTITY_LENGTH = 512;
const MAX_MODULE_SOURCE_BYTES = 5 * 1024 * 1024;

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
  // Must be a JS module (not JSON) because esbuild strips `with { type: "json" }`
  // at es2020 target, and browsers reject JSON MIME type without the assertion.
  "_veryfront/_deno-config": `export default ${JSON.stringify({ version: VERSION })};\n`,
  // dnt rewrites #deno-config to relative deno.js in npm framework modules.
  "deno": `export default ${JSON.stringify({ version: VERSION })};\n`,
};

const DEV_MODULE_PREFIX = /^\/(?:_vf_modules|_veryfront\/modules)\//;
const SNIPPET_MODULE_PREFIX = /^\/_vf_modules\/_snippets\/([a-f0-9]+)\.js$/;
// Cross-project import patterns: /_vf_modules/_cross/<slug>[@<version>]/@/<path>
const CROSS_PROJECT_VERSIONED_PREFIX =
  /^\/_vf_modules\/_cross\/([a-z0-9-]+)@([\d^~x][\d.x^~-]*)\/\@\/(.+)$/;
const CROSS_PROJECT_LATEST_PREFIX = /^\/_vf_modules\/_cross\/([a-z0-9-]+)\/\@\/(.+)$/;

function decodeAndValidateModulePathname(pathname: string): string | null {
  if (pathname.length > MAX_MODULE_PATH_LENGTH + 64 || /%2f|%5c/i.test(pathname)) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (!DEV_MODULE_PREFIX.test(decoded)) return decoded;
  const modulePath = decoded.replace(DEV_MODULE_PREFIX, "");
  if (
    modulePath.length === 0 || modulePath.length > MAX_MODULE_PATH_LENGTH ||
    modulePath.includes("\\") || modulePath.includes("%") ||
    hasUnsafeControlCharacters(modulePath) || /[\u2028\u2029]/.test(modulePath)
  ) {
    return null;
  }

  const segments = modulePath.split("/");
  return segments.some((segment) => segment === "" || segment === "." || segment === "..")
    ? null
    : decoded;
}

function hasInvalidQueryIdentity(value: string | null): boolean {
  return value !== null &&
    (value.length > MAX_QUERY_IDENTITY_LENGTH || hasUnsafeControlCharacters(value));
}

function assertModuleSourceSize(source: string): string {
  if (new TextEncoder().encode(source).byteLength > MAX_MODULE_SOURCE_BYTES) {
    throw new Error("Module source exceeds the supported size");
  }
  return source;
}

async function readBoundedModuleSource(
  stat: () => Promise<{ isFile: boolean; size: number }>,
  read: () => Promise<string>,
): Promise<string> {
  const info = await stat();
  if (!info.isFile || info.size < 0 || info.size > MAX_MODULE_SOURCE_BYTES) {
    throw new Error("Module source exceeds the supported size");
  }
  return assertModuleSourceSize(await read());
}

function readPlatformModuleSource(
  platformFs: ReturnType<typeof createFileSystem>,
  path: string,
): Promise<string> {
  return readBoundedModuleSource(
    () => platformFs.stat(path),
    () => platformFs.readTextFile(path),
  );
}

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

      const decodedPathname = decodeAndValidateModulePathname(url.pathname);
      if (decodedPathname === null) {
        return createModuleResponse(method, "Invalid module path", HTTP_BAD_REQUEST, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
        });
      }

      if (!DEV_MODULE_PREFIX.test(decodedPathname)) {
        return createModuleResponse(method, "Module not found", HTTP_NOT_FOUND, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
        });
      }

      if (method !== "GET" && method !== "HEAD") {
        return createModuleResponse(method, "Method not allowed", HTTP_METHOD_NOT_ALLOWED, {
          "Allow": "GET, HEAD",
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
        });
      }

      if (
        hasInvalidQueryIdentity(url.searchParams.get("project")) ||
        hasInvalidQueryIdentity(url.searchParams.get("branch")) ||
        hasInvalidQueryIdentity(url.searchParams.get("t"))
      ) {
        return createModuleResponse(method, "Invalid query parameter", HTTP_BAD_REQUEST, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
        });
      }

      const secureFs = createSecureFs({
        baseDir: projectDir,
        adapter,
        context: "module-loading",
        contextOptions: { allowedImportDirs },
        throwOnError: false,
      });
      const platformFs = createFileSystem();

      const snippetMatch = decodedPathname.match(SNIPPET_MODULE_PREFIX);
      if (decodedPathname.startsWith("/_vf_modules/_snippets/") && !snippetMatch) {
        return createModuleResponse(method, "Snippet not found", HTTP_NOT_FOUND, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
        });
      }
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
        const snippetCode = await getCompiledSnippetAsync(hash, effectiveProjectId);

        if (!snippetCode) {
          logger.warn("Snippet not found in cache");
          return createModuleResponse(method, "Snippet not found", HTTP_NOT_FOUND, {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache",
          });
        }
        assertModuleSourceSize(snippetCode);

        const { slug: snippetProjectSlug, branch: snippetBranch } = parseProjectDomain(url.host);

        const isSSR = isSSRModuleRequest(req, url);

        logger.debug("Transforming snippet", { isSSR, codeLength: snippetCode.length });

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
                signal: req.signal,
              }),
            });
          } else {
            transformedCode = await rewriteReleaseDependencyImportsForModule(transformedCode, {
              releaseId: options.releaseId,
              readDependencySource: (path) => readPlatformModuleSource(platformFs, path),
            });
          }

          logger.debug("Snippet transformed", { isSSR, transformedLength: transformedCode.length });

          return createModuleResponse(method, transformedCode, HTTP_OK, {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-cache",
          });
        } catch (error) {
          logger.error("Snippet transform error", {
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
          return createModuleResponse(
            method,
            `// Transform Error\nthrow new Error("Module transformation failed");`,
            HTTP_SERVER_ERROR,
            {
              "Content-Type": "application/javascript; charset=utf-8",
              "Cache-Control": "no-cache",
            },
          );
        }
      }

      const versionedMatch = decodedPathname.match(CROSS_PROJECT_VERSIONED_PREFIX);
      const latestMatch = decodedPathname.match(CROSS_PROJECT_LATEST_PREFIX);

      if (decodedPathname.startsWith("/_vf_modules/_cross/") && !versionedMatch && !latestMatch) {
        return createModuleResponse(method, "Invalid cross-project import path", HTTP_BAD_REQUEST, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
        });
      }

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

        logger.debug("Cross-project import", { isLatest: crossVersion === "latest" });

        try {
          const source = await fetchCrossProjectSource(projectRef, crossPath, req.signal);
          if (!source) {
            return createModuleResponse(
              method,
              "Cross-project module not found",
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
              moduleServerUrl: url.origin,
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
                signal: req.signal,
              }),
            });
          } else {
            code = await rewriteReleaseDependencyImportsForModule(code, {
              releaseId: options.releaseId,
              readDependencySource: (path) => readPlatformModuleSource(platformFs, path),
            });
          }

          return createModuleResponse(method, code, HTTP_OK, {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-cache",
          });
        } catch (error) {
          logger.error("Cross-project transform error", {
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
          return createModuleResponse(
            method,
            `throw new Error("Cross-project module transformation failed");`,
            HTTP_SERVER_ERROR,
            {
              "Content-Type": "application/javascript; charset=utf-8",
              "Cache-Control": "no-cache",
            },
          );
        }
      }

      let modulePath = decodedPathname.replace(DEV_MODULE_PREFIX, "");
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
          logger.debug("Module source not found");
          return createModuleResponse(method, "Module not found", HTTP_NOT_FOUND, {
            "Content-Type": "text/plain",
          });
        }

        const { path: sourceFile, isFrameworkFile, embeddedContent } = findResult;

        let code = "";

        // Transform HEAD requests too so their status and headers match GET.
        let source: string;
        if (embeddedContent) {
          source = assertModuleSourceSize(embeddedContent);
          logger.debug("Using embedded polyfill content", {
            contentLength: embeddedContent.length,
          });
        } else {
          source = isFrameworkFile
            ? await readPlatformModuleSource(platformFs, sourceFile)
            : await readBoundedModuleSource(
              () => secureFs.stat(sourceFile),
              () => secureFs.readFile(sourceFile),
            );
        }

        const studioEmbed = url.searchParams.get("studio_embed") === "true";
        const shouldInjectPositions = dev || options.mode === "preview";
        const isJsxFile = /\.(tsx|jsx)$/i.test(sourceFile);
        if (shouldInjectPositions && !isFrameworkFile && isJsxFile) {
          const relativeFilePath = sourceFile.startsWith(projectDir)
            ? sourceFile.slice(projectDir.length).replace(/^\/+/, "")
            : sourceFile;
          source = injectNodePositions(source, { filePath: relativeFilePath });
        }

        logger.debug("SSR mode check", { isSSR });

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
              signal: req.signal,
            }),
          });
        }

        const hmrTimestamp = url.searchParams.get("t");
        if (hmrTimestamp) {
          code = await addHMRTimestamps(code, hmrTimestamp);
          logger.debug("HMR timestamp injection applied");
        }

        if (!isSSR) {
          code = await rewriteReleaseDependencyImportsForModule(code, {
            releaseId: options.releaseId,
            manifest: releaseDependencyRewriteEnabled ? releaseDependencyManifest : undefined,
            manifestReadOptions: { refreshCachedNull: true },
            readDependencySource: (path) => readPlatformModuleSource(platformFs, path),
          });
          code = await addReleaseVersionToFallbackImports(code, modulePath, options.releaseId);
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
        logger.error("Module transform error", {
          errorName: error instanceof Error ? error.name : "UnknownError",
        });

        const headers = getModuleHeaders(modulePath);
        const errorBody = createDevModuleErrorBody(modulePath);

        return createModuleResponse(method, errorBody, HTTP_SERVER_ERROR, headers);
      }
    },
    {},
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
  if (findResult.embeddedContent !== undefined) {
    return assertModuleSourceSize(findResult.embeddedContent);
  }

  const platformFs = createFileSystem();
  return findResult.isFrameworkFile
    ? await readPlatformModuleSource(platformFs, findResult.path)
    : await readBoundedModuleSource(
      () => secureFs.stat(findResult.path),
      () => secureFs.readFile(findResult.path),
    );
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
  signal?: AbortSignal;
}): (target: SSRImportRewriteTarget) => Promise<string | undefined> {
  const versions = new Map<string, Promise<string | undefined>>();

  return (target) => {
    const targetPath = resolveSSRImportTargetModulePath(target, options.currentModulePath);
    const key = `${options.crossProjectRef ?? "local"}\0${targetPath}`;
    let promise = versions.get(key);
    if (!promise) {
      promise = (async () => {
        if (options.crossProjectRef) {
          const source = await fetchCrossProjectSource(
            options.crossProjectRef,
            targetPath,
            options.signal,
          );
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
  for (const path of paths) {
    try {
      const stat = await fs.stat(path);
      if (stat.isFile) return path;
    } catch {
      // Try the next source extension.
    }
  }
  return null;
}

async function findFirstSecureFile(
  secureFs: ReturnType<typeof createSecureFs>,
  paths: string[],
): Promise<string | null> {
  for (const path of paths) {
    try {
      const stat = await secureFs.stat(path);
      if (stat.isFile) return path;
    } catch {
      // Try the next source extension.
    }
  }
  return null;
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
      return { path: frameworkResult.path, isFrameworkFile: true };
    }

    logger.warn("Framework source file not found locally");
  }

  if (hasKnownExt) {
    const fullPath = join(projectDir, basePath);
    try {
      const stat = await secureFs.stat(fullPath);
      if (stat?.isFile) {
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
      return { path: strippedFilePath, isFrameworkFile: false };
    }
  }

  const indexFilePath = await findFirstSecureFile(
    secureFs,
    projectLookupExtensions.map((ext) => join(projectDir, basePathWithoutExt, `index${ext}`)),
  );
  if (indexFilePath) {
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
      return { path: commonDirFilePath, isFrameworkFile: false };
    }
  }

  const projectFallbackEmbeddedContent = EMBEDDED_POLYFILLS[basePathWithoutExt];
  if (projectFallbackEmbeddedContent) {
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

function createDevModuleErrorBody(modulePath: string): string {
  const normalizedPath = modulePath.toLowerCase();

  if (normalizedPath.endsWith(".css")) {
    return "/* Module transformation failed */";
  }

  if (normalizedPath.endsWith(".json") || normalizedPath.endsWith(".map")) {
    return JSON.stringify({ error: "Module transformation failed" });
  }

  return `// Transform Error\nthrow new Error("Module transformation failed");`;
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
  requestSignal?: AbortSignal,
): Promise<string | null> {
  if (
    projectRef.length === 0 || projectRef.length > MAX_QUERY_IDENTITY_LENGTH ||
    filePath.length === 0 || filePath.length > MAX_MODULE_PATH_LENGTH ||
    filePath.includes("\\") || filePath.includes("%") ||
    hasUnsafeControlCharacters(filePath) ||
    filePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return null;
  }

  const apiBaseUrl = getApiBaseUrlEnv();
  const registryBaseUrl = apiBaseUrl.replace(/\/api\/?$/, "").replace(/\/+$/, "");
  const encodedProjectRef = projectRef.split("@").map(encodeURIComponent).join("@");
  const encodedFilePath = filePath.split("/").map(encodeURIComponent).join("/");
  const registryUrl = `${registryBaseUrl}/${encodedProjectRef}/@/${encodedFilePath}`;

  const headers = new Headers();
  injectContext(headers);

  const timeoutSignal = AbortSignal.timeout(HTTP_FETCH_TIMEOUT_MS);
  const signal = requestSignal ? AbortSignal.any([requestSignal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(registryUrl, { headers, signal });
  if (!response.ok) {
    logger.warn("Cross-project fetch failed", {
      status: response.status,
    });
    return null;
  }

  try {
    return await readLimitedCrossProjectSource(response, registryUrl);
  } catch (error) {
    logger.warn("Cross-project source rejected", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
}
