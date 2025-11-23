import { serverLogger as logger } from "@veryfront/utils";
import { buildLocalhostUrl, LOCALHOST } from "@veryfront/config";
import type { RuntimeAdapter, Server } from "@veryfront/platform/adapters/base.ts";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { DynamicRouter } from "@veryfront/routing/api/index.ts";
import { ComponentRegistry } from "@veryfront/modules/component-registry/index.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import { MiddlewarePipeline } from "@veryfront/middleware/core/pipeline/index.ts";
import { bootstrapDev } from "../bootstrap.ts";
import { HMRServer } from "./hmr-server.ts";
import type { DevServerOptions } from "./types.ts";
import { RequestHandler } from "./request-handler.ts";
import { setupMiddleware } from "./middleware.ts";
import { RouteDiscovery } from "./route-discovery.ts";
import { FileWatchSetup } from "./file-watch-setup.ts";

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

  constructor(private options: DevServerOptions) {
    this.ready = new Promise<void>((resolve) => {
      this._resolveReady = resolve;
    });
    this.router = new DynamicRouter();
    this.pipeline = new MiddlewarePipeline();
  }

  private isDebug(): boolean {
    return !!this.adapter?.env.get("VERYFRONT_DEBUG");
  }

  private async logRSCStatus(): Promise<void> {
    try {
      const { isRSCEnabled } = await import("@veryfront/utils/feature-flags.ts");
      const rsc = isRSCEnabled(this.appConfig);
      const stub = this.adapter.env.get("VERYFRONT_FORCE_FLIGHT_STUB") === "1" ? " (stub)" : "";
      logger.info(`[RSC] ${rsc ? "enabled" : "disabled"}${rsc ? stub : ""}`);
    } catch {
      /* optional */
    }
  }

  async start(): Promise<void> {
    const baseAdapter = await getAdapter();
    logger.info(`Using ${baseAdapter.name} runtime adapter`);

    const bootstrap = await bootstrapDev(this.options.projectDir, baseAdapter);
    this.adapter = bootstrap.adapter;
    this.appConfig = bootstrap.config;

    if (bootstrap.usingFSAdapter) {
      logger.info(`[FSAdapter] Using ${bootstrap.fsAdapterType} backend`);
    }

    logger.info("Starting dev server", {
      port: this.options.port,
      projectDir: this.options.projectDir,
      hmr: this.options.enableHMR,
      fastRefresh: this.options.enableFastRefresh,
    });

    await this.logRSCStatus();

    // Module serving is now handled by the main server at /_vf_modules/
    // No separate module server needed
    if (this.options.enableHMR) {
      this.hmrServer = new HMRServer({
        port: this.options.hmrPort || this.options.port + 1,
        projectDir: this.options.projectDir,
        reactRefresh: this.options.enableFastRefresh,
      });
      await this.hmrServer.start();
      await this.setupFileWatchers();
    }

    // Module server is integrated into main server now
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

    await Promise.all([
      this.componentRegistry.discover(),
      routeDiscovery.discoverRoutes(),
    ]);

    const requestHandler = new RequestHandler(
      this.options.projectDir,
      this.adapter,
      () => this._isReady,
      () => this.isDebug(),
      this.hmrServer,
    );
    this.requestHandler = requestHandler;

    setupMiddleware(
      this.pipeline,
      this.appConfig!,
      (req) => requestHandler.handleRequest(req),
    );

    this.server = await this.adapter.serve(
      (req: Request) => this.pipeline.execute(req, this.adapter.env.toObject()),
      {
        port: this.options.port,
        hostname: LOCALHOST.IPV4,
        signal: this.options.signal,
        onListen: ({ hostname: _hostname, port }: { hostname: string; port: number }) => {
          const url = buildLocalhostUrl(port);
          logger.info(`Dev server running at ${url}`);

          try {
            this._isReady = true;
            this._resolveReady?.();
          } catch (error) {
            logger.debug("[dev] mark ready failed", error);
          }
        },
      },
    );
    this._isReady = true;
  }

  private async setupFileWatchers(): Promise<void> {
    if (!this.hmrServer) return;

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

    if (this.fileWatchSetup) {
      const metrics = this.fileWatchSetup.getMetrics();
      if (metrics) {
        logger.info("[HMR] Final performance metrics", metrics);
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

    // Note: Cache cleanup is handled by cleanupRenderers() above
    // The cache module no longer exports a singleton cache instance
  }
}
