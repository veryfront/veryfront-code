import { serverLogger as logger } from "#veryfront/utils";
import { join } from "#veryfront/platform/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getConfig } from "#veryfront/config";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { badGateway, internalServerError, notFound } from "#veryfront/http/responses";
import type { CORSConfig } from "#veryfront/security";
import { applyCORSHeaders, handleCORSPreflight } from "#veryfront/security";
import { type APIContext } from "./context-builder.ts";
import { DynamicRouter, type RouteMatch } from "./api-route-matcher.ts";
import type { APIRoute } from "./module-loader/types.ts";
import { loadHandlerModule } from "./module-loader/loader.ts";
import { discoverAppRoutes, discoverPagesRoutes } from "./route-discovery.ts";
import { executeAppRoute, executePagesRoute } from "./route-executor.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

export type { APIContext, APIRoute };

export interface APIResponse {
  body?: unknown;
  status?: number;
  headers?: HeadersInit;
}

export type APIHandler = (ctx: APIContext) => Promise<Response> | Response;

export class APIRouteHandler {
  private router: DynamicRouter;
  private routeCache = new LRUCache<string, APIRoute>({ maxEntries: 256 });
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
    this.router = new DynamicRouter();
    this.adapter = adapter ?? null;
    this.adapterPromise = adapter ? Promise.resolve(adapter) : null;
  }

  initialize(): Promise<void> {
    return withSpan(
      "api.initialize",
      async () => {
        const adapter = await this.ensureAdapter();
        await this.ensureConfig(adapter);

        logger.debug("[API] Initializing route handler", { projectDir: this.projectDir });

        const pagesDir = this.config?.directories?.pages ?? "pages";
        const apiDir = join(this.projectDir, pagesDir, "api");
        const apiDirExists = await adapter.fs.exists(apiDir);

        logger.debug("[API] Checking API directory", { apiDir, exists: apiDirExists });

        if (apiDirExists) {
          await discoverPagesRoutes(this.router, apiDir, "/api", adapter);
          const discoveredRoutes = this.router.listRoutes();
          logger.debug("[API] Discovered Pages API routes", {
            count: discoveredRoutes.length,
            routes: discoveredRoutes.map((r) => ({ pattern: r.pattern, page: r.page })),
          });
        }

        const appDirName = this.config?.directories?.app ?? "app";
        const appDir = join(this.projectDir, appDirName);
        const appDirExists = await adapter.fs.exists(appDir);

        logger.debug("[API] Checking App directory", { appDir, exists: appDirExists });

        if (appDirExists) {
          await discoverAppRoutes(this.router, appDir, "", adapter);
          const allRoutes = this.router.listRoutes();
          logger.debug("[API] All discovered routes after App Router", {
            count: allRoutes.length,
            routes: allRoutes.map((r) => ({ pattern: r.pattern, page: r.page })),
          });
        }

        await this.ensureCorsConfig(adapter);
        logger.debug("[API] Route handler initialized");
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

        logger.debug("[API] Handling request", {
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
          logger.debug("[API] No route match", {
            pathname,
            isApiPath: pathname.startsWith("/api/"),
            availableRoutes: this.router.listRoutes().map((r) => r.pattern),
          });

          if (pathname === "/api" || pathname.startsWith("/api/")) return notFound();
          return null;
        }

        logger.debug("[API] Route matched", {
          pathname,
          pattern: match.route.pattern,
          page: match.route.page,
          params: match.params,
        });

        const handler = await this.loadHandler(match);
        if (!handler) {
          try {
            logger.error(`[API] handler module failed to load: ${match.route.page}`);
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

        let response: Response;
        if (isAppRoute) {
          response = await executeAppRoute(handler, request, match, pathname, adapter);
        } else {
          response = await executePagesRoute(
            handler,
            request,
            match,
            pathname,
            adapter,
            this.projectDir,
          );
        }

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
          const handler = await loadHandlerModule({
            projectDir: this.projectDir,
            modulePath,
            adapter,
            config: this.config ?? undefined,
          });

          if (handler) this.routeCache.set(modulePath, handler);
          return handler;
        } catch (error) {
          this.lastErrorMessage = error instanceof Error ? error.message : String(error);
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

    if (!this.corsConfigPromise) {
      this.corsConfigPromise = this.loadCorsConfig(adapter);
    }

    await this.corsConfigPromise;
  }

  private async loadCorsConfig(adapter: RuntimeAdapter): Promise<void> {
    try {
      const config = await getConfig(this.projectDir, adapter);
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

    if (!this.configPromise) {
      this.configPromise = this.loadFullConfig(adapter);
    }

    await this.configPromise;
  }

  private async loadFullConfig(adapter: RuntimeAdapter): Promise<void> {
    try {
      this.config = await getConfig(this.projectDir, adapter);
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
