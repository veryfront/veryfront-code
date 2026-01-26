/**
 * React Server Components Handler
 * Handles RSC endpoints and streaming
 */
import * as dntShim from "../../../../../_dnt.shims.js";


import { BaseHandler } from "../../response/base.js";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "../../types.js";
import { isRSCEnabled } from "../../../../utils/index.js";
import { handleRSCEndpoint } from "./endpoints/index.js";
import { applySecurityHeaders } from "../api/security-headers.js";
import { applyCORSHeaders } from "../../../../security/index.js";
import { HTTP_NOT_FOUND, PRIORITY_MEDIUM } from "../../../../utils/constants/index.js";
import { withSpan } from "../../../../observability/tracing/otlp-setup.js";

export class RSCHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "RSCHandler",
    priority: PRIORITY_MEDIUM as HandlerPriority,
    patterns: [{ pattern: "/_veryfront/rsc/", prefix: true }],
  };

  handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult> {
    const { pathname } = new URL(req.url);

    if (!pathname.startsWith("/_veryfront/rsc/")) {
      return Promise.resolve(this.continue());
    }

    const endpoint = pathname.replace("/_veryfront/rsc/", "");

    return withSpan(
      "rsc.handle",
      async () => {
        const isHydrationScript = endpoint === "client.js" || endpoint === "dom.js";
        const isDeprecatedEndpoint = endpoint === "flight_page";

        if (!isRSCEnabled(ctx.config) && !isHydrationScript && !isDeprecatedEndpoint) {
          return this.respond(new dntShim.Response("Not Found", { status: HTTP_NOT_FOUND }));
        }

        const res = await handleRSCEndpoint({
          req,
          pathname,
          projectDir: ctx.projectDir,
          adapter: ctx.adapter,
          config: ctx.config,
        });

        if (!res) {
          return this.continue();
        }

        const headers = new dntShim.Headers(res.headers);
        await applyCORSHeaders({
          request: req,
          headers,
          config: ctx.securityConfig?.cors,
        });
        applySecurityHeaders(headers, ctx);

        return this.respond(
          new dntShim.Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers,
          }),
        );
      },
      { "rsc.pathname": pathname, "rsc.endpoint": endpoint },
    );
  }
}
