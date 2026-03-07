import { serverLogger as logger } from "#veryfront/utils";
import { buildLocalhostUrl, LOCALHOST } from "#veryfront/config";
import { basename } from "#veryfront/compat/path";
import type { RuntimeAdapter, Server } from "#veryfront/platform/adapters/base.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { DynamicRouter } from "#veryfront/routing/api/index.ts";
import { ComponentRegistry } from "#veryfront/modules/component-registry/index.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { MiddlewarePipeline } from "#veryfront/middleware/core/pipeline/index.ts";
import { bootstrapDev } from "../bootstrap.ts";
import { ReloadNotifier } from "../reload-notifier.ts";
import { broadcastUpdate } from "../handlers/preview/hmr-message-router.ts";
import { HMRHandler } from "../handlers/preview/hmr.handler.ts";
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
import { initializeDistributedCaches } from "#veryfront/cache/distributed-cache-init.ts";
import { isDiskCacheConfigured } from "#veryfront/cache/backend.ts";
import { clearTranspileCache, discoverAll } from "#veryfront/discovery";
import type { DiscoveryConfig } from "#veryfront/discovery";

const rscLog = logger.component("rsc");
const fsAdapterLog = logger.component("fs-adapter");
const devServerLog = logger.component("dev-server");
const devLog = logger.component("dev");
const hmrLog = logger.component("hmr");

