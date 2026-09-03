/** Module Server - serves transformed ESM modules at /_vf_modules/* URLs */

import { join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import type { TransformOptions } from "#veryfront/transforms/esm-transform.ts";
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
import { readBoundedModuleSource } from "./module-source-reader.ts";
import { sha256Short } from "#veryfront/cache/hash.ts";
import {
  getReleaseDependencyRewriteManifestState,
  hasReleaseDependencyImportSpecifiers,
} from "#veryfront/release-assets/module-consumption.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import {
  getReadyManifestForBrowserModuleAdmission,
} from "#veryfront/release-assets/manifest-cache.ts";
import {
  DEPENDENCY_PINNING_ENV_FLAG,
  RELEASE_ASSET_IMMUTABLE_MAX_AGE_SECONDS,
  RELEASE_MODULE_RUNTIME_VERSION_PARAM,
  RELEASE_MODULE_VERSION_PARAM,
} from "#veryfront/release-assets/constants.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
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
import { findFirstExistingFile } from "./fs-probe.ts";
import {
  moduleBadRequest,
  moduleMethodNotAllowed,
  moduleNotFound,
  moduleRejected,
  moduleServiceUnavailable,
  unknownDependencySnapshot,
} from "./module-response.ts";
import { ensureFilenameDefaultExport } from "#veryfront/modules/loader-shared/filename-default-export.ts";
import { classifyModuleRequest, DEV_MODULE_PREFIX } from "./classify.ts";
import { transformModuleToServable } from "./module-transform.ts";
import {
  createDependencyPinningSource,
  type DependencyPinningSnapshot,
  type DependencyPinningSourceInput,
  getRememberedDependencyPinningSnapshot,
  resolveProjectReactVersion,
  resolveRequestedDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { isProjectInDependencyPinningCohort } from "#veryfront/transforms/esm/dependency-pinning-cohort.ts";
import {
  appendDependencyPinningPathKey,
  extractDependencyPinningPathKey,
} from "#veryfront/transforms/import-rewriter/url-builder.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { HttpStatus } from "#veryfront/http/responses";
import {
  describeBrowserModuleBoundaryViolation,
  inspectBrowserModuleBoundary,
} from "#veryfront/server/shared/browser-module-boundary.ts";
import {
  BrowserModuleBoundaryError,
  type BrowserModuleBundle,
  BrowserModuleBundleError,
  type BrowserModuleBundleLimitOverrides,
  BrowserModuleDependencySnapshotError,
  BrowserModuleEntryRejectedError,
  bundleBrowserModuleWithMetadata,
} from "#veryfront/server/shared/browser-module-bundler.ts";
import { ensureDefaultParserContracts } from "#veryfront/extensions/parser/defaults.ts";
import {
  classifyBrowserModuleAbsoluteSourcePath,
  isProtectedBrowserModulePath,
} from "./browser-module-admission.ts";
import { isRSCEnabled } from "#veryfront/utils/feature-flags.ts";
import { isCanonicalDependencyPinningCacheKey } from "#veryfront/cache/keys/dependency-pinning.ts";

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

function isSSRModuleRequest(
  req: Request,
  url: URL,
  options: ModuleServerOptions,
): boolean {
  // Query parameters and user-agent strings are attacker-controlled. Only an
  // in-process caller that has explicitly admitted a local project may enable
  // the legacy SSR module transport.
  if (options.allowSSRModuleMode !== true || options.isLocalProject !== true) return false;
  const userAgent = req.headers.get("user-agent") ?? "";
  return url.searchParams.get("ssr") === "true" || userAgent.startsWith("Deno/");
}

function isReservedFrameworkModulePath(modulePathWithoutJsExtension: string): boolean {
  return modulePathWithoutJsExtension.startsWith("_veryfront/") ||
    modulePathWithoutJsExtension.startsWith("react/") ||
    modulePathWithoutJsExtension.startsWith("deps/") ||
    modulePathWithoutJsExtension.startsWith("_dnt.") ||
    modulePathWithoutJsExtension === "deno";
}

function validateBundledClientDependencies(
  bundle: BrowserModuleBundle,
  options: {
    projectDir: string;
    config?: VeryfrontConfig;
    admissionManifest?: ReleaseAssetManifest | null;
  },
): { valid: true } | { valid: false; path: string | null; reason: string } {
  for (const dependency of bundle.dependencies) {
    const policy = classifyBrowserModuleAbsoluteSourcePath(
      dependency.path,
      options.projectDir,
      {
        config: options.config,
        rscEnabled: true,
      },
    );
    const path = policy.canonicalPath;
    if (!path) {
      return { valid: false, path: null, reason: "outside-project" };
    }
    if (policy.protectionReason) {
      return { valid: false, path, reason: policy.protectionReason };
    }

    if (
      options.admissionManifest &&
      !Object.hasOwn(options.admissionManifest.modules, path)
    ) {
      return { valid: false, path, reason: "absent-from-release-manifest" };
    }
  }

  return { valid: true };
}

function isScriptModuleSource(path: string): boolean {
  return /\.(?:[cm]?[jt]sx?)$/i.test(path);
}

async function inspectBrowserSourceBoundary(
  source: string,
  sourceFile: string,
): Promise<string | null> {
  await ensureDefaultParserContracts();
  const violation = await inspectBrowserModuleBoundary(source, sourceFile);
  return violation ? describeBrowserModuleBoundaryViolation(violation) : null;
}

async function addReleaseVersionToFallbackImports(
  code: string,
  modulePath: string,
  releaseId: string | null | undefined,
  dependencyPinningCacheKey?: string,
): Promise<string> {
  if (!releaseId) return code;
  const moduleBaseUrl = `https://veryfront.local/_vf_modules/${modulePath}`;

  return await replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("/_vf_modules/")) {
      return appendDependencyPinningPathKey(
        appendReleaseModuleVersion(specifier, releaseId),
        dependencyPinningCacheKey,
      );
    }
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;

    const resolved = new URL(specifier, moduleBaseUrl);
    if (resolved.origin !== "https://veryfront.local") return null;
    if (!resolved.pathname.startsWith("/_vf_modules/")) return null;
    return appendDependencyPinningPathKey(
      appendReleaseModuleVersion(
        `${resolved.pathname}${resolved.search}${resolved.hash}`,
        releaseId,
      ),
      dependencyPinningCacheKey,
    );
  });
}

