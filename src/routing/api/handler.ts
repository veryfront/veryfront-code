import { serverLogger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getConfig } from "#veryfront/config";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { createError, toError } from "#veryfront/errors";
import {
  badGateway,
  internalServerError,
  notFound,
  serviceUnavailable,
} from "#veryfront/http/responses";
import type { CORSConfig } from "#veryfront/security";
import { applyCORSHeaders, handleCORSPreflight } from "#veryfront/security";
import { type APIContext } from "./context-builder.ts";
import { ApiRouteMatcher, type RouteMatch } from "./api-route-matcher.ts";
import type { APIRoute } from "./module-loader/types.ts";
import { loadHandlerModule, prepareHandlerModule } from "./module-loader/loader.ts";
import { discoverAppRoutes, discoverPagesRoutes } from "./route-discovery.ts";
import {
  executeAppRoute,
  executePagesRoute,
  executePreparedAppRoute,
  executePreparedPagesRoute,
  resolvePreparedRouteMethods,
} from "./route-executor.ts";
import { resolveExecutableRouteMethods } from "./route-methods.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { HandlerContext } from "#veryfront/types";
import { snapshotThrowableDiagnostic } from "#veryfront/errors/safe-diagnostics.ts";
import {
  getWorkerPool,
  isWorkerIsolationEnabled,
} from "#veryfront/security/sandbox/worker-pool.ts";
import type { PreparedWorkerModule } from "#veryfront/security/sandbox/worker-types.ts";
import { isVirtualFilesystem } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { isCompiledBinary } from "#veryfront/utils";
import { createProjectDiscoveryConfig } from "#veryfront/discovery/project-discovery-config.ts";

/** Max entries in the loaded-handler LRU cache */
const HANDLER_CACHE_MAX_ENTRIES = 256;
/** Max in-flight/cached prepared source promises retained by one handler. */
const PREPARED_HANDLER_CACHE_MAX_ENTRIES = 256;
const objectKeys = Object.keys;
const apply = Reflect.apply;
const randomUUID = crypto.randomUUID;

function isAppRouteModule(modulePath: string): boolean {
  return /\/route\.(ts|js|tsx|jsx)$/.test(modulePath);
}

function snapshotRequestLocality(ctx?: HandlerContext): boolean {
  try {
    return ctx?.isLocalProject === true;
  } catch {
    return false;
  }
}

export type { APIContext, APIRoute };

/** Result of resolving the runtime HTTP capabilities for one API route path. */
export type APIRouteMethodResolution =
  | { status: "resolved"; methods: string[] }
  | { status: "not-found" }
  | { status: "unavailable" };

/** Per-call response finalization controls for server integrations. */
export interface APIRouteHandleOptions {
  /**
   * Apply the route handler's configured CORS policy before returning.
   *
   * The server wrapper disables this so it can merge project headers, apply
   * centralized security, and perform one authoritative asynchronous CORS pass.
   */
  applyCORS?: boolean;
}

/** Longest sanitised load error a response body carries. */
const MAX_LOAD_ERROR_LENGTH = 300;

/**
 * Roots that only ever identify the machine running the server: home
 * directories and the temp directories bundling writes to.
 */
const MACHINE_PATH_PATTERN =
  /(?:file:\/\/)?\/(?:private\/)?(?:Users|home|root|var\/folders|var\/tmp|tmp)\/\S*/g;

/**
 * Reduce a module load error to something safe to put in a response body.
 *
 * The message is worth returning, since it usually names a syntax or import
 * error the developer can act on. The rest of it is not: a raw load error
 * carries the temp directory the bundle was written to, absolute paths into the
 * framework install, and a full stack trace. A path inside the project survives
 * as a project-relative one, because that is the part that identifies the file
 * to fix.
 */
export function sanitizeLoadErrorForResponse(message: string, projectDir?: string): string {
  // A stack trace is never the actionable part.
  let text = (message.split("\n")[0] ?? "").trim();

  if (projectDir) {
    const root = projectDir.replace(/\/+$/, "");
    text = text.replaceAll(`file://${root}/`, "").replaceAll(`${root}/`, "");
  }

  text = text.replace(MACHINE_PATH_PATTERN, "<PATH>");

  return text.length > MAX_LOAD_ERROR_LENGTH ? `${text.slice(0, MAX_LOAD_ERROR_LENGTH)}...` : text;
}

/**
 * Injection interface for testing APIRouteHandler dependencies
 */
