/**
 * Adapter Factory Module
 *
 * Handles creation and caching of runtime adapters for different project contexts.
 * Supports local projects (filesystem-first) and proxy mode (API-first).
 *
 * @module server/runtime-handler/adapter-factory
 */

import { getBaseLogger } from "#veryfront/utils";
import {
  CACHE_INVARIANT_VIOLATION,
  getErrorMessage,
  SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE,
} from "#veryfront/errors";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { resolve } from "#veryfront/platform/compat/path/index.ts";
import {
  getConfig,
  getHostedConfig,
  type PreparedHostedConfigContext,
} from "#veryfront/config/loader.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { isConfigOptionalControlPlaneRunRequest } from "#veryfront/channels/control-plane.ts";
import { isWithinDirectory, joinPath } from "#veryfront/utils/path-utils.ts";
import { timeAsync } from "./request-lifecycle.ts";
import {
  defaultDiscoveryCache,
  findLocalProjectPath,
  type ProjectDiscoveryCache,
} from "./local-project-discovery.ts";
import type { ParsedDomain } from "../utils/domain-parser.ts";
import { isProxyTrusted } from "../utils/proxy-trust.ts";
import {
  capturePreviewSourceSnapshotMarker,
  captureRequiredPreviewSourceSnapshotMarker,
  ensurePreviewDocumentConfigSourceSnapshotFresh,
  type PreviewSourceSnapshotMarker,
  previewSourceSnapshotMarkersEqual,
} from "../handlers/request/source-snapshot-freshness.ts";
import {
  markdownPreviewOwnsDocumentPathname,
  ssrOwnsDocumentPathname,
} from "../handlers/request/ssr/document-ownership.ts";

const baseLogger = getBaseLogger("SERVER");

const logger = baseLogger.component("adapter-factory");

/**
 * Which path produced `config`, so a caller that degrades on a missing config
 * can say why it is missing.
 *
 * `config` being `undefined` is reached from four unrelated places -- an
 * inherited caller config, a deliberate defer, a published project that has no
 * config file, and a hosted 404 -- and the result alone cannot tell them
 * apart. Downstream, `resolveProjectRuntimeContext` silently substitutes the
 * process-wide security config for an absent project config, which serves a
 * correct-looking 200 carrying the platform-default CSP instead of the
 * project's. That degradation was undiagnosable from production logs because
 * every branch that reaches it logs at debug.
 */
export type ConfigResolutionOutcome =
  /** No project-specific load ran; whatever the caller passed through stands. */
  | "inherited"
  /** Loaded from a local project directory. */
  | "local"
  /** Deliberately skipped: see `shouldDeferConfigLoad`. */
  | "deferred"
  /** Loaded from the control plane for this project. */
  | "hosted"
  /** The control plane answered 404: the project publishes no config file. */
  | "hosted-absent";

interface AdapterResolutionResult {
  /** The effective project directory to use */
  projectDir: string;
  /** The adapter to use for this request */
  adapter: RuntimeAdapter;
  /** The config for this project */
  config: VeryfrontConfig | undefined;
  /** Which branch produced `config`. */
  configOutcome: ConfigResolutionOutcome;
  /** Whether this is a local project (filesystem-first) */
  isLocalProject: boolean;
  /** Strict mutable-source generation that produced document configuration. */
  previewDocumentSourceSnapshot?: PreviewSourceSnapshotMarker;
}

