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
import { clearConfigCache } from "#veryfront/config";
import { ErrorOverlay } from "./error-overlay/index.ts";
import { createResponseBuilder } from "#veryfront/security/index.ts";
import { resetApiHandler } from "../handlers/request/api/pages-api-handler.ts";
import { clearLayoutDiscoveryCache } from "#veryfront/rendering/layouts/index.ts";
import { clearRendererCacheForProject } from "#veryfront/rendering/renderer.ts";
import { getErrorCollector } from "#veryfront/observability/error-collector.ts";
import { getLogBuffer } from "#veryfront/observability/log-buffer.ts";

const logger = serverLogger.component("dev");

export class RequestHandler {
  private runtimeHandler?: (req: Request) => Promise<Response>;

  constructor(
    private projectDir: string,
    private adapter: RuntimeAdapter,
    private isReady: () => boolean,
    private isDebug: () => boolean,
    private config?: VeryfrontConfig,
    private defaultProjectSlug?: string,
    private defaultProjectId?: string,
    private localProjects?: Record<string, string>,
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
    if (!this.runtimeHandler) {
      const { createVeryfrontHandler } = await import("../runtime-handler/index.ts");
      this.runtimeHandler = createVeryfrontHandler(this.projectDir, this.adapter, {
        projectDir: this.projectDir,
        debug: this.isDebug(),
        moduleServerUrl: "/_vf_modules",
        config: this.config,
        defaultProjectSlug: this.defaultProjectSlug,
        defaultProjectId: this.defaultProjectId,
        localProjects: this.localProjects,
      });
    }

    return this.runtimeHandler(req);
  }

  invalidateRuntimeHandler(): void {
    this.runtimeHandler = undefined;

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

  private handleServerError(error: unknown): Response {
    logger.error("Server error:", error);

    const err = error as Error;
    getErrorCollector().addRuntimeError(err.message, err.stack, { source: "request-handler" });

    const sourceFile = (err as Error & { sourceFile?: string }).sourceFile;
    return new Response(
      ErrorOverlay.createHTML({
        type: "runtime",
        error: err,
        ...(sourceFile ? { file: sourceFile } : {}),
      }, this.defaultProjectSlug),
      {
        status: HTTP_SERVER_ERROR,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    );
  }
}