function normalizeSlug(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function deriveProjectSlug(projectDir: string): string {
  const dirName = basename(projectDir);
  const slug = dirName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || "local-project";
}

export class DevServer {
  private router: DynamicRouter;
  private componentRegistry!: ComponentRegistry;
  private fileWatchSetup?: FileWatchSetup;
  private pipeline: MiddlewarePipeline;
  private adapter!: RuntimeAdapter;
  private server?: Server;
  private appConfig: VeryfrontConfig | undefined;
  private requestHandler?: RequestHandler;
  private _handler?: (req: Request) => Promise<Response>;
  readonly ready: Promise<void>;
  private _resolveReady!: () => void;
  private _isReady = false;
  private reloadUnsubscribe?: () => void;
  private invalidateUnsubscribe?: () => void;
  private releaseExternalBroadcastSource?: () => void;

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
      rscLog.debug(`${rsc ? "enabled" : "disabled"}${rsc ? stub : ""}`);
    } catch (_) {
      /* expected: optional feature detection for RSC */
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
      fsAdapterLog.debug(`Using ${bootstrap.fsAdapterType} backend`);
    }

    logger.debug("Starting dev server", {
      port: this.options.port,
      bindAddress: this.options.bindAddress ?? LOCALHOST.IPV4,
      projectDir: this.options.projectDir,
      hmr: this.options.enableHMR,
      fastRefresh: this.options.enableFastRefresh,
    });

    if (this.options.hmrPort !== undefined) {
      devServerLog.warn(
        "`hmrPort` is deprecated and ignored. HMR now uses /_ws on the main dev server port.",
        { hmrPort: this.options.hmrPort, serverPort: this.options.port },
      );
    }

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

    // Initialize disk cache in dev mode when explicitly configured
    if (isDiskCacheConfigured()) {
      void initializeDistributedCaches().catch((error: unknown) => {
        logger.debug("[DevServer] Cache initialization failed, using memory fallback", { error });
      });
    }

    // Auto-discover AI primitives (tools, agents, workflows, prompts, resources)
    await this.runAIDiscovery();

    if (this.options.enableHMR) {
      await this.setupFileWatchers();

      // Subscribe to immediate invalidation for cache clearing (fires immediately)
      this.invalidateUnsubscribe = ReloadNotifier.subscribeInvalidate(() => {
        devServerLog.debug("INVALIDATE callback triggered - clearing runtime handler");
        this.requestHandler?.invalidateRuntimeHandler();
      });

      // Subscribe to debounced reload for broadcasting updates to connected HMR clients.
      // This subscription must be eagerly registered here rather than lazily inside
      // HMRHandler.initialize(), because HMRHandler.initialize() only runs when the
      // first /_ws WebSocket request arrives. If that connection fails or hasn't
      // happened yet, file changes are silently lost.
      this.releaseExternalBroadcastSource = HMRHandler.registerExternalBroadcastSource();
      this.reloadUnsubscribe = ReloadNotifier.subscribe((changedPaths, project) => {
        hmrLog.debug("RELOAD callback triggered - broadcasting to HMR clients", {
          changedPaths,
          projectSlug: project?.projectSlug,
        });
        // Broadcast without projectSlug filter so that connectHMR() clients
        // (which are registered without a projectSlug) also receive updates.
        broadcastUpdate(changedPaths);
      });

      hmrLog.debug("ReloadNotifier subscriptions registered (invalidate + reload broadcast)");
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
      devServerLog.debug("Skipping component/route discovery in proxy mode");
    } else {
      await Promise.all([this.componentRegistry.discover(), routeDiscovery.discoverRoutes()]);
    }

    const defaultProjectSlug = await this.resolveDefaultProjectSlug(isProxyMode);
    const localProjects = this.buildLocalProjects(defaultProjectSlug);

    const requestHandler = new RequestHandler(
      this.options.projectDir,
      this.adapter,
      () => this._isReady,
      () => this.isDebug(),
      this.appConfig,
      defaultProjectSlug,
      this.options.defaultProjectId,
      localProjects,
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

    this._handler = handler;

    if (this.options.handlerOnly) {
      this._isReady = true;
      this._resolveReady();
      return;
    }

    this.server = await this.adapter.serve(handler, {
      port: this.options.port,
      hostname: this.options.bindAddress ?? LOCALHOST.IPV4,
      signal: this.options.signal,
      onListen: ({ port }: { hostname: string; port: number }) => {
        const url = buildLocalhostUrl(port);
        logger.info(`Dev server running at ${url}`);

        try {
          this._isReady = true;
          this._resolveReady();
        } catch (error) {
          devLog.debug("mark ready failed", error);
        }
      },
    });

    this._isReady = true;
  }

  /** Returns the request handler for use with external HTTP servers. */
  get handler(): (req: Request) => Promise<Response> {
    if (!this._handler) throw new Error("DevServer not started. Call start() first.");
    return this._handler;
  }

  private buildDiscoveryConfig(): DiscoveryConfig {
    const ai = this.appConfig?.ai;
    const skillDiscoveryEnabled = ai?.skills?.discovery?.enabled ?? true;
    return {
      baseDir: this.options.projectDir,
      toolDirs: ai?.tools?.discovery?.paths ?? ["tools"],
      agentDirs: ai?.agents?.discovery?.paths ?? ["agents"],
      skillDirs: skillDiscoveryEnabled ? (ai?.skills?.discovery?.paths ?? ["skills"]) : [],
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
      const total = result.tools.size + result.agents.size + result.skills.size +
        result.workflows.size + result.prompts.size + result.resources.size;
      if (total > 0) {
        logger.debug(
          `[Discovery] Registered ${result.tools.size} tools, ${result.agents.size} agents, ` +
            `${result.skills.size} skills, ${result.workflows.size} workflows, ` +
            `${result.prompts.size} prompts, ${result.resources.size} resources`,
        );
      }
    } catch (error) {
      devServerLog.debug("AI discovery skipped:", error);
    }
  }

  private async resolveDefaultProjectSlug(isProxyMode: boolean): Promise<string | undefined> {
    const explicitSlug = normalizeSlug(this.options.defaultProjectSlug);
    if (explicitSlug) return explicitSlug;

    const configuredSlug = normalizeSlug(this.appConfig?.fs?.veryfront?.projectSlug);
    if (configuredSlug) return configuredSlug;

    const defaultProjectId = normalizeSlug(this.options.defaultProjectId);
    if (defaultProjectId) return defaultProjectId;

    if (isProxyMode) return undefined;

    // Check if this is a multi-project directory (has projects/ but no direct project files)
    if (await this.isMultiProjectDirectory()) {
      return undefined;
    }

    return deriveProjectSlug(this.options.projectDir);
  }

  private async isMultiProjectDirectory(): Promise<boolean> {
    const projectDir = this.options.projectDir;
    const fs = this.adapter.fs;

    // First check: no direct project files (app/, pages/, or config)
    const [hasApp, hasPages, hasConfigTs, hasConfigJs, hasConfigMjs] = await Promise.all([
      fs.exists(`${projectDir}/app`),
      fs.exists(`${projectDir}/pages`),
      fs.exists(`${projectDir}/veryfront.config.ts`),
      fs.exists(`${projectDir}/veryfront.config.js`),
      fs.exists(`${projectDir}/veryfront.config.mjs`),
    ]);

    // If we have direct project files, this is a single project
    if (hasApp || hasPages || hasConfigTs || hasConfigJs || hasConfigMjs) return false;

    // Second check: has at least one standard project directory with subdirectories
    const standardDirs = ["data/projects", "projects", "examples"];
    for (const dir of standardDirs) {
      const fullPath = `${projectDir}/${dir}`;
      if (await this.hasProjectSubdirectories(fullPath)) {
        return true;
      }
    }

    return false;
  }

  private async hasProjectSubdirectories(dirPath: string): Promise<boolean> {
    try {
      const fs = this.adapter.fs;
      const stat = await fs.stat(dirPath);
      if (!stat.isDirectory) return false;

      // Check if directory has at least one subdirectory (potential project)
      for await (const entry of fs.readDir(dirPath)) {
        if (entry.isDirectory && !entry.name.startsWith(".")) {
          return true;
        }
      }
      return false;
    } catch (_) {
      /* expected: directory may not exist */
      return false;
    }
  }

  private buildLocalProjects(
    defaultProjectSlug: string | undefined,
  ): Record<string, string> | undefined {
    const slugs = new Set<string>();

    if (defaultProjectSlug) slugs.add(defaultProjectSlug);

    const explicitSlug = normalizeSlug(this.options.defaultProjectSlug);
    if (explicitSlug) slugs.add(explicitSlug);

    const configuredSlug = normalizeSlug(this.appConfig?.fs?.veryfront?.projectSlug);
    if (configuredSlug) slugs.add(configuredSlug);

    const defaultProjectId = normalizeSlug(this.options.defaultProjectId);
    if (defaultProjectId) slugs.add(defaultProjectId);

    if (slugs.size === 0) return undefined;

    return Object.fromEntries(
      Array.from(slugs, (slug) => [slug, this.options.projectDir]),
    );
  }

  async rediscoverAI(): Promise<void> {
    try {
      clearTranspileCache();
      const config = this.buildDiscoveryConfig();
      const result = await discoverAll(config);
      logger.info(
        `[HMR] Re-discovered: ${result.tools.size} tools, ${result.agents.size} agents, ` +
          `${result.skills.size} skills, ${result.workflows.size} workflows, ` +
          `${result.prompts.size} prompts, ${result.resources.size} resources`,
      );
    } catch (error) {
      hmrLog.warn("AI re-discovery failed:", error);
    }
  }

  private async setupFileWatchers(): Promise<void> {
    const isProxyMode = this.appConfig?.fs?.veryfront?.proxyMode === true;
    if (isProxyMode) {
      devServerLog.debug("Skipping file watchers in proxy mode");
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
    const skillDiscoveryEnabled = ai?.skills?.discovery?.enabled ?? true;
    const aiDirNames = [
      ...(ai?.tools?.discovery?.paths ?? ["tools"]),
      ...(ai?.agents?.discovery?.paths ?? ["agents"]),
      ...(skillDiscoveryEnabled ? (ai?.skills?.discovery?.paths ?? ["skills"]) : []),
      "resources",
      "prompts",
      "workflows",
    ];
    this.fileWatchSetup = new FileWatchSetup(
      this.options.projectDir,
      this.adapter,
      routeDiscovery,
      debounceMs,
      () => this.requestHandler?.invalidateRuntimeHandler(),
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
    this.releaseExternalBroadcastSource?.();

    if (this.fileWatchSetup) {
      const metrics = this.fileWatchSetup.getMetrics();
      if (metrics) {
        hmrLog.debug("Final performance metrics", metrics);
      }
      this.fileWatchSetup.cleanup();
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
      devServerLog.debug("Pipeline teardown error (non-critical)", error);
    }
  }
}
