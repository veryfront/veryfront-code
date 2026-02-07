/**
 * Server Module Public API
 *
 * This module exports the public interface for the Veryfront server.
 * For routing utilities, import from "#veryfront/routing" directly.
 * For observability utilities, import from "#veryfront/observability" directly.
 *
 * @module server
 * @see docs/deployment.md
 * @see docs/security.md
 */

import {
  DevServer,
  type DevServerOptions,
  type FileWatcherMetrics,
  type RouteDirectory,
  startDevServer,
} from "./dev-server.ts";
import {
  type DiscoveryOptions,
  type ServerHandle,
  startProductionServer,
  type StartProductionServerOptions,
} from "./production-server.ts";

export { DevServer, startDevServer, startProductionServer };
export type {
  DevServerOptions,
  DiscoveryOptions,
  FileWatcherMetrics,
  RouteDirectory,
  ServerHandle,
  StartProductionServerOptions,
};
export { ReloadNotifier } from "./reload-notifier.ts";
export type { BuildOptions, BuildStats } from "./build-types.ts";
export { createVeryfrontHandler } from "./runtime-handler/index.ts";

/** Shared options for both development and production server modes. */
interface BaseServerOptions {
  projectDir: string;
  port: number;
  /** 0.0.0.0 = all interfaces, 127.0.0.1 = localhost only */
  bindAddress?: string;
  signal?: AbortSignal;
  /** Default project slug when not provided via proxy headers (for tests/local mode) */
  defaultProjectSlug?: string;
  /** Default project ID when not provided via proxy headers (for tests/local mode) */
  defaultProjectId?: string;
  /**
   * Optional request interceptor for combined mode.
   * Transforms requests before they're processed by the core request handler.
   */
  requestInterceptor?: (req: Request) => Request | Promise<Request>;
}

export interface StartDevModeOptions extends BaseServerOptions {
  mode: "development";
  hmrPort?: number;
  moduleServerPort?: number;
  enableHMR?: boolean;
  enableFastRefresh?: boolean;
  fileWatcherDebounceMs?: number;
}

export interface StartProductionModeOptions extends BaseServerOptions {
  mode?: "production";
  /** When true, expose additional debug logging. */
  debug?: boolean;
  /** Default environment for standalone mode (preview or production). Defaults to preview for safety. */
  defaultEnvironment?: "preview" | "production";
  /** Discovery configuration for AI primitives. Runs discoverAll() before serving. */
  discoveryConfig?: DiscoveryOptions;
  /** Map of local project slugs to their filesystem paths. */
  localProjects?: Record<string, string>;
}

/**
 * Server options. Use `mode: "development"` for dev server with HMR,
 * or omit/set `mode: "production"` for a production server.
 */
export type StartVeryfrontServerOptions = StartDevModeOptions | StartProductionModeOptions;

export interface VeryfrontServerHandle {
  ready: Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Start a Veryfront server in development or production mode.
 *
 * This is the primary entry point for running a Veryfront server.
 * Defaults to production mode when `mode` is not specified.
 */
export async function startVeryfrontServer(
  options: StartVeryfrontServerOptions,
): Promise<VeryfrontServerHandle> {
  if (options.mode === "development") {
    const devServer = await startDevServer({
      port: options.port,
      projectDir: options.projectDir,
      bindAddress: options.bindAddress,
      hmrPort: options.hmrPort,
      moduleServerPort: options.moduleServerPort,
      enableHMR: options.enableHMR,
      enableFastRefresh: options.enableFastRefresh,
      fileWatcherDebounceMs: options.fileWatcherDebounceMs,
      signal: options.signal,
      requestInterceptor: options.requestInterceptor,
      defaultProjectSlug: options.defaultProjectSlug,
      defaultProjectId: options.defaultProjectId,
    });
    return {
      ready: devServer.ready,
      stop: () => devServer.stop(),
    };
  }

  // Production mode (explicit or default when mode is omitted)
  return await startProductionServer({
    projectDir: options.projectDir,
    port: options.port,
    bindAddress: options.bindAddress,
    signal: options.signal,
    defaultProjectSlug: options.defaultProjectSlug,
    defaultProjectId: options.defaultProjectId,
    requestInterceptor: options.requestInterceptor,
    defaultEnvironment: options.defaultEnvironment,
    discoveryConfig: options.discoveryConfig,
    localProjects: options.localProjects,
    debug: options.debug,
  });
}

// Note: Wildcard re-exports removed to prevent circular dependency risks.
// Import from "#veryfront/routing" for Route, RouteMatch, DynamicRouter, etc.
// Import from "#veryfront/observability" for tracing and metrics utilities.
