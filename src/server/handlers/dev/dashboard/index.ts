import { BaseHandler } from "../../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../../types.ts";
import { HTTP_OK, PRIORITY_HIGH_DEV } from "#veryfront/utils/constants/index.ts";
import type { HandlerPriority } from "#veryfront/types";
import { DASHBOARD_SHELL_HTML } from "./html-shell.ts";
import { handleDashboardAPI } from "./api.ts";
import { handleDashboardUI } from "./ui-handler.ts";
import { createDevNotFoundResponse } from "../shared/not-found-response.ts";

export class DevDashboardHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "DevDashboardHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [{ pattern: "/_dev", exact: false }],
    enabled: (ctx) => ctx.requestContext?.isLocalDev ?? false,
  };

  protected override shouldHandle(req: Request, _ctx: HandlerContext): boolean {
    const { pathname } = new URL(req.url);
    return pathname === "/_dev" || pathname.startsWith("/_dev/");
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return this.continue();

    const { pathname } = new URL(req.url);

    if (pathname === "/_dev" || pathname === "/_dev/") {
      return this.respond(
        this.createResponseBuilder(ctx).withCache("no-cache").withContentType(
          "text/html; charset=utf-8",
          DASHBOARD_SHELL_HTML,
          HTTP_OK,
        ),
      );
    }

    if (pathname.startsWith("/_dev/ui/")) {
      const response = await handleDashboardUI(req);
      if (response) return this.respond(response);
      return this.respond(createDevNotFoundResponse());
    }

    if (pathname.startsWith("/_dev/api/")) {
      const response = await handleDashboardAPI(req, ctx);
      if (response) return this.respond(response);
      return this.respond(createDevNotFoundResponse());
    }

    return this.respond(createDevNotFoundResponse());
  }
}
