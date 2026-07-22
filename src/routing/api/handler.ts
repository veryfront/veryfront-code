import { serverLogger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getConfig } from "#veryfront/config";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { createError, toError } from "#veryfront/errors";
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
import type { HandlerContext } from "#veryfront/types";

/** Max entries in the loaded-handler LRU cache */
const HANDLER_CACHE_MAX_ENTRIES = 256;

export type { APIContext, APIRoute };

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

  handle(request: Request, ctx?: HandlerContext): Promise<Response | null> {
    const { pathname } = new URL(request.url);
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

        const { handler, errorMessage } = await this.loadHandler(match);
        if (!handler) {
          const msg = errorMessage ?? "Handler not found";

          try {
            // The full detail, paths and all, belongs in the log.
            logger.error(`handler module failed to load: ${match.route.page}`, { reason: msg });
          } catch (e) {
            logger.warn("API error log failed", e);
          }

          if (msg.includes("Remote import blocked by allow-list")) return badGateway(msg);

          // The reason the module failed to load is the only useful thing here.
          // Reporting a flat "Handler not found" for what is usually a syntax or
          // import error sends people hunting for a routing problem that does
          // not exist. Local development only, and sanitised: a raw load error
          // carries temp directories, absolute paths and a stack trace, none of
          // which belong in a response body.
          return internalServerError(
            ctx?.isLocalProject
              ? sanitizeLoadErrorForResponse(msg, this.projectDir)
              : "Handler not found",
          );
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

        const response = isAppRoute
          ? await executeAppRoute(handler, request, match, pathname, adapter, isolationOptions)
          : await executePagesRoute(
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
      { "http.method": request.method, "http.path": pathname },
    ).finally(() => this.completeRequest());
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
          const usable = handler && Object.keys(handler).length > 0 ? handler : null;
          if (usable) this.routeCache.set(modulePath, usable);

          return { handler: usable, errorMessage: null };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          logger.error(`[API] Failed to load handler for ${modulePath}: ${msg}`);
          return { handler: null, errorMessage: msg };
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