interface AdapterResolutionOptions {
  /**
   * Inbound request. Used to determine whether forwarded headers such as
   * `x-project-path` can be trusted (see {@link isProxyTrusted}).
   */
  req: Request;
  /** Base project directory */
  projectDir: string;
  /** Base adapter */
  adapter: RuntimeAdapter;
  /** Base config (optional) */
  config: VeryfrontConfig | undefined;
  /** Project slug */
  projectSlug: string | undefined;
  /** Project ID */
  projectId: string | undefined;
  /** Proxy token */
  proxyToken: string | undefined;
  /** Release ID */
  releaseId: string | undefined;
  /** Environment (preview/production) */
  proxyEnv: "preview" | "production" | undefined;
  /** Branch name */
  branch: string | null | undefined;
  /** Environment name (e.g., "staging") */
  environmentName: string | undefined;
  /** Parsed domain info */
  parsedDomain: ParsedDomain;
  /** Request pathname, used to decide whether config failures can safely fall back. */
  pathname?: string;
  /** Whether running in proxy mode */
  isProxyMode: boolean;
  /** Host admission decision for executing project-owned document handlers. */
  allowHostProjectCodeExecution?: boolean;
  /** Result of an earlier proxy trust check, when already available. */
  proxyTrusted?: boolean;
  /** Optional injectable cache (defaults to module-level singleton) */
  cache?: ProjectDiscoveryCache;
  /**
   * Authenticated source and environment snapshot for hosted config. Proxy
   * config must never derive either value independently inside this factory.
   */
  prepareHostedConfigContext?: (
    isLocalProject: boolean,
  ) => Promise<PreparedHostedConfigContext>;
}

/**
 * Whether an error carries an own `status` of 404.
 *
 * Read through an own-property descriptor rather than plain access: this runs on
 * a rejection value that may be anything, and a getter on an attacker-shaped
 * object should not execute during error handling.
 *
 * Callers must scope this to the single operation whose 404 means "absent",
 * never to a block that also performs other requests -- see the config load
 * below, where only the getHostedConfig call is treated this way.
 */
export function hasNotFoundStatus(error: unknown): boolean {
  // Walks `cause`, because the 404 does not always arrive on the outermost
  // error. readHostedConfigSource lets a VeryfrontError through untouched but
  // wraps anything else in CONFIG_PARSE_ERROR, which buries the original status
  // one level down. Reading only the top object made the fallback fire for one
  // error shape and not the other, for the same underlying 404.
  //
  // Depth-bounded so a self-referential cause cannot spin.
  let current: unknown = error;
  for (let depth = 0; depth < 8; depth++) {
    if (typeof current !== "object" || current === null) return false;
    const status = Object.getOwnPropertyDescriptor(current, "status");
    if (status !== undefined && status.value === 404) return true;
    const cause = Object.getOwnPropertyDescriptor(current, "cause");
    if (cause === undefined) return false;
    current = cause.value;
  }
  return false;
}

function usesExactSourceConfig(opts: AdapterResolutionOptions): boolean {
  return opts.isProxyMode &&
    !!opts.projectSlug &&
    !!opts.proxyToken &&
    isConfigOptionalControlPlaneRunRequest(opts.req.method, opts.pathname);
}

function shouldDeferConfigLoad(opts: AdapterResolutionOptions): boolean {
  if (usesExactSourceConfig(opts)) return true;
  // There is no immutable production source to evaluate until resolution has
  // selected a release. Let environment resolution return its canonical 404.
  return opts.isProxyMode && !!opts.projectSlug && opts.proxyEnv === "production" &&
    !opts.releaseId;
}

function mayServePublicPath(pathname: string): boolean {
  return pathname.split("/").every((segment) =>
    !segment.startsWith(".") || segment === ".well-known"
  );
}

async function hasPublishedStaticFile(
  projectDir: string,
  adapter: RuntimeAdapter,
  pathname: string,
  buildOutDir = "dist",
): Promise<boolean> {
  // StaticHandler's prefix route deliberately excludes the bare root, so an
  // index file cannot establish ownership for GET /. Leave that document on
  // strict API/SSR freshness instead of carrying a normal static lease into it.
  if (pathname === "/") return false;
  if (!mayServePublicPath(pathname)) return false;

  // StaticFileService checks preview build output before public. Keep this
  // ownership probe in the same order for extensionless document candidates.
  const roots = new Set<string>();
  const projectRoot = resolve(projectDir);
  const buildRoot = resolve(projectRoot, buildOutDir || "dist");
  if (buildRoot !== projectRoot && isWithinDirectory(projectRoot, buildRoot)) {
    roots.add(buildRoot);
  }
  roots.add(joinPath(projectRoot, "public"));
  const relativePath = pathname.replace(/^\/+/, "");
  const candidates = relativePath.length === 0
    ? ["index.html"]
    : [relativePath, `${relativePath.replace(/\/$/, "")}/index.html`];

  for (const root of roots) {
    for (const candidate of candidates) {
      const path = joinPath(root, candidate);
      if (!isWithinDirectory(root, path)) continue;
      try {
        if ((await adapter.fs.stat(path)).isFile) return true;
      } catch {
        // A miss leaves ownership with the document handlers. StaticHandler
        // remains responsible for reading and serving any matching bytes.
      }
    }
  }
  return false;
}

