/**
 * Adapter Factory Module
 *
 * Handles creation and caching of runtime adapters for different project contexts.
 * Supports local projects (filesystem-first) and proxy mode (API-first).
 *
 * @module server/runtime-handler/adapter-factory
 */

import { getBaseLogger } from "#veryfront/utils";
import { CACHE_INVARIANT_VIOLATION, getErrorMessage, SERVICE_OVERLOADED } from "#veryfront/errors";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  hasHostedStyleConfigCapability,
  isExtendedFSAdapter,
} from "#veryfront/platform/adapters/fs/wrapper.ts";
import { getConfig, getHostedConfig } from "#veryfront/config/loader.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { PreparedDeclarativeConfigContext } from "#veryfront/config/declarative-evaluator.ts";
import type { VirtualConfigSourceContext } from "#veryfront/cache/keys.ts";
import { isConfigOptionalControlPlaneRunRequest } from "#veryfront/channels/control-plane.ts";
import { timeAsync } from "./request-lifecycle.ts";
import {
  defaultDiscoveryCache,
  findLocalProjectPath,
  type ProjectDiscoveryCache,
} from "./local-project-discovery.ts";
import type { ParsedDomain } from "../utils/domain-parser.ts";
import { isProxyTopologyTrusted } from "#veryfront/platform/compat/proxy-topology.ts";
import type { RequestTokenProvenance } from "../context/request-context.ts";

const baseLogger = getBaseLogger("SERVER");

const logger = baseLogger.component("adapter-factory");
const MAX_HOSTED_STYLE_CONFIG_LOAD_ATTEMPTS = 2;

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
  /** Exact source already bound to the prepared environment context. */
  readonly sourceContext: VirtualConfigSourceContext;
  /** Detached evaluator context prepared from that same source binding. */
  readonly preparedContext: PreparedDeclarativeConfigContext;
}

interface AdapterResolutionOptions {
  /**
   * Inbound request. Used to determine whether forwarded headers such as
   * `x-project-path` were supplied by an explicitly trusted private edge.
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
  /** Whether private-edge routing bound the token to the resolved project. */
  tokenProvenance?: RequestTokenProvenance;
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
  /** Result of the operator-controlled proxy topology check, when already available. */
  proxyTopologyTrusted?: boolean;
  /** Optional injectable cache (defaults to module-level singleton) */
  cache?: ProjectDiscoveryCache;
  /**
   * Atomically prepare the authenticated source and detached environment
   * context used to evaluate untrusted project config. Required whenever proxy
   * mode loads config, including a trusted `x-project-path` backed by local
   * storage.
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

async function prepareProxyConfigLoad(
  opts: AdapterResolutionOptions,
  isLocalProject: boolean,
): Promise<{
  cacheKey: string;
  sourceContext: VirtualConfigSourceContext;
  preparedContext: PreparedDeclarativeConfigContext;
}> {
  if (!opts.projectSlug || !opts.prepareHostedConfigContext) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: "Proxy project config requires an authenticated declarative evaluation context",
    });
  }

  const prepared = await opts.prepareHostedConfigContext(isLocalProject);
  return {
    cacheKey: opts.projectId ?? opts.projectSlug,
    sourceContext: prepared.sourceContext,
    preparedContext: prepared.preparedContext,
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
  // Only the operator-controlled private-edge topology opt-in grants this
  // authority. A valid dispatch JWS proves signature freshness but is not bound
  // to the selected path, project, audience, or request body.
  const proxyTopologyTrusted = opts.isProxyMode &&
    (opts.proxyTopologyTrusted ?? isProxyTopologyTrusted());
  const trustedHeaderProjectPath = proxyTopologyTrusted
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

    if (usesExactSourceConfig(opts)) {
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
    if (usesExactSourceConfig(opts)) {
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
        const contextualFs = effectiveAdapter.fs;
        if (isExtendedFSAdapter(contextualFs) && contextualFs.runWithContext) {
          const hostedStyleFs = hasHostedStyleConfigCapability(contextualFs)
            ? contextualFs
            : undefined;
          if (contextualFs.isMultiProjectMode() && !hostedStyleFs) {
            throw CACHE_INVARIANT_VIOLATION.create({
              detail: "Multi-project hosted config requires source-qualified style config support",
            });
          }

          return contextualFs.runWithContext(
            opts.projectSlug!,
            opts.proxyToken!,
            async () => {
              // Config controls routing and primitive discovery, so evaluate it
              // from the same current snapshot those consumers will retain.
              await contextualFs.ensureSourceSnapshotFresh?.("config-load");

              if (!hostedStyleFs) {
                return getHostedConfig(effectiveProjectDir, effectiveAdapter, {
                  ...hosted,
                  signal: opts.req.signal,
                });
              }

              for (
                let attempt = 1;
                attempt <= MAX_HOSTED_STYLE_CONFIG_LOAD_ATTEMPTS;
                attempt++
              ) {
                const styleConfigBinding = await hostedStyleFs.createStyleConfigBinding();
                const hostedConfig = await getHostedConfig(
                  effectiveProjectDir,
                  effectiveAdapter,
                  {
                    ...hosted,
                    signal: opts.req.signal,
                  },
                );
                const installed = await hostedStyleFs.installStyleConfig(
                  styleConfigBinding,
                  hostedConfig,
                );
                if (installed) return hostedConfig;

                logger.warn("Hosted source changed while loading style config", {
                  projectSlug: opts.projectSlug,
                  projectId: opts.projectId,
                  sourceKey: styleConfigBinding.sourceKey,
                  sourceRevision: styleConfigBinding.sourceRevision,
                  attempt,
                  maxAttempts: MAX_HOSTED_STYLE_CONFIG_LOAD_ATTEMPTS,
                });
              }

              throw SERVICE_OVERLOADED.create({
                detail:
                  "Hosted project source changed repeatedly while loading configuration; retry the request",
              });
            },
            opts.projectId,
            {
              productionMode: hosted.sourceContext.productionMode,
              releaseId: hosted.sourceContext.releaseId,
              branch: hosted.sourceContext.branch,
              environmentName: hosted.sourceContext.environmentName,
              tokenProvenance: opts.tokenProvenance,
            },
          );
        }

        await effectiveAdapter.fs.ensureSourceSnapshotFresh?.("config-load");
        return getHostedConfig(effectiveProjectDir, effectiveAdapter, {
          ...hosted,
          signal: opts.req.signal,
        });
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
