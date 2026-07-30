import {
  DEV_SERVER_ENDPOINTS,
  HTTP_CONTENT_TYPES,
  HTTP_OK,
  HTTP_SERVER_ERROR,
  HTTP_UNAVAILABLE,
  serverLogger,
} from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { StudioCaptureBundleProvider } from "#veryfront/extensions/studio/index.ts";
import { clearConfigCache } from "#veryfront/config";
import { ErrorOverlay, parseErrorLocation } from "./error-overlay/index.ts";
import {
  applyCORSHeaders,
  createResponseBuilder,
  handleCORSPreflight,
  isPreflightRequest,
} from "#veryfront/security/index.ts";
import { resetApiHandler } from "../handlers/request/api/pages-api-handler.ts";
import { clearLayoutDiscoveryCache } from "#veryfront/rendering/layouts/index.ts";
import { clearRendererCacheForProject } from "#veryfront/rendering/renderer.ts";
import { getErrorCollector, getLogBuffer } from "#veryfront/observability";
import { invalidateRSCHandlersForProject } from "#veryfront/server/services/rsc/endpoints/handler-registry.ts";
import { completeOnResponseBodyConsumption } from "#veryfront/platform/compat/http/response-lifecycle.ts";
import {
  RuntimeGenerationDrain,
  type RuntimeGenerationLease,
} from "../runtime-generation-drain.ts";

const logger = serverLogger.component("dev");
const DEV_SERVER_ALLOWED_METHODS = "GET, HEAD, OPTIONS";
type RuntimeRequestHandler = ((request: Request) => Promise<Response>) & {
  dispose?: () => void | Promise<void>;
};
type RuntimeRequestHandlerFactory = () => Promise<RuntimeRequestHandler>;
interface RequestHandlerDependencies {
  runtimeHandlerFactory?: RuntimeRequestHandlerFactory;
  studioCaptureProvider?: Readonly<StudioCaptureBundleProvider>;
}
interface LeasedRuntimeHandler {
  handler: RuntimeRequestHandler;
  lease: RuntimeGenerationLease;
}

export class RequestHandler {
  private readonly projectDir: string;
  private readonly adapter: RuntimeAdapter;
  private readonly isReady: () => boolean;
  private readonly config?: VeryfrontConfig;
  private readonly defaultProjectSlug?: string;
  private readonly defaultProjectId?: string;
  private readonly localProjects?: Record<string, string>;
  private runtimeHandler?: RuntimeRequestHandler;
  private runtimeHandlerInitialization?: Promise<RuntimeRequestHandler | undefined>;
  private readonly runtimeHandlerInitializations = new Set<
    Promise<RuntimeRequestHandler | undefined>
  >();
  private readonly ownedRuntimeHandlers = new Set<RuntimeRequestHandler>();
  private readonly runtimeHandlerRetirements = new Map<RuntimeRequestHandler, Promise<void>>();
  private readonly runtimeHandlerDrains = new Map<RuntimeRequestHandler, RuntimeGenerationDrain>();
  private runtimeHandlerGeneration = 0;
  private disposed = false;
  private disposePromise?: Promise<void>;
  private readonly runtimeHandlerFactory?: RuntimeRequestHandlerFactory;
  private readonly studioCaptureProvider?: Readonly<StudioCaptureBundleProvider>;