interface APIRouteHandlerDeps {
  loadHandlerModule?: typeof loadHandlerModule;
  prepareHandlerModule?: typeof prepareHandlerModule;
  discoverPagesRoutes?: typeof discoverPagesRoutes;
  discoverAppRoutes?: typeof discoverAppRoutes;
  getConfig?: typeof getConfig;
}

let injectedDeps: APIRouteHandlerDeps | null = null;

/**
 * Inject dependencies for testing. Pass null to reset to defaults.
 */
export function __injectDepsForTests(deps: APIRouteHandlerDeps | null): void {
  injectedDeps = deps;
}

function getDeps(): Required<APIRouteHandlerDeps> {
  return {
    loadHandlerModule: injectedDeps?.loadHandlerModule ?? loadHandlerModule,
    prepareHandlerModule: injectedDeps?.prepareHandlerModule ?? prepareHandlerModule,
    discoverPagesRoutes: injectedDeps?.discoverPagesRoutes ?? discoverPagesRoutes,
    discoverAppRoutes: injectedDeps?.discoverAppRoutes ?? discoverAppRoutes,
    getConfig: injectedDeps?.getConfig ?? getConfig,
  };
}

/** Structured response shape for API route helpers. */
export interface APIResponse {
  body?: unknown;
  status?: number;
  headers?: HeadersInit;
}

/** Function signature for API route handlers. */
export type APIHandler = (ctx: APIContext) => Promise<Response> | Response;

/**
 * Outcome of one load attempt. The failure travels with the attempt that
 * produced it, so a later route can never report an earlier route's error.
 */
interface LoadAttempt {
  handler: APIRoute | null;
  errorMessage: string | null;
}

interface PrepareAttempt {
  module: PreparedWorkerModule | null;
  errorMessage: string | null;
}

export class APIRouteHandler {
  private router = new ApiRouteMatcher();
  private routeCache = new LRUCache<string, APIRoute>({ maxEntries: HANDLER_CACHE_MAX_ENTRIES });
  private preparedRouteCache = new LRUCache<string, Promise<PreparedWorkerModule>>({
    maxEntries: PREPARED_HANDLER_CACHE_MAX_ENTRIES,
  });
  private activeRequests = 0;
  private destroyRequested = false;
  private destroyed = false;
  private workerUsed = false;
  private isolationUnavailableReason: string | null = null;

  private adapter: RuntimeAdapter | null;
  private adapterPromise: Promise<RuntimeAdapter> | null = null;

  private corsConfig: boolean | CORSConfig | null = null;
  private corsConfigLoaded = false;
  private corsConfigPromise: Promise<void> | null = null;

  private config: Awaited<ReturnType<typeof getConfig>> | null = null;
  private configPromise: Promise<void> | null = null;

  constructor(
    private projectDir: string,
    adapter?: RuntimeAdapter,
    initialConfig?: Awaited<ReturnType<typeof getConfig>>,
    private readonly executionScopeId: string = `api:${apply(randomUUID, crypto, [])}`,
  ) {
    this.adapter = adapter ?? null;
    this.adapterPromise = adapter ? Promise.resolve(adapter) : null;

    if (initialConfig) {
      this.config = initialConfig;
      this.corsConfig = initialConfig.security?.cors ?? null;
      this.corsConfigLoaded = true;
    }
  }

  initialize(): Promise<void> {
    return withSpan(
      "api.initialize",
      async () => {
        const adapter = await this.ensureAdapter();
        await this.ensureConfig(adapter);
        this.isolationUnavailableReason = await this.assessIsolationCompatibility(adapter);

        logger.debug("Initializing route handler", { projectDir: this.projectDir });

        const pagesDir = this.config?.directories?.pages ?? "pages";
        const apiDir = join(this.projectDir, pagesDir, "api");
        const apiDirExists = await adapter.fs.exists(apiDir);

        logger.debug("Checking API directory", { apiDir, exists: apiDirExists });

        if (apiDirExists) {
          const deps = getDeps();
          await deps.discoverPagesRoutes(this.router, apiDir, "/api", adapter);
          const discoveredRoutes = this.router.listRoutes();
          logger.debug("Discovered Pages API routes", {
            count: discoveredRoutes.length,
            routes: discoveredRoutes.map((r) => ({ pattern: r.pattern, page: r.page })),
          });
        }

        const appDirName = this.config?.directories?.app ?? "app";
        const appDir = join(this.projectDir, appDirName);
        const appDirExists = await adapter.fs.exists(appDir);

        logger.debug("Checking App directory", { appDir, exists: appDirExists });

        if (appDirExists) {
          const deps = getDeps();
          await deps.discoverAppRoutes(this.router, appDir, "", adapter);
          const allRoutes = this.router.listRoutes();
          logger.debug("All discovered routes after App Router", {
            count: allRoutes.length,
            routes: allRoutes.map((r) => ({ pattern: r.pattern, page: r.page })),
          });
        }

        await this.ensureCorsConfig(adapter);
        logger.debug("Route handler initialized");
      },
      { "api.projectDir": this.projectDir },
    );
  }