interface SourceLookupContext {
  projectId?: string;
  projectSlug?: string | null;
  branch?: string | null;
  releaseId?: string | null;
  reactVersion?: string;
  /**
   * Whether a reserved framework request may fall back to project-owned source.
   * Production browser requests disable this so a missing framework asset
   * cannot silently change provenance to tenant code.
   */
  allowReservedProjectFallback?: boolean;
}

export interface ModuleServerOptions {
  /** Project identifier (directory path, legacy naming) */
  projectId: string;
  /** Project root directory */
  projectDir: string;
  /** Runtime adapter */
  adapter: RuntimeAdapter;
  /** Development mode. Defaults to `false`: an omitted flag must not serve
   * unminified modules or leak raw transform errors to a browser. */
  dev?: boolean;
  /** Project UUID for multi-project mode (from domain lookup) */
  projectUUID?: string;
  /** Project slug for multi-project mode (from proxy headers or domain lookup) */
  projectSlug?: string;
  /** Branch name for branch-aware file resolution */
  branch?: string | null;
  /** Release ID for production mode (published files) */
  releaseId?: string | null;
  /** Stable release/branch identity paired with dependency snapshot history. */
  contentSourceId?: string;
  /** Explicitly selects host FS for local projects and adapter FS for proxy projects. */
  isLocalProject?: boolean;
  /**
   * Whether modules are being served by the shared multi-project runtime.
   * Production release admission fails closed when this is omitted; only an
   * explicitly standalone runtime may bypass the hosted release manifest.
   */
  isProxyMode?: boolean;
  /**
   * Enables the legacy SSR transform only for an explicitly admitted local
   * project. Never derive this capability from request headers or query data.
   */
  allowSSRModuleMode?: boolean;
  /**
   * Restrict module imports to specific directories (opt-in security).
   * When not set, users can import from any directory in the project.
   */
  allowedImportDirs?: string[];
  /** React version for transforms (from project config) */
  reactVersion?: string;
  /** Project config whose explicit React override wins over dependency detection. */
  config?: VeryfrontConfig;
  /** Canonical request-scoped package source supplied by the server handler. */
  dependencyPinningSource?: DependencyPinningSourceInput;
  /** Request mode ("preview" | "production") for studio features like node positions */
  mode?: string;
  /** Optional operator tightening for request-triggered browser graph compilation. */
  browserModuleBundleLimits?: BrowserModuleBundleLimitOverrides;
  /**
   * Whether the project gates requests behind a credential (`security.auth`, or
   * the `VERYFRONT_BASIC_*` / `VERYFRONT_BEARER_TOKEN` env fallbacks).
   *
   * Only the cache directive depends on this: a gated project's module source
   * must never be announced to shared caches as `public`. Defaults to `true`
   * so an omitted flag withholds the shared-cache directive rather than
   * publishing protected sources on a caller's behalf.
   */
  authGateEnabled?: boolean;
}

interface ModuleDependencyState {
  dependencyPinningCacheKey: string;
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  reactVersion: string;
}

