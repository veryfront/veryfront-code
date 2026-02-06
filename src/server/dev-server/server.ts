import { serverLogger as logger } from "#veryfront/utils";
import { buildLocalhostUrl, LOCALHOST } from "#veryfront/config";
import type { RuntimeAdapter, Server } from "#veryfront/platform/adapters/base.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { DynamicRouter } from "#veryfront/routing/api/index.ts";
import { ComponentRegistry } from "#veryfront/modules/component-registry/index.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { MiddlewarePipeline } from "#veryfront/middleware/core/pipeline/index.ts";
import { bootstrapDev } from "../bootstrap.ts";
import { HMRServer } from "./hmr-server.ts";
import { ReloadNotifier } from "../reload-notifier.ts";
import type { DevServerOptions } from "./types.ts";
import { RequestHandler } from "./request-handler.ts";
import { setupMiddleware } from "./middleware.ts";
import { RouteDiscovery } from "./route-discovery.ts";
import { FileWatchSetup } from "./file-watch-setup.ts";
import {
  enableSSRClientOnlyFetching,
  enableSSRFetchInterception,
  setSSRServerPort,
} from "#veryfront/rendering/ssr-globals.ts";
import { setEnv } from "#veryfront/platform/compat/process.ts";
import { clearTranspileCache, discoverAll } from "#veryfront/discovery";
import type { DiscoveryConfig } from "#veryfront/discovery";

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
      const { isRSCEnabled } = await import("#veryfront/utils/feature-flags.ts");
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

    // Auto-discover AI primitives (tools, agents, workflows, prompts, resources)
    await this.runAIDiscovery();

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
        logger.debug("[DevServer] INVALIDATE callback triggered - clearing runtime handler");
        this.requestHandler?.invalidateCoreHandler();
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
      this.options.defaultProjectSlug,
      this.options.defaultProjectId,
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
    const baseHandler = (req: Request) => this.pipeline.execute(req, this.adapter.env.toObject());
    const interceptor = this.options.requestInterceptor;
    const handler = interceptor
      ? async (req: Request) => {
        const isWebSocketUpgrade = req.headers.get("upgrade")?.toLowerCase() === "websocket";
        if (isWebSocketUpgrade) return baseHandler(req);

        const interceptedReq = await interceptor(req);
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

  private buildDiscoveryConfig(): DiscoveryConfig {
    const ai = this.appConfig?.ai;
    return {
      baseDir: this.options.projectDir,
      toolDirs: ai?.tools?.discovery?.paths ?? ["tools"],
      agentDirs: ai?.agents?.discovery?.paths ?? ["agents"],
      resourceDirs: ["resources"],
      promptDirs: ["prompts"],
      workflowDirs: ["workflows"],
      fsAdapter: this.adapter.fs,
      verbose: this.isDebug(),
    };
  }

  private async runAIDiscovery(): Promise<void> {
    try {
      const config = this.buildDiscoveryConfig();
      const result = await discoverAll(config);
      const total = result.tools.size + result.agents.size + result.workflows.size +
        result.prompts.size + result.resources.size;
      if (total > 0) {
        logger.debug(
          `[Discovery] Registered ${result.tools.size} tools, ${result.agents.size} agents, ` +
            `${result.workflows.size} workflows, ${result.prompts.size} prompts, ${result.resources.size} resources`,
        );
      }
    } catch (error) {
      logger.debug("[DevServer] AI discovery skipped:", error);
    }
  }

  async rediscoverAI(): Promise<void> {
    try {
      clearTranspileCache();
      const config = this.buildDiscoveryConfig();
      const result = await discoverAll(config);
      logger.info(
        `[HMR] Re-discovered AI primitives: ${result.tools.size} tools, ${result.agents.size} agents, ${result.workflows.size} workflows`,
      );
    } catch (error) {
      logger.warn("[HMR] AI re-discovery failed:", error);
    }
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
    const ai = this.appConfig?.ai;
    const aiDirNames = [
      ...(ai?.tools?.discovery?.paths ?? ["tools"]),
      ...(ai?.agents?.discovery?.paths ?? ["agents"]),
      "resources",
      "prompts",
      "workflows",
    ];
    this.fileWatchSetup = new FileWatchSetup(
      this.options.projectDir,
      this.adapter,
      this.hmrServer,
      routeDiscovery,
      debounceMs,
      () => this.requestHandler?.invalidateCoreHandler(),
      this,
      aiDirNames,
    );

    await this.fileWatchSetup.setup();
  }

  getFileWatcherMetrics(): ReturnType<FileWatchSetup["getMetrics"]> | null {
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