  handle(
    request: Request,
    ctx?: HandlerContext,
    options: APIRouteHandleOptions = {},
  ): Promise<Response | null> {
    const { pathname } = new URL(request.url);
    const isLocalProject = snapshotRequestLocality(ctx);
    let applyCORS = true;
    try {
      applyCORS = options.applyCORS !== false;
    } catch {
      // An unreadable caller option must not silently disable policy.
    }
    this.activeRequests++;

    return withSpan(
      "api.handle",
      async () => {
        const adapter = await this.ensureAdapter();

        logger.debug("Handling request", {
          pathname,
          method: request.method,
          registeredRouteCount: this.router.listRoutes().length,
        });

        await this.ensureCorsConfig(adapter);

        if (request.method.toUpperCase() === "OPTIONS") {
          return handleCORSPreflight({
            request,
            config: this.corsConfig ?? undefined,
          });
        }

        const match = this.router.match(pathname);
        if (!match) {
          logger.debug("No route match", {
            pathname,
            isApiPath: pathname.startsWith("/api/"),
            availableRoutes: this.router.listRoutes().map((r) => r.pattern),
          });

          if (pathname === "/api" || pathname.startsWith("/api/")) return notFound();
          return null;
        }

        logger.debug("Route matched", {
          pathname,
          pattern: match.route.pattern,
          page: match.route.page,
          params: match.params,
        });

        // App Router routes are always named route.ts/js/tsx/jsx
        // Pages Router routes have descriptive names like articles.ts
        // Note: Cannot use path-based detection (/app/) as projectDir may be '/app' in production
        const isAppRoute = isAppRouteModule(match.route.page);
        let response: Response;

        if (isWorkerIsolationEnabled()) {
          if (this.isolationUnavailableReason) {
            logger.error("Worker-isolated API route is unavailable", {
              modulePath: match.route.page,
              reason: this.isolationUnavailableReason,
            });
            return serviceUnavailable(
              isLocalProject ? this.isolationUnavailableReason : "API route unavailable",
            );
          }

          const { module, errorMessage } = await this.prepareHandler(match);
          if (!module) {
            return this.createLoadFailureResponse(
              match.route.page,
              errorMessage,
              isLocalProject,
            );
          }

          this.workerUsed = true;
          const preparedOptions = {
            executionScopeId: this.executionScopeId,
            module,
            modulePath: match.route.page,
            projectDir: this.projectDir,
            isLocalProject,
          };
          response = isAppRoute
            ? await executePreparedAppRoute(request, match, pathname, preparedOptions)
            : await executePreparedPagesRoute(request, match, pathname, preparedOptions);
        } else {
          const { handler, errorMessage } = await this.loadHandler(match);
          if (!handler) {
            return this.createLoadFailureResponse(
              match.route.page,
              errorMessage,
              isLocalProject,
            );
          }

          response = isAppRoute
            ? await executeAppRoute(handler, request, match, pathname, adapter, {
              isLocalProject,
            })
            : await executePagesRoute(
              handler,
              request,
              match,
              pathname,
              adapter,
              this.projectDir,
              { isLocalProject },
            );
        }

        if (!applyCORS) return response;

        const corsResponse = await applyCORSHeaders({
          request,
          response,
          config: this.corsConfig ?? undefined,
        });

        return corsResponse ?? response;
      },
      { "http.method": request.method, "http.path": pathname },
    ).finally(() => this.completeRequest());
  }