  constructor(
    projectDir: string,
    adapter: RuntimeAdapter,
    isReady: () => boolean,
    config?: VeryfrontConfig,
    defaultProjectSlug?: string,
    defaultProjectId?: string,
    localProjects?: Record<string, string>,
    dependencies?: RequestHandlerDependencies,
  );
  /** @deprecated The debug callback is ignored; runtime diagnostics now read host state per request. */
  constructor(
    projectDir: string,
    adapter: RuntimeAdapter,
    isReady: () => boolean,
    debug: () => boolean,
    config?: VeryfrontConfig,
    defaultProjectSlug?: string,
    defaultProjectId?: string,
    localProjects?: Record<string, string>,
    dependencies?: RequestHandlerDependencies,
  );
  constructor(
    projectDir: string,
    adapter: RuntimeAdapter,
    isReady: () => boolean,
    configOrLegacyDebug?: VeryfrontConfig | (() => boolean),
    configOrProjectSlug?: VeryfrontConfig | string,
    projectSlugOrId?: string,
    projectIdOrLocalProjects?: string | Record<string, string>,
    localProjectsOrDependencies?: Record<string, string> | RequestHandlerDependencies,
    legacyDependencies: RequestHandlerDependencies = {},
  ) {
    this.projectDir = projectDir;
    this.adapter = adapter;
    this.isReady = isReady;

    const usesLegacyDebugArgument = typeof configOrLegacyDebug === "function";
    if (usesLegacyDebugArgument) {
      this.config = configOrProjectSlug as VeryfrontConfig | undefined;
      this.defaultProjectSlug = projectSlugOrId;
      this.defaultProjectId = projectIdOrLocalProjects as string | undefined;
      this.localProjects = localProjectsOrDependencies as Record<string, string> | undefined;
      this.runtimeHandlerFactory = legacyDependencies.runtimeHandlerFactory;
      this.studioCaptureProvider = legacyDependencies.studioCaptureProvider;
      return;
    }

    this.config = configOrLegacyDebug;
    this.defaultProjectSlug = configOrProjectSlug as string | undefined;
    this.defaultProjectId = projectSlugOrId;
    this.localProjects = projectIdOrLocalProjects as Record<string, string> | undefined;
    this.runtimeHandlerFactory = (localProjectsOrDependencies as RequestHandlerDependencies)
      ?.runtimeHandlerFactory;
    this.studioCaptureProvider = (localProjectsOrDependencies as RequestHandlerDependencies)
      ?.studioCaptureProvider;
  }

  async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const start = performance.now();
    logger.debug(`Request: ${req.method} ${url.pathname}`);

    const healthResponse = this.handleHealthCheck(url.pathname);
    if (healthResponse) {
      return this.applyOwnedEndpointCORS(req, healthResponse);
    }

    this.incrementRequestMetrics();