type PreviewConfigFreshness = "config-dependent" | "normal" | "normal-prepared" | "strict";

interface PreviewConfigFreshnessResolution {
  freshness: PreviewConfigFreshness;
  /** Generation that proved static ownership, retained through dispatch. */
  sourceSnapshot?: PreviewSourceSnapshotMarker;
}

function isCompleteSourceSnapshotMarker(
  marker: PreviewSourceSnapshotMarker | undefined,
): marker is Required<PreviewSourceSnapshotMarker> {
  return marker?.identity !== undefined && marker.version !== undefined;
}

async function renewPreviewConfigSourceSnapshot(adapter: RuntimeAdapter): Promise<void> {
  if (adapter.fs.ensureSourceSnapshotFresh) {
    await adapter.fs.ensureSourceSnapshotFresh("config-load");
    return;
  }
  await adapter.fs.refreshSourceSnapshot?.("config-load");
}

async function validatePreviewConfigSourceSnapshot(
  adapter: RuntimeAdapter,
  projectSlug: string,
  expected: PreviewSourceSnapshotMarker,
): Promise<PreviewSourceSnapshotMarker> {
  const current = await captureRequiredPreviewSourceSnapshotMarker(adapter.fs, projectSlug);
  if (!previewSourceSnapshotMarkersEqual(expected, current)) {
    throw SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.create({
      detail:
        `The mutable source snapshot serving "${projectSlug}" changed while request configuration was derived, so this document request must be retried against one generation.`,
    });
  }
  return current;
}

async function resolvePreviewConfigFreshness(
  opts: AdapterResolutionOptions,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<PreviewConfigFreshnessResolution> {
  if (!opts.isProxyMode || opts.proxyEnv === "production") return { freshness: "normal" };
  // The shared-runtime denial runs after request context construction. Avoid a
  // zero-age whole-source refresh for a document that no handler may execute.
  if (opts.allowHostProjectCodeExecution === false) return { freshness: "normal" };
  if (opts.req.method !== "GET" && opts.req.method !== "HEAD") {
    return { freshness: "normal" };
  }
  const pathname = opts.pathname ?? new URL(opts.req.url).pathname;
  if (pathname === "/api" || pathname.startsWith("/api/")) return { freshness: "normal" };
  // StaticHandler precedes API discovery and document rendering. Ordinary
  // extension paths are already excluded by the document predicates; probe
  // the default static candidates for extensionless and Markdown paths that
  // would otherwise reach SSR or MarkdownPreviewHandler. A configured build
  // root is discovered from one provisional config read below.
  const documentCandidate = ssrOwnsDocumentPathname(pathname) ||
    markdownPreviewOwnsDocumentPathname(pathname);
  if (!documentCandidate) return { freshness: "normal" };

  // Renew the normal lease before classifying static ownership. Refreshing the
  // adapter after this probe could remove a public file and let the request
  // fall through to document rendering without strict snapshot binding.
  await renewPreviewConfigSourceSnapshot(adapter);
  const beforeProbe = await capturePreviewSourceSnapshotMarker(adapter.fs);
  const staticOwned = await hasPublishedStaticFile(projectDir, adapter, pathname);
  const afterProbe = await capturePreviewSourceSnapshotMarker(adapter.fs);
  if (
    isCompleteSourceSnapshotMarker(beforeProbe) &&
    isCompleteSourceSnapshotMarker(afterProbe)
  ) {
    if (!previewSourceSnapshotMarkersEqual(beforeProbe, afterProbe)) {
      return { freshness: "strict" };
    }
    return staticOwned
      ? { freshness: "normal-prepared", sourceSnapshot: afterProbe }
      : { freshness: "config-dependent", sourceSnapshot: afterProbe };
  }

  // Mutable remote static ownership cannot be carried safely through config
  // loading and handler dispatch without a concrete generation. A miss still
  // gets one provisional config read so a configured build output can be
  // discovered, but any static match will fail closed below.
  return staticOwned ? { freshness: "strict" } : { freshness: "config-dependent" };
}

async function prepareProxyConfigLoad(
  opts: AdapterResolutionOptions,
  isLocalProject: boolean,
): Promise<PreparedHostedConfigContext & { cacheKey: string }> {
  if (!opts.projectSlug || !opts.prepareHostedConfigContext) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: "Proxy project config requires an authenticated declarative evaluation context",
    });
  }
  return {
    cacheKey: opts.projectId ?? opts.projectSlug,
    ...await opts.prepareHostedConfigContext(isLocalProject),
  };
}

