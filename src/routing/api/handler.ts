import { serverLogger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getConfig } from "#veryfront/config";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { badGateway, internalServerError, notFound } from "#veryfront/http/responses";
import type { CORSConfig } from "#veryfront/security";
import { applyCORSHeaders, handleCORSPreflight } from "#veryfront/security";
import { type APIContext } from "./context-builder.ts";
import { ApiRouteMatcher, type RouteMatch } from "./api-route-matcher.ts";
import type { APIRoute } from "./module-loader/types.ts";
import { loadHandlerModule } from "./module-loader/loader.ts";
import { discoverAppRoutes, discoverPagesRoutes } from "./route-discovery.ts";
import { executeAppRoute, executePagesRoute, type ExecuteRouteOptions } from "./route-executor.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

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
  };
}

export interface APIResponse {
  body?: unknown;
  status?: number;
  headers?: HeadersInit;
}

export type APIHandler = (ctx: APIContext) => Promise<Response> | Response;

export class APIRouteHandler {
  private router = new ApiRouteMatcher();
  private routeCache = new LRUCache<string, APIRoute>({ maxEntries: HANDLER_CACHE_MAX_ENTRIES });
  private lastErrorMessage: string | null = null;

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
  ) {
    this.adapter = adapter ?? null;
    this.adapterPromise = adapter ? Promise.resolve(adapter) : null;
  }

  initialize(): Promise<void> {
    return withSpan(
      "api.initialize",
      async () => {
        const adapter = await this.ensureAdapter();
        await this.ensureConfig(adapter);

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

  handle(request: Request): Promise<Response | null> {
    const { pathname } = new URL(request.url);

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

        const handler = await this.loadHandler(match);
        if (!handler) {
          try {
            logger.error(`handler module failed to load: ${match.route.page}`);
          } catch (e) {
            logger.warn("API error log failed", e);
          }

          const msg = this.lastErrorMessage ?? "Handler not found";
          if (msg.includes("Remote import blocked by allow-list")) return badGateway(msg);
          return internalServerError("Handler not found");
        }

        // App Router routes are always named route.ts/js/tsx/jsx
        // Pages Router routes have descriptive names like articles.ts
        // Note: Cannot use path-based detection (/app/) as projectDir may be '/app' in production
        const isAppRoute = /\/route\.(ts|js|tsx|jsx)$/.test(match.route.page);

        const isolationOptions: ExecuteRouteOptions = {
          modulePath: match.route.page,
          projectDir: this.projectDir,
        };

        const response = isAppRoute
          ? await executeAppRoute(handler, request, match, pathname, adapter, isolationOptions)
          : await executePagesRoute(handler, request, match, pathname, adapter, this.projectDir, isolationOptions);

        const corsResponse = await applyCORSHeaders({
          request,
          response,
          config: this.corsConfig ?? undefined,
        });

        return corsResponse ?? response;
      },
      { "http.method": request.method, "http.path": pathname },
    );
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
          if (handler && Object.keys(handler).length > 0) {
            this.routeCache.set(modulePath, handler);
          }
          return handler && Object.keys(handler).length > 0 ? handler : null;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.lastErrorMessage = msg;
          logger.error(`[API] Failed to load handler for ${modulePath}: ${msg}`);
          return null;
        }
      },
      { "api.modulePath": modulePath },
    );
  }

  clearCache(): void {
    this.routeCache.clear();
    this.router.clearCache();
  }

  destroy(): void {
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
