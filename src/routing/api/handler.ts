import { serverLogger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getConfig } from "#veryfront/config";
import type { VeryfrontConfig } from "#veryfront/config";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { createError, toError, VeryfrontError } from "#veryfront/errors";
import {
  badGateway,
  internalServerError,
  notFound,
  serviceUnavailable,
} from "#veryfront/http/responses";
import type { CORSConfig } from "#veryfront/security";
import { applyCORSHeaders, handleCORSPreflight } from "#veryfront/security";
import { isWorkerIsolationEnabled } from "#veryfront/security/sandbox/worker-pool.ts";
import { type APIContext } from "./context-builder.ts";
import { ApiRouteMatcher, type RouteMatch } from "./api-route-matcher.ts";
import type { APIRoute } from "./module-loader/types.ts";
import { loadHandlerModule } from "./module-loader/loader.ts";
import { discoverAppRoutes, discoverPagesRoutes } from "./route-discovery.ts";
import { executeAppRoute, executePagesRoute, type ExecuteRouteOptions } from "./route-executor.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { HandlerContext } from "#veryfront/types";

/** Max entries in the loaded-handler LRU cache */
const HANDLER_CACHE_MAX_ENTRIES = 256;

export type { APIContext, APIRoute };

/**
 * Injection interface for testing APIRouteHandler dependencies
 */
interface APIRouteHandlerDeps {
  loadHandlerModule?: typeof loadHandlerModule;
  discoverPagesRoutes?: typeof discoverPagesRoutes;
  discoverAppRoutes?: typeof discoverAppRoutes;
  getConfig?: typeof getConfig;
  executeAppRoute?: typeof executeAppRoute;
  executePagesRoute?: typeof executePagesRoute;
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
    discoverPagesRoutes: injectedDeps?.discoverPagesRoutes ?? discoverPagesRoutes,
    discoverAppRoutes: injectedDeps?.discoverAppRoutes ?? discoverAppRoutes,
    getConfig: injectedDeps?.getConfig ?? getConfig,
    executeAppRoute: injectedDeps?.executeAppRoute ?? executeAppRoute,
    executePagesRoute: injectedDeps?.executePagesRoute ?? executePagesRoute,
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

export class APIRouteHandler {
  private router = new ApiRouteMatcher();
  private routeCache = new LRUCache<string, APIRoute>({ maxEntries: HANDLER_CACHE_MAX_ENTRIES });
  private activeRequests = 0;
  private destroyRequested = false;
  private destroyed = false;

  private adapter: RuntimeAdapter | null;
  private adapterPromise: Promise<RuntimeAdapter> | null = null;

  private corsConfig: boolean | CORSConfig | null = null;
  private corsConfigLoaded = false;
  private corsConfigPromise: Promise<void> | null = null;

  private config: Awaited<ReturnType<typeof getConfig>> | null = null;
  private configPromise: Promise<void> | null = null;
  private initializePromise: Promise<void> | null = null;

  constructor(
    private projectDir: string,
    adapter?: RuntimeAdapter,
    config?: VeryfrontConfig,
  ) {
    this.adapter = adapter ?? null;
    this.adapterPromise = adapter ? Promise.resolve(adapter) : null;
    this.config = config ?? null;
    this.configPromise = config ? Promise.resolve() : null;
  }

  initialize(): Promise<void> {
    if (this.initializePromise) return this.initializePromise;

    const initialization = withSpan(
      "api.initialize",
      async () => {
        const adapter = await this.ensureAdapter();
        await this.ensureConfig(adapter);

        logger.debug("Initializing route handler");

        const pagesDir = this.config?.directories?.pages ?? "pages";
        const apiDir = join(this.projectDir, pagesDir, "api");
        const apiDirExists = await adapter.fs.exists(apiDir);

        logger.debug("Checked Pages API directory", { exists: apiDirExists });

        if (apiDirExists) {
          const deps = getDeps();
          await deps.discoverPagesRoutes(this.router, apiDir, "/api", adapter);
          logger.debug("Discovered Pages API routes", {
            count: this.router.listRoutes().length,
          });
        }

        const appDirName = this.config?.directories?.app ?? "app";
        const appDir = join(this.projectDir, appDirName);
        const appDirExists = await adapter.fs.exists(appDir);

        logger.debug("Checked App directory", { exists: appDirExists });

        if (appDirExists) {
          const deps = getDeps();
          await deps.discoverAppRoutes(this.router, appDir, "", adapter);
          logger.debug("All discovered routes after App Router", {
            count: this.router.listRoutes().length,
          });
        }

        await this.ensureCorsConfig(adapter);
        logger.debug("Route handler initialized");
      },
      { "api.hasProjectDirectory": Boolean(this.projectDir) },
    );

    this.initializePromise = initialization.catch((error) => {
      this.initializePromise = null;
      throw error;
    });
    return this.initializePromise;
  }