  /**
   * Resolve the methods the same matched and loaded module can execute.
   *
   * This deliberately shares route discovery, VFS loading, transpilation, and
   * handler caching with request execution. Callers can therefore distinguish a
   * genuine route miss from a matched route whose module was unsafe or unable
   * to load, without attempting a second host-filesystem import.
   */
  resolveRouteMethods(
    pathname: string,
    requestedMethod?: string,
  ): Promise<APIRouteMethodResolution> {
    this.activeRequests++;

    return withSpan<APIRouteMethodResolution>(
      "api.resolveRouteMethods",
      async () => {
        const match = this.router.match(pathname);
        if (!match) return { status: "not-found" };

        if (isWorkerIsolationEnabled()) {
          if (this.isolationUnavailableReason) return { status: "unavailable" };

          const { module } = await this.prepareHandler(match);
          if (!module) return { status: "unavailable" };

          try {
            this.workerUsed = true;
            return {
              status: "resolved",
              methods: await resolvePreparedRouteMethods(requestedMethod, {
                executionScopeId: this.executionScopeId,
                module,
                modulePath: match.route.page,
                projectDir: this.projectDir,
              }),
            };
          } catch (error) {
            logger.error("Failed to inspect isolated API route methods", {
              modulePath: match.route.page,
              reason: snapshotThrowableDiagnostic(error),
            });
            return { status: "unavailable" };
          }
        }

        const { handler } = await this.loadHandler(match);
        if (!handler) return { status: "unavailable" };

        return {
          status: "resolved",
          methods: resolveExecutableRouteMethods(
            handler as Record<string, unknown>,
            requestedMethod,
          ),
        };
      },
      {
        "http.path": pathname,
        "http.requested_method": requestedMethod ?? "",
      },
    ).finally(() => this.completeRequest());
  }

  private createLoadFailureResponse(
    modulePath: string,
    errorMessage: string | null,
    isLocalProject: boolean,
  ): Response {
    const msg = errorMessage ?? "Handler not found";

    try {
      logger.error(`handler module failed to load: ${modulePath}`, { reason: msg });
    } catch (error) {
      logger.warn("API error log failed", error);
    }

    if (msg.includes("Remote import blocked by allow-list")) return badGateway(msg);

    return internalServerError(
      isLocalProject ? sanitizeLoadErrorForResponse(msg, this.projectDir) : "Handler not found",
    );
  }

  private prepareHandler(match: RouteMatch): Promise<PrepareAttempt> {
    const modulePath = match.route.page;

    return withSpan(
      "api.prepareHandler",
      async () => {
        const adapter = await this.ensureAdapter();
        await this.ensureConfig(adapter);

        const cached = this.preparedRouteCache.get(modulePath);
        if (cached) {
          try {
            return { module: await cached, errorMessage: null };
          } catch (error) {
            return {
              module: null,
              errorMessage: snapshotThrowableDiagnostic(error),
            };
          }
        }

        const deps = getDeps();
        const preparation = deps.prepareHandlerModule({
          projectDir: this.projectDir,
          modulePath,
          adapter,
          config: this.config ?? undefined,
        });
        this.preparedRouteCache.set(modulePath, preparation);

        try {
          return { module: await preparation, errorMessage: null };
        } catch (error) {
          if (this.preparedRouteCache.get(modulePath) === preparation) {
            this.preparedRouteCache.delete(modulePath);
          }
          const msg = snapshotThrowableDiagnostic(error);
          logger.error(`[API] Failed to prepare handler for ${modulePath}: ${msg}`);
          return { module: null, errorMessage: msg };
        }
      },
      { "api.modulePath": modulePath },
    );
  }

  private loadHandler(match: RouteMatch): Promise<LoadAttempt> {
    const modulePath = match.route.page;

    return withSpan(
      "api.loadHandler",
      async () => {
        const adapter = await this.ensureAdapter();
        await this.ensureConfig(adapter);

        const cached = this.routeCache.get(modulePath);
        if (cached) return { handler: cached, errorMessage: null };

        try {
          const deps = getDeps();
          const handler = await deps.loadHandlerModule({
            projectDir: this.projectDir,
            modulePath,
            adapter,
            config: this.config ?? undefined,
          });

          // Only cache handlers that export at least one HTTP method.
          // Empty objects ({}) from failed imports are truthy but useless —
          // caching them would prevent retry after the user fixes the import.
          const usable = handler && objectKeys(handler).length > 0 ? handler : null;
          if (usable) this.routeCache.set(modulePath, usable);

          return { handler: usable, errorMessage: null };
        } catch (error) {
          const msg = snapshotThrowableDiagnostic(error);
          logger.error(`[API] Failed to load handler for ${modulePath}: ${msg}`);
          return { handler: null, errorMessage: msg };
        }
      },
      { "api.modulePath": modulePath },
    );
  }

  clearCache(): void {
    this.routeCache.clear();
    this.preparedRouteCache.clear();
    this.router.clearCache();
    this.evictWorkerScope();
  }

