
import { BaseHandler } from "../../response/base.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "../../types.ts";
import { isRSCEnabled } from "@veryfront/utils";
import { handleRSCEndpoint } from "./endpoints/index.ts";
import { applySecurityHeaders } from "../api/security-headers.ts";
import { applyCORSHeaders } from "@veryfront/security";
import { HTTP_NOT_FOUND, PRIORITY_MEDIUM } from "@veryfront/core/constants/index.ts";

export class RSCHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "RSCHandler",
    priority: PRIORITY_MEDIUM as HandlerPriority,
    patterns: [
      { pattern: "/_veryfront/rsc/", prefix: true },
    ],
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (!pathname.startsWith("/_veryfront/rsc/")) {
      return this.continue();
    }

    const sub = pathname.replace("/_veryfront/rsc/", "");
    const isHydrationScript = sub === "client.js" || sub === "dom.js";
    const isDeprecatedEndpoint = sub === "flight_page";

    if (!isRSCEnabled(ctx.config) && !isHydrationScript && !isDeprecatedEndpoint) {
      return this.respond(new Response("Not Found", { status: HTTP_NOT_FOUND }));
    }

    const res = await handleRSCEndpoint({
      req,
      pathname,
      projectDir: ctx.projectDir,
      adapter: ctx.adapter,
      config: ctx.config,
    });

    if (res) {
      const headers = new Headers(res.headers);
      await applyCORSHeaders({
        request: req,
        headers: headers,
        config: ctx.securityConfig?.cors,
      });
      applySecurityHeaders(headers, ctx);

      const wrappedRes = new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
      return this.respond(wrappedRes);
    }

    return this.continue();
  }
}
