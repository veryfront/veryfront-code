/**
 * Adapter Factory Module
 *
 * Handles creation and caching of runtime adapters for different project contexts.
 * Supports local projects (filesystem-first) and proxy mode (API-first).
 *
 * @module server/runtime-handler/adapter-factory
 */

import { getBaseLogger } from "#veryfront/utils/logger/logger.ts";
import { getErrorMessage } from "#veryfront/errors/veryfront-error.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { getConfig } from "#veryfront/config/loader.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { timeAsync } from "./request-lifecycle.ts";
import { findLocalProjectPath, localAdapterCache } from "./local-project-discovery.ts";
import type { ParsedDomain } from "../utils/domain-parser.ts";

const baseLogger = getBaseLogger("SERVER");

const logger = baseLogger.component("adapter-factory");

export interface AdapterResolutionResult {
  /** The effective project directory to use */
  projectDir: string;
  /** The adapter to use for this request */
  adapter: RuntimeAdapter;
  /** The config for this project */
  config: VeryfrontConfig | undefined;
  /** Whether this is a local project (filesystem-first) */
  isLocalProject: boolean;
}

export interface AdapterResolutionOptions {
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
  /** Project path from header */
  headerProjectPath: string | undefined;
  /** Whether running in proxy mode */
  isProxyMode: boolean;
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
  let effectiveProjectDir = opts.projectDir;
  let effectiveAdapter = opts.adapter;
  let effectiveConfig = opts.config;

  // Check if this is a local project
  const trustedHeaderProjectPath = opts.isProxyMode ? opts.headerProjectPath : undefined;
  const localProjectPath = opts.projectSlug
    ? await findLocalProjectPath(opts.projectSlug, opts.adapter, trustedHeaderProjectPath)
    : undefined;

  const isLocalProject = !!localProjectPath;

  if (isLocalProject && localProjectPath) {
    effectiveProjectDir = localProjectPath;

    logger.debug("Using local project (filesystem-first)", {
      projectSlug: opts.projectSlug,
      projectDir: effectiveProjectDir,
    });

    // Get or create local adapter
    if (!localAdapterCache.has(effectiveProjectDir)) {
      const baseAdapter = await runtime.get();
      localAdapterCache.set(effectiveProjectDir, baseAdapter);
      logger.debug("Created local adapter for project", {
        projectSlug: opts.projectSlug,
        projectDir: effectiveProjectDir,
      });
    }

    effectiveAdapter = localAdapterCache.get(effectiveProjectDir)!;

    // Load project-specific config
    try {
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
    } catch (error) {
      logger.warn("Failed to load project config, using defaults", {
        projectSlug: opts.projectSlug,
        projectDir: effectiveProjectDir,
        error: getErrorMessage(error),
      });
    }
  } else if (opts.isProxyMode && opts.projectSlug && opts.proxyToken) {
    // Load config via proxy mode with project context.
    // Unlike local projects, proxy mode config loading failures are propagated
    // because proceeding without config causes silent 404s for valid projects.
    try {
      effectiveConfig = await timeAsync("config:load-proxy-project", () => {
        if (isExtendedFSAdapter(effectiveAdapter.fs) && effectiveAdapter.fs.runWithContext) {
          return effectiveAdapter.fs.runWithContext(
            opts.projectSlug!,
            opts.proxyToken!,
            async () => {
              return await getConfig(effectiveProjectDir, effectiveAdapter, {
                cacheKey: opts.projectId ?? opts.projectSlug,
              });
            },
            opts.projectId,
            {
              productionMode: opts.proxyEnv === "production",
              releaseId: opts.releaseId,
              branch: opts.branch ?? opts.parsedDomain.branch ?? null,
              environmentName: opts.environmentName,
            },
          );
        }

        return getConfig(effectiveProjectDir, effectiveAdapter, {
          cacheKey: opts.projectId ?? opts.projectSlug,
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
