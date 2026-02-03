import {
  DEV_SERVER_ENDPOINTS,
  HTTP_CONTENT_TYPES,
  HTTP_OK,
  HTTP_SERVER_ERROR,
  HTTP_UNAVAILABLE,
  serverLogger as logger,
} from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { clearConfigCache } from "#veryfront/config";
import { ErrorOverlay } from "./error-overlay/index.ts";
import type { HMRServer } from "./hmr-server.ts";
import { createResponseBuilder } from "#veryfront/security/index.ts";
import { resetApiHandler } from "../handlers/request/api/pages-api-handler.ts";
import { clearLayoutDiscoveryCache } from "#veryfront/rendering/layouts/index.ts";
import { getErrorCollector } from "#veryfront/cli/mcp/error-collector.ts";
import { getLogBuffer } from "#veryfront/cli/mcp/log-buffer.ts";

export class RequestHandler {
  private universalHandler?: (req: Request) => Promise<Response>;

  constructor(
    private projectDir: string,
    private adapter: RuntimeAdapter,
    private isReady: () => boolean,
    private isDebug: () => boolean,
    private hmrServer?: HMRServer,
    private config?: VeryfrontConfig,
    private defaultProjectSlug?: string,
    private defaultProjectId?: string,
  ) {}

  async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const start = performance.now();
    logger.debug(`Request: ${req.method} ${url.pathname}`);

    const healthResponse = this.handleHealthCheck(url.pathname);
    if (healthResponse) return healthResponse;

    this.incrementRequestMetrics();

    try {
      const devResponse = this.handleDevEndpoint(req, url.pathname);
      if (devResponse) {
        this.logRequest(req.method, url.pathname, devResponse.status, start);
        return devResponse;
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

  private incrementRequestMetrics(): void {
    import("#veryfront/observability/simple-metrics/index.ts")
      .then(({ metrics }) => metrics.incRequest())
      .catch((error) => logger.debug("[dev] metrics.incRequest failed", error));
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
      case DEV_SERVER_ENDPOINTS.HMR_RUNTIME: {
        if (!this.hmrServer) return null;
        if (isHeadRequest) return builder.withContentType(HTTP_CONTENT_TYPES.JS, "", HTTP_OK);

        const runtime = this.getHMRRuntime();
        if (runtime === null) return null;

        return builder.withContentType(HTTP_CONTENT_TYPES.JS, runtime, HTTP_OK);
      }

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
      DEV_SERVER_ENDPOINTS.HMR_RUNTIME,
      DEV_SERVER_ENDPOINTS.ERROR_OVERLAY,
    ]);

    if (validEndpoints.has(pathname)) return pathname;
    if (!pathname.startsWith("/__veryfront/")) return null;

    const rewritten = pathname.replace("/__veryfront/", "/_veryfront/");
    return validEndpoints.has(rewritten) ? rewritten : null;
  }

  private getHMRRuntime(): string | null {
    const runtimeProvider = this.hmrServer as { getHMRRuntime?: () => string } | undefined;
    if (typeof runtimeProvider?.getHMRRuntime !== "function") return null;

    try {
      return runtimeProvider.getHMRRuntime();
    } catch (error) {
      logger.debug("[dev] failed to read HMR runtime from server", error);
      return null;
    }
  }

  private async handleApplicationRequest(req: Request): Promise<Response> {
    if (!this.universalHandler) {
      const { createVeryfrontHandler } = await import("../universal-handler/index.ts");
      this.universalHandler = createVeryfrontHandler(this.projectDir, this.adapter, {
        projectDir: this.projectDir,
        debug: this.isDebug(),
        moduleServerUrl: "/_vf_modules",
        config: this.config,
        envConfig: { isLocalDev: true },
        defaultProjectSlug: this.defaultProjectSlug,
        defaultProjectId: this.defaultProjectId,
      });
    }

    return this.universalHandler(req);
  }

  invalidateUniversalHandler(): void {
    this.universalHandler = undefined;

    resetApiHandler(this.projectDir).catch((error) => {
      logger.debug("[dev] resetApiHandler failed", error);
    });

    clearConfigCache();
    clearLayoutDiscoveryCache();
  }

  private handleServerError(error: unknown): Response {
    logger.error("Server error:", error);

    const err = error as Error;
    getErrorCollector().addRuntimeError(err.message, err.stack, { source: "request-handler" });

    return new Response(
      ErrorOverlay.createHTML({
        type: "runtime",
        error: err,
      }),
      {
        status: HTTP_SERVER_ERROR,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    );
  }
}