/** Serve transformed module at /_vf_modules/* path */
export function serveModule(req: Request, options: ModuleServerOptions): Promise<Response> {
  const url = new URL(req.url);
  const pathPin = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG) === "1"
    ? extractDependencyPinningPathKey(url.pathname)
    : { pathname: url.pathname, found: false, malformed: false };
  if (pathPin.found && !pathPin.malformed) {
    url.pathname = pathPin.pathname;
  }

  return withSpan(
    "modules.serve",
    async (): Promise<Response> => {
      const startTime = performance.now();

      const {
        projectId,
        projectDir,
        adapter,
        dev = false,
        projectUUID,
        allowedImportDirs,
        reactVersion: explicitReactVersion,
        config,
      } = options;

      const effectiveProjectId = projectUUID ?? projectId;
      // Fail closed: an omitted flag withholds the shared-cache directive.
      const authGateEnabled = options.authGateEnabled !== false;
      const method = req.method.toUpperCase();
      const isHeadRequest = method === "HEAD";
      if (method !== "GET" && method !== "HEAD") {
        return moduleMethodNotAllowed(method);
      }
      const queryPinValues = url.searchParams.getAll("pins");
      const requestedPinKey = pathPin.found ? pathPin.cacheKey : queryPinValues[0];
      const requestedPinCount = queryPinValues.length + (pathPin.found ? 1 : 0);
      const hasRequestedPinKey = requestedPinCount > 0;
      const dependencyPinningEnabled = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG) === "1";
      if (
        pathPin.malformed ||
        requestedPinCount > 1 ||
        (hasRequestedPinKey &&
          (!requestedPinKey || !isCanonicalDependencyPinningCacheKey(requestedPinKey))) ||
        // The flag arms the rollout; the cohort decides who is in it. Gating on
        // the flag alone conflicted every module of every project while the
        // rollout sat at 0%, because an out-of-cohort document correctly emits
        // no key -- so the armed flag was never inert, which is the property it
        // is supposed to have.
        // effectiveProjectId, not options.projectId: the UUID is the identity a
        // hosted multi-project request is pinned under, and it is what the
        // snapshot resolve below uses. Bucketing on the directory-path id would
        // put this check in a different cohort than the snapshot it guards.
        (!hasRequestedPinKey && dependencyPinningEnabled &&
          isProjectInDependencyPinningCohort(effectiveProjectId))
      ) {
        return unknownDependencySnapshot(method);
      }
      const dependencySource = options.dependencyPinningSource ??
        createDependencyPinningSource({
          projectDir,
          adapter,
          isLocalProject: options.isLocalProject,
          projectId: effectiveProjectId,
          projectSlug: options.projectSlug,
          contentSourceId: options.contentSourceId,
          releaseId: options.releaseId,
          branch: options.branch,
          config,
        });
      const rememberedDependencySnapshot = requestedPinKey
        ? getRememberedDependencyPinningSnapshot(dependencySource, requestedPinKey)
        : undefined;
      let dependencyStatePromise: Promise<ModuleDependencyState | undefined> | undefined;
      const dependencyStateFromSnapshot = async (
        snapshot: DependencyPinningSnapshot,
      ): Promise<ModuleDependencyState> => {
        const dependencyPinningCacheKey = snapshot.cacheKey;
        const dependencyPinningDependencies = snapshot.dependencies;
        const snapshotReactVersion = await resolveProjectReactVersion({
          projectDir,
          config,
          dependencyPinningCacheKey,
          dependencyPinningDependencies,
        });
        return {
          dependencyPinningCacheKey,
          dependencyPinningDependencies,
          reactVersion: dependencyPinningCacheKey.startsWith("on:")
            ? snapshotReactVersion
            : explicitReactVersion ?? snapshotReactVersion,
        };
      };
      const resolveDependencyState = (): Promise<ModuleDependencyState | undefined> => {
        dependencyStatePromise ??= (async () => {
          const snapshot = rememberedDependencySnapshot ??
            await resolveRequestedDependencyPinningSnapshot(
              dependencySource,
              requestedPinKey,
            );
          if (
            !snapshot ||
            (requestedPinKey
              ? snapshot.cacheKey !== requestedPinKey
              : snapshot.cacheKey.startsWith("on:"))
          ) return undefined;
          return await dependencyStateFromSnapshot(snapshot);
        })();
        return dependencyStatePromise;
      };

      const secureFs = createSecureFs({
        baseDir: projectDir,
        adapter,
        context: "module-loading",
        contextOptions: { allowedImportDirs },
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
      const dependencyCacheRoot = getHttpBundleCacheDir();

      const debugUserAgent = req.headers.get("user-agent") ?? "";
      logger.debug("Request", {
        pathname: url.pathname,
        userAgent: debugUserAgent.slice(0, 50),
      });

      const kind = classifyModuleRequest(url);

      if (kind.kind === "not-module") {
        return moduleNotFound(method);
      }

      if (kind.kind === "invalid-module") {
        logger.warn("Rejected malformed reserved module request", {
          namespace: kind.namespace,
          path: url.pathname,
        });
        return moduleBadRequest(method, "Invalid module path");
      }

      if (kind.kind === "snippet") {
        const { hash } = kind;
        if (!hash) {
          return moduleNotFound(method, "Missing snippet hash");
        }
        const dependencyState = await resolveDependencyState();
        if (!dependencyState) return unknownDependencySnapshot(method);
        const {
          dependencyPinningCacheKey,
          dependencyPinningDependencies,
          reactVersion,
        } = dependencyState;

        const { getCompiledSnippetAsync } = await import(
          "#veryfront/rendering/snippet-renderer.ts"
        );
        const snippetCode = await getCompiledSnippetAsync(hash);

        if (!snippetCode) {
          logger.warn("Snippet not found in cache", { hash });
          return moduleNotFound(method, "Snippet not found");
        }

        const { slug: snippetProjectSlug, branch: snippetBranch } = parseProjectDomain(url.host);

        const isSSR = isSSRModuleRequest(req, url, options);

        if (!isSSR) {
          const boundaryReason = await inspectBrowserSourceBoundary(
            snippetCode,
            `_snippets/${hash}.tsx`,
          );
          if (boundaryReason) {
            logger.warn("Rejected server-only snippet from browser module endpoint", {
              hash,
              reason: boundaryReason,
            });
            return moduleRejected(method);
          }
        }

        logger.debug("Transforming snippet", {
          hash,
          isSSR,
          snippetProjectSlug,
          codeLength: snippetCode.length,
        });

        try {
          const transformedCode = await transformModuleToServable({
            source: snippetCode,
            sourceFile: `_snippets/${hash}.tsx`,
            projectDir,
            adapter,
            transformOpts: {
              projectId: effectiveProjectId,
              dev,
              ssr: isSSR,
              moduleServerUrl: !isSSR &&
                  dependencyPinningCacheKey.startsWith("on:") &&
                  !pathPin.found
                ? "/_vf_modules"
                : undefined,
              moduleServerOrigin: url.origin,
              reactVersion,
              dependencyPinningCacheKey,
              dependencyPinningDependencies,
              dependencyPinningSource: dependencySource,
              serverExternalPackages: config?.build?.serverExternalPackages,
            },
            isSSR,
            ssrRewriteOptions: {
              projectSlug: snippetProjectSlug,
              branch: snippetBranch,
              projectDir,
              projectId: effectiveProjectId,
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
            },
            releaseRewriteOptions: {
              releaseId: options.releaseId,
              dependencyCacheRoot,
              readDependencySource: (path) => platformFs.readTextFile(path),
            },
            profile: true,
          });

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
          const clientError = getClientModuleError(dev, errorMsg);
          return createModuleResponse(
            method,
            `// Transform Error\nthrow new Error(${JSON.stringify(clientError)});`,
            HTTP_SERVER_ERROR,
            {
              "Content-Type": "application/javascript; charset=utf-8",
              "Cache-Control": "no-cache",
            },
          );
        }
      }

      if (kind.kind === "cross-project-versioned" || kind.kind === "cross-project-latest") {
        const crossProjectSlug = kind.slug;
        const crossVersion = kind.kind === "cross-project-versioned" ? kind.version : "latest";
        const crossPath = kind.path;

        if (!crossProjectSlug || !crossPath) {
          return moduleNotFound(method, "Invalid cross-project import path");
        }

        // The remote project's configuration is unavailable here, so enforce
        // the framework-owned default private roots before any registry fetch.
        if (isProtectedBrowserModulePath(crossPath)) {
          logger.warn("Rejected protected cross-project browser module path", {
            project: crossProjectSlug,
            path: crossPath,
          });
          return moduleRejected(method);
        }
        const dependencyState = await resolveDependencyState();
        if (!dependencyState) return unknownDependencySnapshot(method);
        const {
          dependencyPinningCacheKey,
          dependencyPinningDependencies,
          reactVersion,
        } = dependencyState;

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
            return moduleNotFound(
              method,
              `Cross-project module not found: ${projectRef}/@/${crossPath}`,
            );
          }

          const isSSR = isSSRModuleRequest(req, url, options);
          if (!isSSR && isScriptModuleSource(crossPath)) {
            const boundaryReason = await inspectBrowserSourceBoundary(source, crossPath);
            if (boundaryReason) {
              logger.warn("Rejected server-only cross-project source from browser endpoint", {
                projectRef,
                path: crossPath,
                reason: boundaryReason,
              });
              return moduleRejected(method);
            }
          }
          const crossProjectModuleServerUrl = `/_vf_modules/_cross/${projectRef}/@`;
          const browserCrossProjectModuleServerUrl = dependencyPinningCacheKey.startsWith("on:")
            ? pathPin.found ? undefined : `/_vf_modules/_cross/${projectRef}/@`
            : `http://${url.host}`;

          const code = await transformModuleToServable({
            source,
            sourceFile: crossPath,
            projectDir,
            adapter,
            transformOpts: {
              projectId: effectiveProjectId,
              dev,
              ssr: isSSR,
              moduleServerUrl: isSSR
                ? crossProjectModuleServerUrl
                : browserCrossProjectModuleServerUrl,
              moduleServerOrigin: url.origin,
              reactVersion,
              dependencyPinningCacheKey,
              dependencyPinningDependencies,
              dependencyPinningSource: dependencySource,
              serverExternalPackages: config?.build?.serverExternalPackages,
            },
            isSSR,
            ssrRewriteOptions: {
              crossProjectRef: projectRef,
              projectDir,
              projectId: effectiveProjectId,
              resolveCacheBuster: createSSRTargetCacheBusterResolver({
                secureFs,
                projectDir,
                currentModulePath: crossPath,
                crossProjectRef: projectRef,
                projectId: effectiveProjectId,
                releaseId: options.releaseId,
                reactVersion,
              }),
            },
            releaseRewriteOptions: {
              releaseId: options.releaseId,
              dependencyCacheRoot,
              readDependencySource: (path) => platformFs.readTextFile(path),
            },
            profile: true,
          });

          return createModuleResponse(method, code, HTTP_OK, {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-cache",
          });
        } catch (error) {
          const errorMsg = getErrorMessage(error);
          logger.error("Cross-project error", { projectRef, error: errorMsg });
          const clientError = getClientModuleError(dev, errorMsg);
          return createModuleResponse(
            method,
            `// Transform Error\nthrow new Error(${JSON.stringify(clientError)});`,
            HTTP_SERVER_ERROR,
            {
              "Content-Type": "application/javascript; charset=utf-8",
              "Cache-Control": "no-cache",
            },
          );
        }
      }

      // dev-module path (kind.kind === "dev-module")

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

      const isSSR = isSSRModuleRequest(req, url, options);
      if (isProtectedBrowserModulePath(modulePath, options.config)) {
        logger.warn("Rejected protected project path from browser module endpoint", {
          modulePath,
        });
        return moduleRejected(method);
      }

      const requiresProductionManifestAdmission = !isSSR &&
        options.mode === "production" &&
        options.isLocalProject !== true &&
        options.isProxyMode !== false;
      const resolveBeforeSourceLookup = !dependencyPinningEnabled ||
        rememberedDependencySnapshot !== undefined ||
        isSSR ||
        isReservedFrameworkModulePath(filePathWithoutExt);
      let dependencyState = resolveBeforeSourceLookup ? await resolveDependencyState() : undefined;
      if (resolveBeforeSourceLookup && !dependencyState) {
        return unknownDependencySnapshot(method);
      }

      if (
        requiresProductionManifestAdmission &&
        !options.releaseId &&
        !isReservedFrameworkModulePath(filePathWithoutExt)
      ) {
        logger.warn("Rejected hosted production browser module without a release", {
          modulePath,
        });
        return moduleRejected(method);
      }

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
      let releaseModuleResponseCacheKey: string | null | undefined;
      const getReleaseModuleResponseCacheKey = (
        state: ModuleDependencyState,
      ): string | null => {
        releaseModuleResponseCacheKey ??= canCacheReleaseVersionedModule
          ? buildReleaseModuleResponseCacheKey({
            projectIdentity: effectiveProjectId,
            projectDir,
            projectSlug,
            branch,
            releaseId: options.releaseId!,
            runtimeVersion: VERSION,
            reactVersion: state.reactVersion,
            dependencyPinningCacheKey: state.dependencyPinningCacheKey,
            moduleServerOrigin: url.origin,
            serverExternalPackages: config?.build?.serverExternalPackages,
            releaseDependencyManifestVersion,
            modulePath,
          })
          : null;
        return releaseModuleResponseCacheKey;
      };

      const readCachedReleaseModule = async (
        state: ModuleDependencyState,
      ): Promise<Response | null> => {
        const cacheKey = getReleaseModuleResponseCacheKey(state);
        if (!cacheKey) return null;

        const cachedResponse = await getReleaseModuleResponse(cacheKey);
        if (cachedResponse?.entry) {
          const canUseCachedResponse = !releaseDependencyRewriteEnabled ||
            !(await hasReleaseDependencyImportSpecifiers(cachedResponse.entry.body));
          if (canUseCachedResponse) {
            markRequestProfilePhase("module.response_cache_hit");
            if (cachedResponse.source === "distributed") {
              markRequestProfilePhase("module.response_cache_distributed_hit");
            }
            // The entry was stored under whatever gate the project carried at
            // write time, and the response cache key does not distinguish the
            // two. Restate the directive for this request so a hit can never
            // replay a `public` header a since-enabled gate has revoked.
            const cachedHeaders = Object.fromEntries(
              cachedResponse.entry.headers.filter(
                ([name]) => name.toLowerCase() !== "cache-control",
              ),
            );
            cachedHeaders["Cache-Control"] = getModuleCacheControl(true, authGateEnabled);
            return createModuleResponse(
              method,
              cachedResponse.entry.body,
              cachedResponse.entry.status,
              cachedHeaders,
            );
          }
          markRequestProfilePhase("module.response_cache_dependency_blocked");
        }
        markRequestProfilePhase("module.response_cache_miss");
        return null;
      };

      if (!requiresProductionManifestAdmission && dependencyState) {
        const cachedResponse = await readCachedReleaseModule(dependencyState);
        if (cachedResponse) return cachedResponse;
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
                reactVersion: dependencyState?.reactVersion ??
                  explicitReactVersion ?? REACT_DEFAULT_VERSION,
                allowReservedProjectFallback: !requiresProductionManifestAdmission,
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
          // no-store, not no-cache: this miss is probed against the tenant's projectDir
          // after admission, so a cacheable answer would leak project layout (see #3290).
          return moduleRejected(method);
        }

        const { path: sourceFile, isFrameworkFile, embeddedContent } = findResult;
        const sourcePolicy = isFrameworkFile
          ? null
          : classifyBrowserModuleAbsoluteSourcePath(sourceFile, projectDir, {
            config: options.config,
            rscEnabled: isRSCEnabled(options.config),
            isLocalProject: options.isLocalProject,
          });
        const exactSourceKey = sourcePolicy?.canonicalPath ?? null;

        if (!isFrameworkFile && (!exactSourceKey || sourcePolicy?.protectionReason)) {
          logger.warn("Rejected protected resolved source from browser module endpoint", {
            modulePath,
            sourceFile,
            exactSourceKey,
            reason: sourcePolicy?.protectionReason ?? "outside-project",
          });
          return moduleRejected(method);
        }

        let productionAdmissionManifest: ReleaseAssetManifest | null = null;
        if (requiresProductionManifestAdmission && !isFrameworkFile) {
          if (!options.releaseId) {
            logger.warn("Rejected hosted production browser module without a release", {
              modulePath,
              sourceFile,
            });
            return moduleRejected(method);
          }
          const admissionManifest = await getReadyManifestForBrowserModuleAdmission(
            options.releaseId,
            { refreshCachedNull: true },
          );
          if (!admissionManifest) {
            logger.error("Production browser module manifest is unavailable", {
              modulePath,
              sourceFile,
              releaseId: options.releaseId,
            });
            return moduleServiceUnavailable(method, "Browser module manifest unavailable");
          }
          if (!exactSourceKey || !Object.hasOwn(admissionManifest.modules, exactSourceKey)) {
            logger.warn("Rejected production browser source absent from release manifest", {
              modulePath,
              sourceFile,
              exactSourceKey,
              releaseId: options.releaseId,
              manifestVersion: admissionManifest.manifestVersion,
            });
            return moduleRejected(method);
          }
          productionAdmissionManifest = admissionManifest;
        }

        if (requiresProductionManifestAdmission && dependencyState) {
          const cachedResponse = await readCachedReleaseModule(dependencyState);
          if (cachedResponse) return cachedResponse;
        }

        let code = "";
        let inspectedBrowserSource: string | undefined;
        let bundledClientBoundary: BrowserModuleBundle | undefined;

        if (!isSSR && !isFrameworkFile && isScriptModuleSource(sourceFile)) {
          // `use client` marks a graph boundary, not every file in that graph.
          // Bundle the boundary so ordinary transitive helpers never become
          // independently addressable browser entrypoints. The bundler applies
          // admission before reading the entry, then applies server-only checks
          // to every dependency. The post-build pass below additionally enforces
          // project path policy and release membership.
          if (sourcePolicy?.requiresClientBoundary === true) {
            const dependencyPinningOptions = dependencyState
              ? {
                dependencyPinningCacheKey: dependencyState.dependencyPinningCacheKey,
                dependencyPinningDependencies: dependencyState.dependencyPinningDependencies,
              }
              : requestedPinKey
              ? { requestedDependencyPinningCacheKey: requestedPinKey }
              : undefined;
            if (!dependencyPinningOptions) {
              return unknownDependencySnapshot(method);
            }
            await ensureDefaultParserContracts();
            bundledClientBoundary = await bundleBrowserModuleWithMetadata(sourceFile, {
              adapter,
              projectDir,
              projectId: effectiveProjectId,
              projectSlug: projectSlug ?? undefined,
              config: options.config,
              moduleServerOrigin: url.origin,
              ...dependencyPinningOptions,
              dependencyPinningSource: dependencySource,
              signal: req.signal,
              requireClientBoundary: true,
              limits: options.browserModuleBundleLimits,
              ...(requiresProductionManifestAdmission && options.releaseId
                ? {
                  singleflightKey: [
                    effectiveProjectId,
                    options.releaseId,
                    dependencyState?.dependencyPinningCacheKey ?? requestedPinKey,
                    url.origin,
                    sourceFile,
                  ].join("\0"),
                }
                : {}),
            });
            if (!dependencyState) {
              const resolvedCacheKey = bundledClientBoundary.dependencyPinningCacheKey;
              const resolvedDependencies = bundledClientBoundary.dependencyPinningDependencies;
              if (
                typeof resolvedCacheKey !== "string" ||
                resolvedCacheKey !== requestedPinKey ||
                resolvedDependencies === undefined
              ) {
                throw new BrowserModuleDependencySnapshotError();
              }
              dependencyState = await dependencyStateFromSnapshot(
                Object.freeze({
                  cacheKey: resolvedCacheKey,
                  dependencies: resolvedDependencies,
                }),
              );
            }
            const dependencyAdmission = validateBundledClientDependencies(
              bundledClientBoundary,
              {
                projectDir,
                config: options.config,
                admissionManifest: productionAdmissionManifest,
              },
            );
            if (!dependencyAdmission.valid) {
              logger.warn("Rejected protected RSC client dependency", {
                modulePath,
                dependencyPath: dependencyAdmission.path,
                reason: dependencyAdmission.reason,
              });
              return moduleRejected(method);
            }
          } else {
            inspectedBrowserSource = await readSourceFileForVersion(secureFs, findResult);
            const boundaryReason = await inspectBrowserSourceBoundary(
              inspectedBrowserSource,
              sourceFile,
            );
            if (boundaryReason) {
              logger.warn("Rejected server-only source from browser module endpoint", {
                modulePath,
                reason: boundaryReason,
              });
              return moduleRejected(method);
            }
          }
        }

        dependencyState ??= await resolveDependencyState();
        if (!dependencyState) return unknownDependencySnapshot(method);
        const {
          dependencyPinningCacheKey,
          dependencyPinningDependencies,
          reactVersion,
        } = dependencyState;
        releaseModuleResponseCacheKey = getReleaseModuleResponseCacheKey(dependencyState);

        if (!isHeadRequest) {
          if (bundledClientBoundary) {
            code = ensureFilenameDefaultExport(modulePath, bundledClientBoundary.source);
          } else {
            // Use embedded content for compiled polyfills (no filesystem I/O needed)
            let source: string;
            if (inspectedBrowserSource !== undefined) {
              source = inspectedBrowserSource;
            } else if (embeddedContent !== undefined) {
              source = embeddedContent;
              logger.debug("Using embedded polyfill content", {
                path: sourceFile,
                contentLength: embeddedContent.length,
              });
            } else {
              source = isFrameworkFile
                ? await platformFs.readTextFile(sourceFile)
                : await readBoundedModuleSource(
                  secureFs.readFileBytesWithinLimit,
                  sourceFile,
                );
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
              moduleServerUrl: !isSSR &&
                  dependencyPinningCacheKey.startsWith("on:") &&
                  !pathPin.found
                ? "/_vf_modules"
                : undefined,
              moduleServerOrigin: url.origin,
              studioEmbed,
              reactVersion,
              dependencyPinningCacheKey,
              dependencyPinningDependencies,
              dependencyPinningSource: dependencySource,
              serverExternalPackages: config?.build?.serverExternalPackages,
            };

            // The dev-module path has two post-steps that stay outside
            // transformModuleToServable to keep its API small:
            //   - HMR timestamp injection: runs after the full shared sequence
            //     (originally between the SSR rewrite and the non-SSR release
            //     rewrite; reordering is safe because they touch disjoint
            //     specifiers)
            //   - addReleaseVersionToFallbackImports: runs after the release rewrite
            code = await transformModuleToServable({
              source,
              sourceFile,
              projectDir,
              adapter,
              transformOpts,
              isSSR,
              postTransform: (c) => ensureFilenameDefaultExport(modulePath, c),
              ssrRewriteOptions: {
                projectSlug,
                branch,
                projectDir,
                projectId: effectiveProjectId,
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
              },
              releaseRewriteOptions: {
                releaseId: options.releaseId,
                manifest: releaseDependencyRewriteEnabled ? releaseDependencyManifest : undefined,
                manifestReadOptions: { refreshCachedNull: true },
                dependencyCacheRoot,
                readDependencySource: (path) => platformFs.readTextFile(path),
              },
              profile: true,
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
            code = await addReleaseVersionToFallbackImports(
              code,
              modulePath,
              options.releaseId,
              dependencyPinningCacheKey,
            );
          }
        }

        const hasUnrewrittenReleaseDependencyImports = releaseDependencyRewriteEnabled &&
          await hasReleaseDependencyImportSpecifiers(code);
        const responseCacheKey = releaseModuleResponseCacheKey;
        const canCacheModuleResponse = typeof responseCacheKey === "string" &&
          !hasUnrewrittenReleaseDependencyImports;
        if (hasUnrewrittenReleaseDependencyImports) {
          markRequestProfilePhase("module.response_cache_dependency_blocked");
        }
        const headers = getModuleHeaders(modulePath, {
          cacheable: canCacheModuleResponse,
          authGated: authGateEnabled,
        });
        logger.debug("Request complete", {
          path: modulePath,
          durationMs: (performance.now() - startTime).toFixed(1),
        });

        if (canCacheModuleResponse && method === "GET") {
          void rememberReleaseModuleResponse(responseCacheKey, {
            body: code,
            status: HTTP_OK,
            headers: Object.entries(headers),
          });
          markRequestProfilePhase("module.response_cache_store");
        }

        return createModuleResponse(method, code, HTTP_OK, headers);
      } catch (error) {
        if (error instanceof BrowserModuleDependencySnapshotError) {
          return unknownDependencySnapshot(method);
        }
        if (
          error instanceof BrowserModuleEntryRejectedError ||
          error instanceof BrowserModuleBoundaryError
        ) {
          return moduleRejected(method);
        }
        const errorMsg = getErrorMessage(error);
        logger.error("Module transform error", { modulePath, error: errorMsg });

        const headers = getModuleHeaders(modulePath);
        const status = error instanceof BrowserModuleBundleError
          ? error.kind === "limit"
            ? HttpStatus.PAYLOAD_TOO_LARGE
            : error.kind === "deadline"
            ? HttpStatus.GATEWAY_TIMEOUT
            : HttpStatus.SERVICE_UNAVAILABLE
          : HTTP_SERVER_ERROR;
        const errorBody = createModuleErrorBody(
          modulePath,
          getClientModuleError(dev, errorMsg),
        );

        return createModuleResponse(method, errorBody, status, headers);
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
    : await readBoundedModuleSource(
      secureFs.readFileBytesWithinLimit,
      findResult.path,
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

  return await findFirstExistingFile(
    fs,
    extensions.map((ext) => join(FRAMEWORK_ROOT, basePathWithoutExt + ext)),
  );
}

async function findSourceFile(
  secureFs: ReturnType<typeof createSecureFs>,
  projectDir: string,
  basePath: string,
  context: SourceLookupContext,
  requestedModulePath = basePath,
): Promise<FindSourceFileResult | null> {
  const { reactVersion } = context;
  const allowReservedProjectFallback = context.allowReservedProjectFallback !== false;
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
    ".mjs", // Already-compiled ESM (e.g. Panda's generated styled-system/*.mjs)
    ".mdx",
    ".md", // Regular sources
  ];

  logger.debug("findSourceFile called", { projectDir, basePath });

  const knownExtMatch = basePath.match(/\.(json|tsx|ts|jsx|js|mjs|mdx|md)(\.src)?$/);
  const requestedExtMatch = requestedModulePath.match(
    /\.(json|tsx|ts|jsx|js|mjs|mdx|md)(\.src)?$/,
  );
  const hasKnownExt = knownExtMatch !== null;
  const requestedExt = requestedExtMatch?.[1] ?? knownExtMatch?.[1] ?? null;
  const rawBasePathWithoutExt = hasKnownExt
    ? basePath.replace(/\.(json|tsx|ts|jsx|js|mjs|mdx|md)(\.src)?$/, "")
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
    // The lookup below only stats `basePath` itself when it carries a known
    // extension, and drops `.json` from the fallback list for every non-JSON
    // request. Two requests that share an extensionless base path therefore
    // probe different files, so they must not share a miss entry: without
    // this, one `app/page.js` request caches a miss that makes the later
    // `app/page.json` request return null before its own file is ever stat'd.
    basePathExtension: knownExtMatch?.[0] ?? null,
    requestedExtension: requestedExt,
    reactVersion,
  });

  // Check embedded polyfills first (no filesystem access needed).
  // These cover both compiled-binary polyfills (node:async_hooks etc.)
  // and dnt build artifacts (_dnt.shims, _dnt.polyfills) that don't
  // exist as source files but are imported by npm-cached framework modules.
  // Note: checked before isFrameworkPath guard because relative imports from
  // deeply nested modules (e.g. ../../../../_dnt.shims.js) resolve outside
  // the _veryfront/ prefix.
  const embeddedContent = allowReservedProjectFallback &&
      PROJECT_FALLBACK_EMBEDDED_POLYFILLS.has(basePathWithoutExt)
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

    if (!allowReservedProjectFallback) return null;
  }

  if (isFrameworkPath) {
    const frameworkResult = await resolveFrameworkSourcePath(
      basePathWithoutExt.slice("_veryfront/".length),
      {
        extraLookupDirs: allowReservedProjectFallback ? [join(projectDir, "src")] : [],
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

    // A production browser request must not silently change provenance from
    // a reserved framework namespace to tenant source.
    logger.warn("Framework file not found locally", {
      basePath: basePathWithoutExt,
      frameworkRoot: FRAMEWORK_ROOT,
    });
    if (!allowReservedProjectFallback) return null;
  }

  if (
    !allowReservedProjectFallback &&
    isReservedFrameworkModulePath(basePathWithoutExt)
  ) return null;

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

  const fallbackExtensions = requestedExt !== null && requestedExt !== "json"
    ? extensions.filter((ext) => ext !== ".json")
    : extensions;
  const projectLookupExtensions = requestedExt === "mjs"
    ? [".mjs", ...fallbackExtensions.filter((ext) => ext !== ".mjs")]
    : fallbackExtensions;

  // Project file lookups (using secureFs which may go through FSAdapter in proxy mode)
  const projectFilePath = await findFirstExistingFile(
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
    const strippedFilePath = await findFirstExistingFile(
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

  const indexFilePath = await findFirstExistingFile(
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
    const commonDirFilePath = await findFirstExistingFile(
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
  return classifyModuleRequest(url).kind !== "not-module";
}

/**
 * The `Cache-Control` directive for a module response.
 *
 * `public` lets a shared cache in front of the runtime store the response even
 * though the request carried `Authorization` (RFC 9111 §3.5). On a project
 * behind `security.auth` that turns one authorized load into a CDN entry
 * serving protected module source to unauthenticated clients for a year, past
 * `AuthHandler` entirely. A gated project therefore gets `private`, which keeps
 * the browser's own year-long reuse while barring every shared cache.
 *
 * `private` rather than `Vary: Authorization`: the OIDC and trusted-proxy
 * gates admit on a cookie, so varying on `Authorization` would not separate
 * their entries at all.
 */
function getModuleCacheControl(cacheable: boolean, authGated: boolean): string {
  if (!cacheable) return "no-cache";
  const reuse = `max-age=${RELEASE_ASSET_IMMUTABLE_MAX_AGE_SECONDS}, immutable`;
  return authGated ? `private, ${reuse}` : `public, ${reuse}`;
}

function getModuleHeaders(
  modulePath: string,
  options: { cacheable?: boolean; authGated?: boolean } = {},
): Record<string, string> {
  return {
    "Content-Type": getDevModuleContentType(modulePath),
    "Cache-Control": getModuleCacheControl(
      options.cacheable === true,
      options.authGated !== false,
    ),
  };
}

/** Source extensions the module server compiles to JavaScript before serving. */
const COMPILED_TO_JS_EXTENSIONS = /\.(?:tsx?|jsx|mdx|md)$/;

/**
 * The source path a module request refers to.
 *
 * The import rewriter appends `.js` to any specifier whose extension it does
 * not recognise, so `@/lib/data.json` arrives here as `lib/data.json.js` while
 * the source file, and therefore the body, is still raw JSON.
 *
 * The content type and the error body must classify on the same path. They did
 * not, so a failing `lib/data.json.js` was answered with a JavaScript `throw`
 * body under `application/json`.
 */
function getModuleSourcePath(modulePath: string): string {
  return modulePath.toLowerCase().replace(/\.(?:mjs|js)$/, "");
}

/**
 * Content type for a dev module response.
 *
 * Exported for testing.
 */
export function getDevModuleContentType(modulePath: string): string {
  const normalizedPath = modulePath.toLowerCase();
  const sourcePath = getModuleSourcePath(modulePath);

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

const PRODUCTION_MODULE_ERROR = "Module transformation failed";

function getClientModuleError(dev: boolean, errorMessage: string): string {
  return dev ? errorMessage : PRODUCTION_MODULE_ERROR;
}

/**
 * The body served when a module fails to transform.
 *
 * A stylesheet reaches here only when the lookup itself fails rather than
 * reporting the file missing: a permission or transient storage error escapes
 * `findSourceFile` and surfaces as a 500 instead of a 404. The response is
 * typed `text/css` in that case, so the body has to be CSS.
 */
function createModuleErrorBody(modulePath: string, errorMessage: string): string {
  const sourcePath = getModuleSourcePath(modulePath);

  if (sourcePath.endsWith(".css")) {
    // A comment cannot contain its own terminator.
    const sanitized = errorMessage.replace(/\*\//g, "*\\/");
    return `/* Transform Error: ${sanitized} */`;
  }

  if (sourcePath.endsWith(".json") || sourcePath.endsWith(".map")) {
    return JSON.stringify({ error: errorMessage });
  }

  return `// Transform Error\nthrow new Error(${JSON.stringify(errorMessage)});`;
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
