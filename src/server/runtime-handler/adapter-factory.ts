/**
 * Adapter Factory Module
 *
 * Handles creation and caching of runtime adapters for different project contexts.
 * Supports local projects (filesystem-first) and proxy mode (API-first).
 *
 * @module server/runtime-handler/adapter-factory
 */

import { getBaseLogger } from "#veryfront/utils";
import { CACHE_INVARIANT_VIOLATION, getErrorMessage } from "#veryfront/errors";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { getConfig, getHostedConfig } from "#veryfront/config/loader.ts";
import type { PreparedDeclarativeConfigContext } from "#veryfront/config/declarative-evaluator.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { VirtualConfigSourceContext } from "#veryfront/cache/keys.ts";
import { isConfigOptionalControlPlaneRunRequest } from "#veryfront/channels/control-plane.ts";
import { timeAsync } from "./request-lifecycle.ts";
import {
  defaultDiscoveryCache,
  findLocalProjectPath,
  type ProjectDiscoveryCache,
} from "./local-project-discovery.ts";
import type { ParsedDomain } from "../utils/domain-parser.ts";
import { isProxyTrusted } from "../utils/proxy-trust.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";

const baseLogger = getBaseLogger("SERVER");

const logger = baseLogger.component("adapter-factory");

interface AdapterResolutionResult {
  /** The effective project directory to use */
  projectDir: string;
  /** The adapter to use for this request */
  adapter: RuntimeAdapter;
  /** The config for this project */
  config: VeryfrontConfig | undefined;
  /** Whether this is a local project (filesystem-first) */
  isLocalProject: boolean;
}

interface PreparedHostedConfigLoad {
  readonly sourceContext: VirtualConfigSourceContext;
  readonly preparedContext: PreparedDeclarativeConfigContext;
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
  ) => Promise<PreparedHostedConfigLoad>;
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

async function prepareProxyConfigLoad(
  opts: AdapterResolutionOptions,
  isLocalProject: boolean,
): Promise<PreparedHostedConfigLoad & { cacheKey: string }> {
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

  // Check if this is a local project.
  // In proxy mode, skip local discovery unless there's an explicit header path override —
  // the standard directories (data/projects/, projects/) don't exist in k8s.
  //
  // SECURITY: `x-project-path` is a client-controlled header. Honouring it from any
  // request would let an attacker reaching the runtime directly aim project discovery
  // (and therefore `/_veryfront/fs/...`) at arbitrary filesystem paths (VULN-SRV-3).
  // Only read it when the request is proxy-trusted: either the operator opted in via
  // VERYFRONT_TRUST_FORWARDED_HEADERS=1, or the request carries a dispatch JWS that
  // verifies against CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY. Mere header presence is
  // NOT sufficient — a direct-access attacker could otherwise spoof `x-project-path`
  // by attaching any value in `x-veryfront-dispatch-jws`.
  const publicKeyPem = opts.adapter.env.get("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY") ??
    getHostEnv("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
  const proxyTrusted = opts.isProxyMode &&
    (opts.proxyTrusted ?? await isProxyTrusted(opts.req, { publicKeyPem }));
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

    // Get or create local adapter
    if (!cache.adapters.has(effectiveProjectDir)) {
      const baseAdapter = await runtime.get();
      cache.adapters.set(effectiveProjectDir, baseAdapter);
      logger.debug("Created local adapter for project", {
        projectSlug: opts.projectSlug,
        projectDir: effectiveProjectDir,
      });
    }

    effectiveAdapter = cache.adapters.get(effectiveProjectDir)!;

    if (shouldDeferConfigLoad(opts)) {
      effectiveConfig = undefined;
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
    } else {
      effectiveConfig = await timeAsync(
        "config:load-project",
        () => getConfig(effectiveProjectDir, effectiveAdapter),
      );

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
        isLocalProject,
      };
    }

    // Load config via proxy mode with project context.
    // Unlike local projects, proxy mode config loading failures are propagated
    // because proceeding without config causes silent 404s for valid projects.
    try {
      effectiveConfig = await timeAsync("config:load-proxy-project", async () => {
        const hosted = await prepareProxyConfigLoad(opts, false);
        const loadCurrentConfig = async (): Promise<VeryfrontConfig> => {
          // Config controls route and primitive discovery, so it must be read
          // from the same current snapshot that those consumers will retain.
          await effectiveAdapter.fs.ensureSourceSnapshotFresh?.("config-load");
          return await getHostedConfig(effectiveProjectDir, effectiveAdapter, {
            ...hosted,
            signal: opts.req.signal,
          });
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

      logger.debug("Loaded config in proxy mode", {
        projectSlug: opts.projectSlug,
        hasConfig: !!effectiveConfig,
        layout: effectiveConfig?.layout,
        router: effectiveConfig?.router,
      });
    } catch (error) {
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

  return {
    projectDir: effectiveProjectDir,
    adapter: effectiveAdapter,
    config: effectiveConfig,
    isLocalProject,
  };
}