  destroy(): void {
    if (this.destroyed || this.destroyRequested) return;

    if (this.activeRequests > 0) {
      this.destroyRequested = true;
      return;
    }

    this.destroyNow();
  }

  private completeRequest(): void {
    this.activeRequests--;
    if (this.activeRequests === 0 && this.destroyRequested) this.destroyNow();
  }

  private destroyNow(): void {
    if (this.destroyed) return;

    this.destroyed = true;
    this.routeCache.destroy();
    this.preparedRouteCache.destroy();
    this.router.destroy();
    this.evictWorkerScope();
  }

  private evictWorkerScope(): void {
    if (!this.workerUsed) return;
    getWorkerPool().evictWorkerScope(this.executionScopeId);
    this.workerUsed = false;
  }

  private async ensureAdapter(): Promise<RuntimeAdapter> {
    if (this.adapter) return this.adapter;

    if (!this.adapterPromise) {
      const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
      this.adapterPromise = runtime.get();
    }

    this.adapter = await this.adapterPromise;

    if (!this.adapter) {
      throw toError(
        createError({
          type: "api",
          message: "Failed to initialize runtime adapter",
        }),
      );
    }

    return this.adapter;
  }

  /**
   * Prepared-source API isolation intentionally fails closed for source
   * capabilities that are not yet represented inside the worker boundary.
   * This check never imports project code.
   */
  private async assessIsolationCompatibility(
    adapter: RuntimeAdapter,
  ): Promise<string | null> {
    if (!isWorkerIsolationEnabled()) return null;

    if (isCompiledBinary()) {
      return "Worker-isolated API routes are unavailable in compiled binaries";
    }

    if (isVirtualFilesystem(adapter.fs)) {
      return "Worker-isolated API routes require a prepared virtual-filesystem capability";
    }

    const discovery = createProjectDiscoveryConfig({
      projectDir: this.projectDir,
      config: this.config,
      fsAdapter: adapter.fs,
    });
    const configuredDirectories = [
      ...discovery.toolDirs,
      ...discovery.agentDirs,
      ...discovery.skillDirs,
      ...discovery.resourceDirs,
      ...discovery.promptDirs,
      ...discovery.workflowDirs,
      ...discovery.taskDirs,
      ...discovery.scheduleDirs,
      ...discovery.webhookDirs,
      ...discovery.evalDirs,
    ];

    try {
      for (const directory of configuredDirectories) {
        const path = discovery.baseDir === "" ? directory : `${discovery.baseDir}/${directory}`;
        if (!await adapter.fs.exists(path)) continue;
        for await (const _entry of adapter.fs.readDir(path)) {
          return "Worker-isolated API routes require prepared project discovery capabilities";
        }
      }
    } catch (error) {
      logger.warn("Unable to verify isolated API discovery boundary", {
        reason: snapshotThrowableDiagnostic(error),
      });
      return "Worker-isolated API routes could not verify project discovery capabilities";
    }

    return null;
  }

  private async ensureCorsConfig(adapter: RuntimeAdapter): Promise<void> {
    if (this.corsConfigLoaded) return;

    this.corsConfigPromise ??= this.loadCorsConfig(adapter);
    await this.corsConfigPromise;
  }

  private async loadCorsConfig(adapter: RuntimeAdapter): Promise<void> {
    try {
      const deps = getDeps();
      const config = await deps.getConfig(this.projectDir, adapter);
      this.corsConfig = config.security?.cors ?? null;
    } catch (error) {
      this.corsConfig = null;
      logger.warn("Failed to load CORS configuration", error);
    } finally {
      this.corsConfigLoaded = true;
      this.corsConfigPromise = null;
    }
  }

  private async ensureConfig(adapter: RuntimeAdapter): Promise<void> {
    if (this.config) return;

    this.configPromise ??= this.loadFullConfig(adapter);
    await this.configPromise;
  }

  private async loadFullConfig(adapter: RuntimeAdapter): Promise<void> {
    try {
      const deps = getDeps();
      this.config = await deps.getConfig(this.projectDir, adapter);
    } catch (error) {
      this.config = null;
      logger.warn("Failed to load config", error);
    } finally {
      this.configPromise = null;
    }
  }
}

export {
  badRequest,
  forbidden,
  internalServerError as serverError,
  jsonResponse as json,
  notFound,
  redirectResponse as redirect,
  unauthorized,
} from "#veryfront/http/responses";

const logger = serverLogger.component("api");
