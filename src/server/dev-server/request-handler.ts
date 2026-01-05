import {
  DEV_SERVER_ENDPOINTS,
  HTTP_CONTENT_TYPES,
  HTTP_OK,
  HTTP_SERVER_ERROR,
  HTTP_UNAVAILABLE,
  serverLogger as logger,
} from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import { ErrorOverlay } from "./error-overlay/index.ts";
import type { HMRServer } from "./hmr-server.ts";
import { createResponseBuilder } from "@veryfront/security/index.ts";
import { resetApiHandler } from "../handlers/request/api/pages-api-handler.ts";

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

      // Handle built-in articles API for development
      const articlesResponse = await this.handleArticlesApi(url.pathname);
      if (articlesResponse) return articlesResponse;

      return await this.handleApplicationRequest(req);
    } catch (error) {
      return this.handleServerError(error);
    }
  }

  /**
   * Built-in articles API for development.
   * Returns article metadata from MDX files in pages/blog/articles/.
   */
  private async handleArticlesApi(pathname: string): Promise<Response | null> {
    if (pathname !== "/api/articles-2" && pathname !== "/api/articles") {
      return null;
    }

    try {
      // Get article files from the adapter
      const articlesDir = "pages/blog/articles";
      const files: string[] = [];

      try {
        const entries = await this.adapter.fs.readDir(articlesDir);
        for await (const entry of entries) {
          if (entry.name.endsWith(".mdx") || entry.name.endsWith(".md")) {
            files.push(entry.name);
          }
        }
      } catch {
        // Directory might not exist
        logger.debug("[dev] articles directory not found");
      }

      // Build article data from file names
      // Format must match what BlogTeaser expects: article.frontmatter.summary
      const articles = files.map((file) => {
        const slug = file.replace(/\.(mdx?|md)$/, "");
        const title = slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
        return {
          slug: `blog/articles/${slug}`,
          frontmatter: {
            summary: {
              title,
              category: "articles",
              description: `Read about ${title.toLowerCase()}`,
              imageSrc: "/images/placeholder.jpg",
              publishDate: new Date().toISOString(),
              author: "Coder Society",
            },
          },
        };
      });

      return new Response(JSON.stringify({ data: articles }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },
      });
    } catch (error) {
      logger.error("[dev] articles API error", error);
      return new Response(JSON.stringify({ data: [], error: "Failed to load articles" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
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
      return new Response(this.isReady() ? "ready" : "not-ready", {
        status: this.isReady() ? HTTP_OK : HTTP_UNAVAILABLE,
        headers: { "content-type": "text/plain" },
      });
    }

    return null;
  }

  private incrementRequestMetrics(): void {
    import("@veryfront/observability/simple-metrics/index.ts")
      .then(({ metrics }) => metrics.incRequest())
      .catch((error) => logger.debug("[dev] metrics.incRequest failed", error));
  }

  private handleDevEndpoint(req: Request, pathname: string): Response | null {
    const normalized = this.normalizeDevEndpoint(pathname);
    if (!normalized) {
      return null;
    }

    const isHeadRequest = req.method.toUpperCase() === "HEAD";
    const builder = createResponseBuilder({ isDev: true })
      .withHeaders({
        "cache-control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });

    if (normalized === DEV_SERVER_ENDPOINTS.HMR_RUNTIME && this.hmrServer) {
      if (isHeadRequest) {
        return builder.withContentType(HTTP_CONTENT_TYPES.JS, "", HTTP_OK);
      }

      const runtime = this.getHMRRuntime();
      if (runtime === null) {
        return null;
      }

      return builder.withContentType(HTTP_CONTENT_TYPES.JS, runtime, HTTP_OK);
    }

    if (normalized === DEV_SERVER_ENDPOINTS.ERROR_OVERLAY) {
      const overlay = isHeadRequest ? null : ErrorOverlay.getRuntime();
      return builder.withContentType(HTTP_CONTENT_TYPES.JS, overlay, HTTP_OK);
    }

    return null;
  }

  private normalizeDevEndpoint(pathname: string): string | null {
    if (
      pathname === DEV_SERVER_ENDPOINTS.HMR_RUNTIME ||
      pathname === DEV_SERVER_ENDPOINTS.ERROR_OVERLAY
    ) {
      return pathname;
    }

    if (pathname.startsWith("/__veryfront/")) {
      const rewritten = pathname.replace("/__veryfront/", "/_veryfront/");
      if (
        rewritten === DEV_SERVER_ENDPOINTS.HMR_RUNTIME ||
        rewritten === DEV_SERVER_ENDPOINTS.ERROR_OVERLAY
      ) {
        return rewritten;
      }
    }

    return null;
  }

  private getHMRRuntime(): string | null {
    if (!this.hmrServer) {
      return null;
    }

    const runtimeProvider = this.hmrServer as unknown as { getHMRRuntime?: () => string };
    if (typeof runtimeProvider.getHMRRuntime === "function") {
      try {
        return runtimeProvider.getHMRRuntime();
      } catch (error) {
        logger.debug("[dev] failed to read HMR runtime from server", error);
      }
    }

    return null;
  }

  private async handleApplicationRequest(req: Request): Promise<Response> {
    if (!this.universalHandler) {
      const { createVeryfrontHandler } = await import("../universal-handler/index.ts");
      this.universalHandler = createVeryfrontHandler(this.projectDir, this.adapter, {
        projectDir: this.projectDir,
        debug: this.isDebug(),
        mode: "development",
        // Module server is integrated into main server at /_vf_modules/
        // Use relative path since modules are served on the same server
        moduleServerUrl: "/_vf_modules",
        config: this.config,
      });
    }

    return await this.universalHandler(req);
  }

  invalidateUniversalHandler(): void {
    this.universalHandler = undefined;
    // Also reset the API handler cache to pick up new/modified handlers
    resetApiHandler(this.projectDir).catch((error) => {
      logger.debug("[dev] resetApiHandler failed", error);
    });
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
