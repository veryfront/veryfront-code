import * as dntShim from "../../../_dnt.shims.js";
import { serverLogger as logger } from "../../utils/index.js";
import { buildLocalhostUrl, LOCALHOST } from "../../config/index.js";
import type { RuntimeAdapter, Server } from "../../platform/adapters/base.js";
import { runtime } from "../../platform/adapters/detect.js";
import { DynamicRouter } from "../../routing/api/index.js";
import { ComponentRegistry } from "../../modules/component-registry/index.js";
import type { VeryfrontConfig } from "../../config/index.js";
import { MiddlewarePipeline } from "../../middleware/core/pipeline/index.js";
import { bootstrapDev } from "../bootstrap.js";
import { HMRServer } from "./hmr-server.js";
import { ReloadNotifier } from "../reload-notifier.js";
import type { DevServerOptions } from "./types.js";
import { RequestHandler } from "./request-handler.js";
import { setupMiddleware } from "./middleware.js";
import { RouteDiscovery } from "./route-discovery.js";
import { FileWatchSetup } from "./file-watch-setup.js";
import {
  enableSSRClientOnlyFetching,
  enableSSRFetchInterception,
  setSSRServerPort,
} from "../../rendering/ssr-globals.js";
import { setEnv } from "../../platform/compat/process.js";

export class DevServer {
  private router: DynamicRouter;
  private componentRegistry!: ComponentRegistry;
  private hmrServer?: HMRServer;
  private fileWatchSetup?: FileWatchSetup;
  private pipeline: MiddlewarePipeline;
  private adapter!: RuntimeAdapter;
  private server?: Server;
  private appConfig: VeryfrontConfig | undefined;
  private requestHandler?: RequestHandler;
  public readonly ready: Promise<void>;
  private _resolveReady!: () => void;
  private _isReady = false;
  private reloadUnsubscribe?: () => void;
  private invalidateUnsubscribe?: () => void;

  constructor(private options: DevServerOptions) {
    this.ready = new Promise<void>((resolve) => {
      this._resolveReady = resolve;
    });
    this.router = new DynamicRouter();
    this.pipeline = new MiddlewarePipeline();
  }

  private isDebug(): boolean {
    return this.adapter?.env.get("VERYFRONT_DEBUG") === "1";
  }

  private async logRSCStatus(): Promise<void> {
    try {
      const { isRSCEnabled } = await import("../../utils/feature-flags.js");
      const rsc = isRSCEnabled(this.appConfig);
      const stub = this.adapter.env.get("VERYFRONT_FORCE_FLIGHT_STUB") === "1" ? " (stub)" : "";
      logger.debug(`[RSC] ${rsc ? "enabled" : "disabled"}${rsc ? stub : ""}`);
    } catch {
      /* optional */
    }
  }

