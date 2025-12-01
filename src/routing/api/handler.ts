import { serverLogger as logger } from "@veryfront/utils";
import { join } from "std/path/mod.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { getConfig } from "@veryfront/config";
import { LRUCache } from "@veryfront/utils/lru-wrapper.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";
import { badGateway, internalServerError, notFound } from "../../http/responses.ts";
import type { CORSConfig } from "@veryfront/security";
import { applyCORSHeaders, handleCORSPreflight } from "@veryfront/security";
import { type APIContext } from "./context-builder.ts";
import { DynamicRouter, type RouteMatch } from "./api-route-matcher.ts";
import type { APIRoute } from "./module-loader/types.ts";
import { loadHandlerModule } from "./module-loader/loader.ts";
import { discoverAppRoutes, discoverPagesRoutes } from "./route-discovery.ts";
import { executeAppRoute, executePagesRoute } from "./route-executor.ts";

export type { APIContext, APIRoute };

export interface APIResponse {
  body?: unknown;
  status?: number;
  headers?: HeadersInit;
}

export type APIHandler = (ctx: APIContext) => Promise<Response> | Response;

export class APIRouteHandler {
  private router: DynamicRouter;
  private routeCache = new LRUCache<string, APIRoute>({
    maxEntries: 256,
  });
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
    if (adapter) {
      this.adapterPromise = Promise.resolve(adapter);
    }
  }

  async initialize(): Promise<void> {
    const adapter = await this.ensureAdapter();
    await this.ensureConfig(adapter);

    const pagesDir = this.config?.directories?.pages || "pages";
    const apiDir = join(this.projectDir, pagesDir, "api");
    const apiDirExists = await adapter.fs.exists(apiDir);

    if (apiDirExists) {
      await discoverPagesRoutes(this.router, apiDir, "/api", adapter);
    }

    const appDirName = this.config?.directories?.app || "app";
    const appDir = join(this.projectDir, appDirName);
    const appDirExists = await adapter.fs.exists(appDir);

    if (appDirExists) {
      await discoverAppRoutes(this.router, appDir, "", adapter);
    }

    await this.ensureCorsConfig(adapter);
  }

  async handle(request: Request): Promise<Response | null> {
    const adapter = await this.ensureAdapter();
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method.toUpperCase() === "OPTIONS") {
      await this.ensureCorsConfig(adapter);
      return await handleCORSPreflight({
        request,
        config: this.corsConfig ?? undefined,
      });
    }

    await this.ensureCorsConfig(adapter);

    const match = this.router.match(pathname);

    if (!match) {
      if (pathname === "/api" || pathname.startsWith("/api/")) {
        return notFound();
      }
      return null;
    }

    const handler = await this.loadHandler(match);

    if (!handler) {
      try {
        logger.error(`[API] handler module failed to load: ${match.route.page}`);
      } catch (e) {
        logger.warn("API error log failed", e);
      }
      const msg = this.lastErrorMessage ?? "Handler not found";
      if (msg.includes("Remote import blocked by allow-list")) {
        return badGateway(msg);
      }
      return internalServerError("Handler not found");
    }

    const isAppRoute = /\/(app)\//.test(match.route.page);
    const response = isAppRoute
      ? await executeAppRoute(handler, request, match, pathname, adapter)
      : await executePagesRoute(handler, request, match, pathname, adapter);

    const corsResponse = await applyCORSHeaders({
      request,
      response,
      config: this.corsConfig ?? undefined,
    });
    return corsResponse ?? response;
  }

  private async loadHandler(match: RouteMatch): Promise<APIRoute | null> {
    const adapter = await this.ensureAdapter();
    await this.ensureConfig(adapter);
    const modulePath = match.route.page;

    const cached = this.routeCache.get(modulePath);
    if (cached) {
      return cached;
    }

    try {
      const handler = await loadHandlerModule({
        projectDir: this.projectDir,
        modulePath,
        adapter,
        config: this.config ?? undefined,
      });

      if (handler) {
        this.routeCache.set(modulePath, handler);
      }

      return handler;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.lastErrorMessage = msg;
      return null;
    }
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
      const { getAdapter } = await import("@veryfront/platform/adapters/detect.ts");

      this.adapterPromise = getAdapter();
    }
    this.adapter = await this.adapterPromise;
    if (!this.adapter) {
      throw toError(createError({
        type: "api",
        message: "Failed to initialize runtime adapter",
      }));
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
      try {
        logger.warn("Failed to load CORS configuration", error);
      } catch (logError) {
        logger.error("Failed to log CORS config error:", logError);
      }
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
      try {
        logger.warn("Failed to load config", error);
      } catch (logError) {
        logger.error("Failed to log config error:", logError);
      }
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
} from "../../http/responses.ts";
