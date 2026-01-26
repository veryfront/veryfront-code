import * as dntShim from "../../../../../_dnt.shims.js";
import { BaseHandler } from "../../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../../types.js";
import { HTTP_OK, PRIORITY_HIGH_DEV } from "../../../../utils/constants/index.js";
import type { HandlerPriority } from "../../../../types/index.js";
import { DASHBOARD_SHELL_HTML } from "./html-shell.js";
import { handleDashboardAPI } from "./api.js";
import { handleDashboardUI } from "./ui-handler.js";

export class DevDashboardHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "DevDashboardHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [{ pattern: "/_dev", exact: false }],
    enabled: (ctx) => ctx.requestContext?.isLocalDev ?? false,
  };

  protected override shouldHandle(req: dntShim.Request, _ctx: HandlerContext): boolean {
    const { pathname } = new URL(req.url);
    return pathname === "/_dev" || pathname.startsWith("/_dev/");
  }

  async handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult> {
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
      return response ? this.respond(response) : this.respondNotFound();
    }

    if (pathname.startsWith("/_dev/api/")) {
      const response = await handleDashboardAPI(req, ctx);
      return response ? this.respond(response) : this.respondNotFound();
    }

    return this.respondNotFound();
  }

  private respondNotFound(): HandlerResult {
    return this.respond(
      new dntShim.Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }
}