  handle(request: Request, ctx?: HandlerContext): Promise<Response | null> {
    const { pathname } = new URL(request.url);
    this.activeRequests++;

    return withSpan(
      "api.handle",
      async () => {
        const adapter = await this.ensureAdapter();

        logger.debug("Handling request", {
          method: request.method,
          registeredRouteCount: this.router.listRoutes().length,
        });

        const match = this.router.match(pathname);
        const isApiPath = pathname === "/api" || pathname.startsWith("/api/");
        if (!match && !isApiPath) return null;

        await this.ensureCorsConfig(adapter);
        if (request.method.toUpperCase() === "OPTIONS") {
          return handleCORSPreflight({
            request,
            config: this.corsConfig ?? undefined,
          });
        }

        if (!match) {
          logger.debug("No API route match", { isApiPath });

          return notFound();
        }

        logger.debug("API route matched");

        const isRemoteProject = ctx?.isLocalProject === false;
        if (isRemoteProject && !isWorkerIsolationEnabled()) {
          logger.error("Remote API route rejected because worker isolation is disabled");

          const response = serviceUnavailable(undefined, {
            headers: {
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            },
          });
          const corsResponse = await applyCORSHeaders({
            request,
            response,
            config: this.corsConfig ?? undefined,
          });
          return corsResponse ?? response;
        }

        let handler: APIRoute | null = null;
        if (!isRemoteProject) {
          try {
            handler = await this.loadHandler(match);
          } catch (error) {
            logger.error("handler module failed to load", {
              errorName: error instanceof Error ? error.name : typeof error,
            });
            if (error instanceof VeryfrontError && error.slug === "security-violation") {
              return badGateway("API route is unavailable");
            }
            return internalServerError("Handler not found");
          }

          if (!handler) {
            logger.error("handler module did not export an HTTP method");
            return internalServerError("Handler not found");
          }
        }

        // App Router routes are always named route.ts/js/tsx/jsx
        // Pages Router routes have descriptive names like articles.ts
        // Note: Cannot use path-based detection (/app/) as projectDir may be '/app' in production
        const isAppRoute = /\/route\.(ts|js|tsx|jsx)$/.test(match.route.page);

        const isolationOptions: ExecuteRouteOptions = {
          modulePath: match.route.page,
          projectDir: this.projectDir,
          isLocalProject: ctx?.isLocalProject,
        };

        const deps = getDeps();
        const response = isAppRoute
          ? await deps.executeAppRoute(handler, request, match, pathname, adapter, isolationOptions)
          : await deps.executePagesRoute(
            handler,
            request,
            match,
            pathname,
            adapter,
            this.projectDir,
            isolationOptions,
          );

        const corsResponse = await applyCORSHeaders({
          request,
          response,
          config: this.corsConfig ?? undefined,
        });

        return corsResponse ?? response;
      },
      { "http.method": request.method },
    ).finally(() => this.completeRequest());
  }

  private loadHandler(match: RouteMatch): Promise<APIRoute | null> {
    const modulePath = match.route.page;

    return withSpan(
      "api.loadHandler",
      async () => {
        const adapter = await this.ensureAdapter();
        await this.ensureConfig(adapter);

        const cached = this.routeCache.get(modulePath);
        if (cached) return cached;

        const deps = getDeps();
        const handler = await deps.loadHandlerModule({
          projectDir: this.projectDir,
          modulePath,
          adapter,
          config: this.config ?? undefined,
        });

        // Only cache handlers that export at least one HTTP method. Empty
        // modules remain retryable so a fixed route is visible without restart.
        if (handler && Object.keys(handler).length > 0) {
          this.routeCache.set(modulePath, handler);
        }
        return handler && Object.keys(handler).length > 0 ? handler : null;
      },
    );
  }

  clearCache(): void {
    this.routeCache.clear();
    this.router.clearCache();
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
    this.router.destroy();
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

  private async ensureCorsConfig(adapter: RuntimeAdapter): Promise<void> {
    if (this.corsConfigLoaded) return;

    this.corsConfigPromise ??= this.loadCorsConfig(adapter);
    await this.corsConfigPromise;
  }

  private async loadCorsConfig(adapter: RuntimeAdapter): Promise<void> {
    try {
      await this.ensureConfig(adapter);
      this.corsConfig = this.config?.security?.cors ?? null;
      this.corsConfigLoaded = true;
    } finally {
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
