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

export class RequestHandler {
  private universalHandler?: (req: Request) => Promise<Response>;

  constructor(
    private projectDir: string,
    private adapter: RuntimeAdapter,
    private isReady: () => boolean,
    private isDebug: () => boolean,
    private hmrServer?: HMRServer,
    private config?: VeryfrontConfig,
  ) {}

  async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    logger.debug(`Request: ${req.method} ${url.pathname}`);

    const healthResponse = this.handleHealthCheck(url.pathname);
    if (healthResponse) return healthResponse;

    this.incrementRequestMetrics();

    try {
      const devResponse = this.handleDevEndpoint(req, url.pathname);
      if (devResponse) return devResponse;

      return await this.handleApplicationRequest(req);
    } catch (error) {
      return this.handleServerError(error);
    }
  }

  private handleHealthCheck(pathname: string): Response | null {
    if (pathname === "/healthz") {
      return new Response("ok", {
        status: HTTP_OK,
        headers: { "content-type": "text/plain" },
      });
    }

    if (pathname === "/readyz") {
      const ready = this.isReady();
      return new Response(ready ? "ready" : "not-ready", {
        status: ready ? HTTP_OK : HTTP_UNAVAILABLE,
        headers: { "content-type": "text/plain" },
      });
    }

    return null;
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

    if (normalized === DEV_SERVER_ENDPOINTS.HMR_RUNTIME) {
      if (!this.hmrServer) return null;
      if (isHeadRequest) return builder.withContentType(HTTP_CONTENT_TYPES.JS, "", HTTP_OK);

      const runtime = this.getHMRRuntime();
      if (runtime === null) return null;

      return builder.withContentType(HTTP_CONTENT_TYPES.JS, runtime, HTTP_OK);
    }

    if (normalized === DEV_SERVER_ENDPOINTS.ERROR_OVERLAY) {
      const overlay = isHeadRequest ? null : ErrorOverlay.getRuntime();
      return builder.withContentType(HTTP_CONTENT_TYPES.JS, overlay, HTTP_OK);
    }

    return null;
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
    const runtimeProvider = this.hmrServer as unknown as
      | { getHMRRuntime?: () => string }
      | undefined;
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
        // Module server is integrated into main server at /_vf_modules/
        // Use relative path since modules are served on the same server
        moduleServerUrl: "/_vf_modules",
        config: this.config,
        // Dev server always runs in local development mode
        envConfig: { isLocalDev: true },
      });
    }

    return this.universalHandler(req);
  }

  invalidateUniversalHandler(): void {
    this.universalHandler = undefined;

    // Also reset the API handler cache to pick up new/modified handlers
    resetApiHandler(this.projectDir).catch((error) => {
      logger.debug("[dev] resetApiHandler failed", error);
    });

    // Clear config cache so HMR picks up config changes
    clearConfigCache();

    // Clear layout discovery cache so HMR picks up layout changes
    clearLayoutDiscoveryCache();
  }

  private handleServerError(error: unknown): Response {
    logger.error("Server error:", error);

    return new Response(
      ErrorOverlay.createHTML({
        type: "runtime",
        error: error as Error,
      }),
      {
        status: HTTP_SERVER_ERROR,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    );
  }
}