  async start(): Promise<void> {
    const baseAdapter = await runtime.get();
    logger.debug(`Using ${baseAdapter.name} runtime adapter`);

    const bootstrap = await bootstrapDev(this.options.projectDir, baseAdapter);
    this.adapter = bootstrap.adapter;
    this.appConfig = bootstrap.config;

    // Merge CLI enableHMR flag into config to ensure HMR scripts are disabled when --no-hmr is passed
    if (this.appConfig && this.options.enableHMR === false) {
      this.appConfig = {
        ...this.appConfig,
        dev: {
          ...this.appConfig.dev,
          hmr: false,
        },
      };
    }

    if (bootstrap.usingFSAdapter) {
      logger.debug(`[FSAdapter] Using ${bootstrap.fsAdapterType} backend`);
    }

    logger.debug("Starting dev server", {
      port: this.options.port,
      projectDir: this.options.projectDir,
      hmr: this.options.enableHMR,
      fastRefresh: this.options.enableFastRefresh,
    });

    // Set VERYFRONT_DEV_PORT for ESM module loader HTTP fallback
    // This ensures the correct port is used when fetching modules via localhost
    setEnv("VERYFRONT_DEV_PORT", String(this.options.port));

    // Enable SSR fetch interception for local development
    // This rewrites fetch URLs from project domains to localhost
    setSSRServerPort(this.options.port);
    enableSSRFetchInterception();
    // Enable client-only fetching: API fetches don't complete during SSR,
    // causing React Query to suspend and render fallbacks instead of data.
    // This prevents hydration mismatches between SSR and client.
    enableSSRClientOnlyFetching();

    await this.logRSCStatus();

    if (this.options.enableHMR) {
      this.hmrServer = new HMRServer({
        port: this.options.hmrPort || this.options.port + 1,
        projectDir: this.options.projectDir,
        reactRefresh: this.options.enableFastRefresh,
        adapter: this.adapter,
      });

      await this.hmrServer.start();
      await this.setupFileWatchers();

      // Subscribe to immediate invalidation for cache clearing (fires immediately)
      this.invalidateUnsubscribe = ReloadNotifier.subscribeInvalidate(() => {
        logger.debug("[DevServer] INVALIDATE callback triggered - clearing universal handler");
        this.requestHandler?.invalidateUniversalHandler();
      });

      // Subscribe to debounced reload for browser refresh (batches rapid changes)
      this.reloadUnsubscribe = ReloadNotifier.subscribe(() => {
        logger.debug("[DevServer] RELOAD callback triggered - sending HMR reload to browser");
        this.hmrServer?.sendUpdate({ type: "reload", timestamp: Date.now() });
      });

      logger.debug("[DevServer] ReloadNotifier subscriptions registered", {
        hasHmrServer: !!this.hmrServer,
      });
    }

    const moduleServerUrl = buildLocalhostUrl(this.options.port);
    const vendorBundleHash = "dev-vendor-bundle";

    this.componentRegistry = new ComponentRegistry({
      projectDir: this.options.projectDir,
      adapter: this.adapter,
      moduleServerUrl,
      vendorBundleHash,
    });

    const routeDiscovery = new RouteDiscovery(
      this.options.projectDir,
      this.adapter,
      this.router,
      this.appConfig,
    );

    const isProxyMode = this.appConfig?.fs?.veryfront?.proxyMode === true;
    if (isProxyMode) {
      logger.debug("[DevServer] Skipping component/route discovery in proxy mode");
    } else {
      await Promise.all([this.componentRegistry.discover(), routeDiscovery.discoverRoutes()]);
    }

    const requestHandler = new RequestHandler(
      this.options.projectDir,
      this.adapter,
      () => this._isReady,
      () => this.isDebug(),
      this.hmrServer,
      this.appConfig,
    );
    this.requestHandler = requestHandler;

    await setupMiddleware(
      this.pipeline,
      this.appConfig!,
      (req) => requestHandler.handleRequest(req),
      this.options.projectDir,
      this.adapter,
    );

    // NOTE: WebSocket upgrade requests MUST NOT be intercepted because the interceptor
    // creates a new Request object, which breaks Deno.upgradeWebSocket() - it needs
    // the original request to maintain the connection.
    const baseHandler = (req: dntShim.Request) => this.pipeline.execute(req, this.adapter.env.toObject());
    const handler = this.options.requestInterceptor
      ? async (req: dntShim.Request) => {
        const isWebSocketUpgrade = req.headers.get("upgrade")?.toLowerCase() === "websocket";
        if (isWebSocketUpgrade) return baseHandler(req);

        const interceptedReq = await this.options.requestInterceptor!(req);
        return baseHandler(interceptedReq);
      }
      : baseHandler;

    this.server = await this.adapter.serve(handler, {
      port: this.options.port,
      hostname: LOCALHOST.IPV4,
      signal: this.options.signal,
      onListen: ({ port }: { hostname: string; port: number }) => {
        const url = buildLocalhostUrl(port);
        logger.info(`Dev server running at ${url}`);

        try {
          this._isReady = true;
          this._resolveReady();
        } catch (error) {
          logger.debug("[dev] mark ready failed", error);
        }
      },
    });

    this._isReady = true;
  }

  private async setupFileWatchers(): Promise<void> {
    if (!this.hmrServer) return;

    const isProxyMode = this.appConfig?.fs?.veryfront?.proxyMode === true;
    if (isProxyMode) {
      logger.debug("[DevServer] Skipping file watchers in proxy mode");
      return;
    }

    const routeDiscovery = new RouteDiscovery(
      this.options.projectDir,
      this.adapter,
      this.router,
      this.appConfig,
    );

    const debounceMs = this.options.fileWatcherDebounceMs ?? 100;
    this.fileWatchSetup = new FileWatchSetup(
      this.options.projectDir,
      this.adapter,
      this.hmrServer,
      routeDiscovery,
      debounceMs,
      () => this.requestHandler?.invalidateUniversalHandler(),
    );

    await this.fileWatchSetup.setup();
  }

  getFileWatcherMetrics() {
    return this.fileWatchSetup?.getMetrics() ?? null;
  }

  async stop(): Promise<void> {
    logger.info("Shutting down dev server...");

    this.reloadUnsubscribe?.();
    this.invalidateUnsubscribe?.();

    if (this.fileWatchSetup) {
      const metrics = this.fileWatchSetup.getMetrics();
      if (metrics) {
        logger.debug("[HMR] Final performance metrics", metrics);
      }
      this.fileWatchSetup.cleanup();
    }

    if (this.hmrServer) {
      await this.hmrServer.stop();
    }

    if (this.server) {
      try {
        await this.server.stop();
      } catch (error) {
        logger.warn("Error stopping server:", error);
      }
    }

    try {
      await this.pipeline.teardown();
    } catch (error) {
      logger.debug("[DevServer] Pipeline teardown error (non-critical)", error);
    }
  }
}
