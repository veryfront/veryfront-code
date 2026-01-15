import { BaseHandler } from "../../response/base.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "../../types.ts";
import { HTTP_OK, PRIORITY_HIGH } from "@veryfront/core/constants/index.ts";
import { PROJECTS_SHELL_HTML } from "./html-shell.ts";
import { handleProjectsAPI } from "./api.ts";
import { handleProjectsUI } from "./ui-handler.ts";

export class ProjectsHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "ProjectsHandler",
    priority: PRIORITY_HIGH as HandlerPriority,
    patterns: [
      { pattern: "/", exact: true },
      { pattern: "/_projects", exact: false },
    ],
    enabled: (ctx) => {
      // Only enable when:
      // 1. We're on a veryfront domain (lvh.me, veryfront.me, etc.)
      // 2. There's NO project slug (root domain without subdomain)
      // 3. We're in proxy mode (multi-project mode)
      const isVeryfrontDomain = ctx.parsedDomain?.isVeryfrontDomain === true;
      const hasNoSlug = !ctx.projectSlug;
      const isProxyMode = ctx.config?.fs?.veryfront?.proxyMode === true;

      return isVeryfrontDomain && hasNoSlug && isProxyMode;
    },
  };

  protected override shouldHandle(req: Request, ctx: HandlerContext): boolean {
    if (!this.metadata.enabled?.(ctx)) return false;

    const { pathname } = new URL(req.url);
    return pathname === "/" || pathname.startsWith("/_projects");
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return this.continue();

    const { pathname } = new URL(req.url);

    // Serve the React app shell for root path
    if (pathname === "/" || pathname === "/_projects" || pathname === "/_projects/") {
      return this.respond(
        this.createResponseBuilder(ctx)
          .withCache("no-cache")
          .withContentType("text/html; charset=utf-8", PROJECTS_SHELL_HTML, HTTP_OK),
      );
    }

    // Handle UI module requests
    if (pathname.startsWith("/_projects/ui/")) {
      const response = await handleProjectsUI(req);
      if (response) return this.respond(response);
    }

    // Handle API requests
    if (pathname.startsWith("/_projects/api/")) {
      const response = await handleProjectsAPI(req, ctx);
      if (response) return this.respond(response);
    }

    return this.respond(
      new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }
}