/**
 * Resolve the effective adapter and config for a request.
 *
 * For local projects: Uses filesystem adapter, loads config from disk.
 * For proxy mode: Uses VeryFront API adapter with project context.
 */
export async function resolveAdapter(
  opts: AdapterResolutionOptions,
): Promise<AdapterResolutionResult> {
  const cache = opts.cache ?? defaultDiscoveryCache;

  let effectiveProjectDir = opts.projectDir;
  let effectiveAdapter = opts.adapter;
  let effectiveConfig = opts.config;
  let configOutcome: ConfigResolutionOutcome = "inherited";
  let previewDocumentSourceSnapshot: PreviewSourceSnapshotMarker | undefined;

  // Check if this is a local project.
  // In proxy mode, skip local discovery unless there's an explicit header path override —
  // the standard directories (data/projects/, projects/) don't exist in k8s.
  //
  // SECURITY: `x-project-path` is a client-controlled header. Honouring it from any
  // request would let an attacker reaching the runtime directly aim project discovery
  // (and therefore `/_veryfront/fs/...`) at arbitrary filesystem paths (VULN-SRV-3).
  // Only read it when the operator explicitly declares a private, sanitising
  // upstream topology. An operation-scoped dispatch JWS does not bind this path
  // override and therefore cannot authorize generic proxy headers.
  const proxyTrusted = opts.isProxyMode &&
    (opts.proxyTrusted ?? await isProxyTrusted(opts.req));
  const trustedHeaderProjectPath = proxyTrusted
    ? opts.req.headers.get("x-project-path")?.trim() || undefined
    : undefined;
  const shouldCheckLocalPath = opts.projectSlug && (!opts.isProxyMode || trustedHeaderProjectPath);
  const localProjectPath = shouldCheckLocalPath
    ? await findLocalProjectPath(opts.projectSlug!, opts.adapter, trustedHeaderProjectPath, cache)
    : undefined;

  const isLocalProject = !!localProjectPath;

  if (isLocalProject && localProjectPath) {
    effectiveProjectDir = localProjectPath;

    logger.debug("Using local project (filesystem-first)", {
      projectSlug: opts.projectSlug,
      projectDir: effectiveProjectDir,
    });

    // Get or create local adapter.
    //
    // Hold the adapter rather than reading it back: the cache is an LRU that
    // estimates each value's size and can evict an oversized entry as part of
    // the same set(), so a write is not guaranteed to be readable afterwards.
    // A RuntimeAdapter crosses that budget under Bun, where set() then leaves
    // has() === false and size === 0, and the non-null assertion this replaces
    // turned that miss into an undefined adapter that reached getConfig and
    // threw "undefined is not an object (evaluating 'adapter.fs')" on every
    // request. Caching stays best effort; correctness no longer depends on it.
    let localAdapter = cache.adapters.get(effectiveProjectDir);
    if (!localAdapter) {
      localAdapter = await runtime.get();
      cache.adapters.set(effectiveProjectDir, localAdapter);
      logger.debug("Created local adapter for project", {
        projectSlug: opts.projectSlug,
        projectDir: effectiveProjectDir,
      });
    }

    effectiveAdapter = localAdapter;

    if (shouldDeferConfigLoad(opts)) {
      effectiveConfig = undefined;
      configOutcome = "deferred";
    } else if (opts.isProxyMode) {
      const hosted = await prepareProxyConfigLoad(opts, true);
      effectiveConfig = await timeAsync(
        "config:load-project",
        () =>
          getHostedConfig(effectiveProjectDir, effectiveAdapter, {
            ...hosted,
            signal: opts.req.signal,
          }),
      );
      configOutcome = "hosted";
    } else {
      effectiveConfig = await timeAsync(
        "config:load-project",
        () => getConfig(effectiveProjectDir, effectiveAdapter),
      );
      configOutcome = "local";

      logger.debug("Loaded project-specific config", {
        projectSlug: opts.projectSlug,
        projectDir: effectiveProjectDir,
        layout: effectiveConfig?.layout,
        router: effectiveConfig?.router,
      });
    }
  } else if (opts.isProxyMode && opts.projectSlug && opts.proxyToken) {
    if (shouldDeferConfigLoad(opts)) {
      logger.debug("Skipping outer config load for exact-source control-plane request", {
        projectSlug: opts.projectSlug,
        projectId: opts.projectId,
        pathname: opts.pathname,
      });
      effectiveConfig = undefined;
      return {
        projectDir: effectiveProjectDir,
        adapter: effectiveAdapter,
        config: effectiveConfig,
        configOutcome: "deferred",
        isLocalProject,
      };
    }

    // Load config via proxy mode with project context.
    // Unlike local projects, proxy mode config loading failures are propagated
    // because proceeding without config causes silent 404s for valid projects.
    // Set only when getHostedConfig itself reports 404, never when some other
    // request in this block does. The catch below spans prepareProxyConfigLoad,
    // the snapshot refresh and runWithContext too, and a 404 from any of those
    // is a real failure that must not be read as "no config published".
    let hostedConfigAbsent = false;

    try {
      effectiveConfig = await timeAsync("config:load-proxy-project", async () => {
        const hosted = await prepareProxyConfigLoad(opts, false);
        const loadCurrentConfig = async (): Promise<VeryfrontConfig> => {
          // Config controls route and primitive discovery, so it must be read
          // from the same current snapshot that those consumers will retain.
          const previewConfigResolution = await resolvePreviewConfigFreshness(
            opts,
            effectiveProjectDir,
            effectiveAdapter,
          );
          const previewConfigFreshness = previewConfigResolution.freshness;
          let configSourceSnapshot = previewConfigResolution.sourceSnapshot;
          const readConfig = () =>
            getHostedConfig(effectiveProjectDir, effectiveAdapter, {
              ...hosted,
              signal: opts.req.signal,
            });

          if (
            previewConfigFreshness === "config-dependent" ||
            previewConfigFreshness === "normal-prepared"
          ) {
            if (configSourceSnapshot === undefined) {
              configSourceSnapshot = await captureRequiredPreviewSourceSnapshotMarker(
                effectiveAdapter.fs,
                opts.projectSlug!,
              );
            }
            let provisionalConfig: VeryfrontConfig | undefined;
            try {
              provisionalConfig = await readConfig();
            } catch (error: unknown) {
              const configAbsent = hasNotFoundStatus(error);
              if (!configAbsent) throw error;
              // Without project config the default dist root remains effective,
              // so a prepared default hit is still authoritative. Validate the
              // generation that proved it before falling through to defaults.
              if (previewConfigFreshness === "normal-prepared") {
                if (configSourceSnapshot !== undefined) {
                  previewDocumentSourceSnapshot = await validatePreviewConfigSourceSnapshot(
                    effectiveAdapter,
                    opts.projectSlug!,
                    configSourceSnapshot,
                  );
                }
                hostedConfigAbsent = true;
                throw error;
              }
            }

            if (
              provisionalConfig !== undefined &&
              await hasPublishedStaticFile(
                effectiveProjectDir,
                effectiveAdapter,
                opts.pathname ?? new URL(opts.req.url).pathname,
                provisionalConfig.build?.outDir,
              )
            ) {
              previewDocumentSourceSnapshot = await validatePreviewConfigSourceSnapshot(
                effectiveAdapter,
                opts.projectSlug!,
                configSourceSnapshot,
              );
              return provisionalConfig;
            }
          }

          if (
            previewConfigFreshness === "strict" ||
            previewConfigFreshness === "config-dependent" ||
            previewConfigFreshness === "normal-prepared"
          ) {
            await ensurePreviewDocumentConfigSourceSnapshotFresh(
              effectiveAdapter.fs,
              opts.projectSlug!,
            );
            configSourceSnapshot = await captureRequiredPreviewSourceSnapshotMarker(
              effectiveAdapter.fs,
              opts.projectSlug!,
            );
          } else if (previewConfigFreshness === "normal") {
            await renewPreviewConfigSourceSnapshot(effectiveAdapter);
          }

          try {
            const config = await readConfig();
            if (configSourceSnapshot !== undefined) {
              previewDocumentSourceSnapshot = await validatePreviewConfigSourceSnapshot(
                effectiveAdapter,
                opts.projectSlug!,
                configSourceSnapshot,
              );
            }
            return config;
          } catch (error: unknown) {
            const configAbsent = hasNotFoundStatus(error);
            if (configSourceSnapshot !== undefined && configAbsent) {
              previewDocumentSourceSnapshot = await validatePreviewConfigSourceSnapshot(
                effectiveAdapter,
                opts.projectSlug!,
                configSourceSnapshot,
              );
            }
            if (configAbsent) hostedConfigAbsent = true;
            throw error;
          }
        };

        if (isExtendedFSAdapter(effectiveAdapter.fs) && effectiveAdapter.fs.runWithContext) {
          return effectiveAdapter.fs.runWithContext(
            opts.projectSlug!,
            opts.proxyToken!,
            loadCurrentConfig,
            opts.projectId,
            {
              productionMode: hosted.sourceContext.productionMode,
              releaseId: hosted.sourceContext.releaseId,
              branch: hosted.sourceContext.branch,
              environmentName: hosted.sourceContext.environmentName,
            },
          );
        }

        return loadCurrentConfig();
      });

      configOutcome = "hosted";

      logger.debug("Loaded config in proxy mode", {
        projectSlug: opts.projectSlug,
        hasConfig: !!effectiveConfig,
        layout: effectiveConfig?.layout,
        router: effectiveConfig?.router,
      });
    } catch (error) {
      // A release with no config file at all is an ordinary project shape, not
      // a failure: the API answers 404 because there is nothing to serve. This
      // used to be re-thrown with everything else, which turned every request
      // for such a project into a 404. Fall through to defaults instead --
      // the same outcome as a project whose config resolves to nothing.
      if (hostedConfigAbsent) {
        // Defaults, not whatever a caller happened to pass in: a project with no
        // published config must not silently inherit another config's routes.
        effectiveConfig = undefined;
        configOutcome = "hosted-absent";
        // Warn, not debug. For a project that publishes no config at all this
        // is routine, but it is indistinguishable here from a project whose
        // config momentarily 404s -- and the two produce the same silently
        // degraded response downstream (platform-default security headers in
        // place of the project's). At debug it was invisible in production
        // while a preview served the wrong CSP on a third of its renders.
        logger.warn("No hosted config for this release; using defaults", {
          projectSlug: opts.projectSlug,
          projectId: opts.projectId,
          releaseId: opts.releaseId,
          proxyEnv: opts.proxyEnv,
          branch: opts.branch ?? null,
          environmentName: opts.environmentName ?? null,
          pathname: opts.pathname ?? null,
        });
      } else {
        // Log at error level — this is a real failure that will affect rendering.
        // Config loading failure in proxy mode means the project's routes, layouts,
        // and settings won't be available, leading to 404s for valid pages.
        logger.error("Failed to load project config in proxy mode", {
          projectSlug: opts.projectSlug,
          projectId: opts.projectId,
          releaseId: opts.releaseId,
          proxyEnv: opts.proxyEnv,
          error: getErrorMessage(error),
        });
        // Re-throw so the caller (runtime-handler) can return a proper error response
        // instead of silently proceeding with broken defaults.
        throw error;
      }
    }
  }

  return {
    projectDir: effectiveProjectDir,
    adapter: effectiveAdapter,
    config: effectiveConfig,
    configOutcome,
    isLocalProject,
    previewDocumentSourceSnapshot,
  };
}
