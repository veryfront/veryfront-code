/**
 * Adapter Factory Module
 *
 * Handles creation and caching of runtime adapters for different project contexts.
 * Supports local projects (filesystem-first) and proxy mode (API-first).
 *
 * @module server/runtime-handler/adapter-factory
 */

import { getBaseLogger } from "#veryfront/utils";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getConfig, mergeConfigs } from "#veryfront/config/loader.ts";
import type { VeryfrontConfig } from "#veryfront/config";
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
}

function usesExactSourceConfig(opts: AdapterResolutionOptions): boolean {
  return opts.isProxyMode &&
    !!opts.projectSlug &&
    !!opts.proxyToken &&
    isConfigOptionalControlPlaneRunRequest(opts.req.method, opts.pathname);
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
  // In proxy mode, skip local discovery unless there's an explicit header path override.
  // the standard directories (data/projects/, projects/) don't exist in k8s.
  //
  // SECURITY: `x-project-path` is a client-controlled header. Honouring it from any
  // request would let an attacker reaching the runtime directly aim project discovery
  // (and therefore `/_veryfront/fs/...`) at arbitrary filesystem paths (VULN-SRV-3).
  // Only read it when the request is proxy-trusted: either the operator opted in via
  // VERYFRONT_TRUST_FORWARDED_HEADERS=1, or the request carries a dispatch JWS that
  // verifies against CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY. Mere header presence is
  // NOT sufficient. A direct-access attacker could otherwise spoof `x-project-path`
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

    logger.debug("Using local project (filesystem-first)");

    // Get or create local adapter
    if (!cache.adapters.has(effectiveProjectDir)) {
      const baseAdapter = await runtime.get();
      cache.adapters.set(effectiveProjectDir, baseAdapter);
      logger.debug("Created local adapter for project");
    }

    effectiveAdapter = cache.adapters.get(effectiveProjectDir)!;

    if (usesExactSourceConfig(opts)) {
      effectiveConfig = undefined;
    } else {
      effectiveConfig = await timeAsync(
        "config:load-project",
        () => getConfig(effectiveProjectDir, effectiveAdapter),
      );

      logger.debug("Loaded project-specific config");
    }
  } else if (opts.isProxyMode && opts.projectSlug && opts.proxyToken) {
    if (usesExactSourceConfig(opts)) {
      logger.debug("Skipping outer config load for exact-source control-plane request");
      effectiveConfig = undefined;
      return {
        projectDir: effectiveProjectDir,
        adapter: effectiveAdapter,
        config: effectiveConfig,
        isLocalProject,
      };
    }

    // A virtual project config is executable TypeScript. Importing it here would
    // execute remote project code in the shared host before a route reaches its
    // worker or fail-closed boundary. Remote requests therefore use only the
    // trusted host configuration merged over fresh framework defaults. Features
    // that require executable project config must resolve it inside their own
    // isolated execution boundary.
    effectiveConfig = mergeConfigs(opts.config ?? {});
    logger.debug("Using trusted host config for remote project");
  }

  return {
    projectDir: effectiveProjectDir,
    adapter: effectiveAdapter,
    config: effectiveConfig,
    isLocalProject,
  };
}