    try {
      const devResponse = this.handleDevEndpoint(req, url.pathname);
      if (devResponse) {
        const response = await this.applyOwnedEndpointCORS(req, devResponse);
        this.logRequest(req.method, url.pathname, response.status, start);
        return response;
      }

      const response = await this.handleApplicationRequest(req);
      this.logRequest(req.method, url.pathname, response.status, start);
      return response;
    } catch (error) {
      this.logRequest(req.method, url.pathname, HTTP_SERVER_ERROR, start);
      return this.handleServerError(error);
    }
  }

  private logRequest(method: string, pathname: string, status: number, start: number): void {
    if (pathname.startsWith("/_dev/") || pathname.startsWith("/_veryfront/")) return;

    const duration = Math.round(performance.now() - start);
    getLogBuffer().info(`${method} ${pathname} → ${status} (${duration}ms)`, "http", {
      method,
      path: pathname,
      status,
      duration,
    });
  }

  private handleHealthCheck(pathname: string): Response | null {
    if (pathname === "/healthz") {
      return new Response("ok", {
        status: HTTP_OK,
        headers: { "content-type": "text/plain" },
      });
    }

    if (pathname !== "/readyz") return null;

    const ready = this.isReady();
    return new Response(ready ? "ready" : "not-ready", {
      status: ready ? HTTP_OK : HTTP_UNAVAILABLE,
      headers: { "content-type": "text/plain" },
    });
  }

  private async applyOwnedEndpointCORS(
    request: Request,
    response: Response,
  ): Promise<Response> {
    const config = this.config?.security?.cors;
    if (config === undefined) return response;

    if (isPreflightRequest(request)) {
      return handleCORSPreflight({
        request,
        config,
        allowMethods: DEV_SERVER_ALLOWED_METHODS,
      });
    }

    return (await applyCORSHeaders({ request, response, config })) ?? response;
  }

  private async incrementRequestMetrics(): Promise<void> {
    try {
      const { metrics } = await import("#veryfront/observability/simple-metrics/index.ts");
      metrics.incRequest();
    } catch (error) {
      logger.debug("[dev] metrics.incRequest failed", error);
    }
  }

  private handleDevEndpoint(req: Request, pathname: string): Response | null {
    const normalized = this.normalizeDevEndpoint(pathname);
    if (!normalized) return null;

    const isHeadRequest = req.method.toUpperCase() === "HEAD";
    const builder = createResponseBuilder({ isDev: true }).withHeaders({
      "cache-control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });

    switch (normalized) {
      case DEV_SERVER_ENDPOINTS.ERROR_OVERLAY: {
        const overlay = isHeadRequest ? null : ErrorOverlay.getRuntime();
        return builder.withContentType(HTTP_CONTENT_TYPES.JS, overlay, HTTP_OK);
      }

      default:
        return null;
    }
  }

  private normalizeDevEndpoint(pathname: string): string | null {
    const validEndpoints = new Set<string>([
      DEV_SERVER_ENDPOINTS.ERROR_OVERLAY,
    ]);

    if (validEndpoints.has(pathname)) return pathname;
    if (!pathname.startsWith("/__veryfront/")) return null;

    const rewritten = pathname.replace("/__veryfront/", "/_veryfront/");
    return validEndpoints.has(rewritten) ? rewritten : null;
  }

  private async handleApplicationRequest(req: Request): Promise<Response> {
    const { handler, lease } = await this.getRuntimeHandler();
    try {
      const response = await handler(req);
      return completeOnResponseBodyConsumption(response, lease.release, req.signal);
    } catch (error) {
      lease.release();
      throw error;
    }
  }

  private async getRuntimeHandler(): Promise<LeasedRuntimeHandler> {
    while (true) {
      if (this.disposed) throw new Error("Request handler has been disposed");
      if (this.runtimeHandler) {
        const leased = this.tryLeaseRuntimeHandler(this.runtimeHandler);
        if (leased) return leased;
        continue;
      }

      const initialization = this.runtimeHandlerInitialization ??
        this.startRuntimeHandlerInitialization();
      const runtimeHandler = await initialization;
      if (
        runtimeHandler &&
        !this.disposed &&
        this.runtimeHandler === runtimeHandler
      ) {
        const leased = this.tryLeaseRuntimeHandler(runtimeHandler);
        if (leased) return leased;
      }
    }
  }

  private tryLeaseRuntimeHandler(
    runtimeHandler: RuntimeRequestHandler,
  ): LeasedRuntimeHandler | undefined {
    if (this.disposed || this.runtimeHandler !== runtimeHandler) return undefined;
    const drain = this.runtimeHandlerDrains.get(runtimeHandler);
    if (!drain) throw new Error("Runtime handler ownership was not initialized");
    const lease = drain.tryAcquire();
    if (!lease) return undefined;
    return { handler: runtimeHandler, lease };
  }

  private startRuntimeHandlerInitialization(): Promise<RuntimeRequestHandler | undefined> {
    const generation = this.runtimeHandlerGeneration;
    const initialization = this.createRuntimeHandler().then(async (runtimeHandler) => {
      this.ownedRuntimeHandlers.add(runtimeHandler);
      this.runtimeHandlerDrains.set(runtimeHandler, new RuntimeGenerationDrain());
      if (this.disposed || generation !== this.runtimeHandlerGeneration) {
        await this.retireRuntimeHandler(runtimeHandler);
        return undefined;
      }

      this.runtimeHandler = runtimeHandler;
      return runtimeHandler;
    });
    this.runtimeHandlerInitialization = initialization;
    this.runtimeHandlerInitializations.add(initialization);

    void initialization.then(
      () => this.finishRuntimeHandlerInitialization(initialization),
      () => this.finishRuntimeHandlerInitialization(initialization),
    );
    return initialization;
  }

  private finishRuntimeHandlerInitialization(
    initialization: Promise<RuntimeRequestHandler | undefined>,
  ): void {
    this.runtimeHandlerInitializations.delete(initialization);
    if (this.runtimeHandlerInitialization === initialization) {
      this.runtimeHandlerInitialization = undefined;
    }
  }

  private async createRuntimeHandler(): Promise<RuntimeRequestHandler> {
    if (this.runtimeHandlerFactory) return await this.runtimeHandlerFactory();

    const { createVeryfrontHandler } = await import("../runtime-handler/index.ts");
    return createVeryfrontHandler(this.projectDir, this.adapter, {
      projectDir: this.projectDir,
      profile: "development",
      moduleServerUrl: "/_vf_modules",
      config: this.config,
      defaultProjectSlug: this.defaultProjectSlug,
      defaultProjectId: this.defaultProjectId,
      localProjects: this.localProjects,
      studioCaptureProvider: this.studioCaptureProvider,
    });
  }

  invalidateRuntimeHandler(): void {
    this.runtimeHandlerGeneration++;
    this.runtimeHandlerInitialization = undefined;
    const previousRuntimeHandler = this.runtimeHandler;
    this.runtimeHandler = undefined;
    if (previousRuntimeHandler) void this.retireRuntimeHandler(previousRuntimeHandler);
    invalidateRSCHandlersForProject(this.projectDir, this.defaultProjectId);

    resetApiHandler(this.projectDir).catch((error) => {
      logger.debug("resetApiHandler failed", error);
    });

    clearConfigCache();
    clearLayoutDiscoveryCache();
    const rendererProjectKey = this.defaultProjectId ?? this.defaultProjectSlug ?? "local";
    clearRendererCacheForProject(rendererProjectKey).catch((error) => {
      logger.debug("clearRendererCacheForProject failed", error);
    });
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;

    if (!this.disposed) {
      this.disposed = true;
      this.runtimeHandlerGeneration++;
    }
    this.runtimeHandlerInitialization = undefined;
    this.runtimeHandler = undefined;

    const attempt = this.disposeOwnedRuntimeHandlers();
    this.disposePromise = attempt;
    void attempt.then(
      () => undefined,
      () => {
        if (this.disposePromise === attempt) this.disposePromise = undefined;
      },
    );
    return attempt;
  }

  private retireRuntimeHandler(runtimeHandler: RuntimeRequestHandler): Promise<void> {
    const activeRetirement = this.runtimeHandlerRetirements.get(runtimeHandler);
    if (activeRetirement) return activeRetirement;

    const retirement = (async () => {
      await this.runtimeHandlerDrains.get(runtimeHandler)?.close();
      await runtimeHandler.dispose?.();
    })();
    this.runtimeHandlerRetirements.set(runtimeHandler, retirement);
    void retirement.then(
      () => {
        if (this.runtimeHandlerRetirements.get(runtimeHandler) === retirement) {
          this.runtimeHandlerRetirements.delete(runtimeHandler);
          this.ownedRuntimeHandlers.delete(runtimeHandler);
          this.runtimeHandlerDrains.delete(runtimeHandler);
        }
      },
      (error) => {
        if (this.runtimeHandlerRetirements.get(runtimeHandler) === retirement) {
          this.runtimeHandlerRetirements.delete(runtimeHandler);
        }
        logger.warn("Runtime handler retirement failed", { error });
      },
    );
    return retirement;
  }

  private async disposeOwnedRuntimeHandlers(): Promise<void> {
    await Promise.allSettled([...this.runtimeHandlerInitializations]);

    const handlers = [...this.ownedRuntimeHandlers];
    const results = await Promise.allSettled(
      handlers.map((runtimeHandler) => this.retireRuntimeHandler(runtimeHandler)),
    );
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );

    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, "Runtime handler retirement failed");
    }
  }

  private handleServerError(error: unknown): Response {
    logger.error("Server error:", error);

    const err = error as Error;
    getErrorCollector().addRuntimeError(err.message, err.stack, { source: "request-handler" });

    const sourceFile = (err as Error & { sourceFile?: string }).sourceFile;
    const location = sourceFile ? parseErrorLocation(err, sourceFile) : {};
    return new Response(
      ErrorOverlay.createHTML({
        type: "runtime",
        error: err,
        ...(sourceFile ? { file: sourceFile } : {}),
        ...location,
      }, this.defaultProjectSlug),
      {
        status: HTTP_SERVER_ERROR,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    );
  }
}
