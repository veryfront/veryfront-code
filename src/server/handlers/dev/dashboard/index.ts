/**
 * Dev - Dashboard
 *
 * @module server/handlers/dev/dashboard
 */

import { BaseHandler } from "../../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../../types.ts";
import { HTTP_OK, PRIORITY_HIGH_DEV } from "#veryfront/utils/constants/index.ts";
import type { HandlerPriority } from "#veryfront/types";
import { createDashboardShellHtml } from "./html-shell.ts";
import { handleDashboardAPI } from "./api.ts";
import { handleDashboardUI } from "./ui-handler.ts";
import { createDevNotFoundResponse } from "../shared/not-found-response.ts";
import { errorResponse } from "../http-helpers.ts";
import {
  createDevUiAssetsUnavailableResponse,
  omitHeadResponseBody,
} from "../shared/dev-ui-bundle-response.ts";
import {
  createDashboardSessionCookie,
  DASHBOARD_ACCESS_DENIED_MESSAGE,
  getDashboardSessionToken,
  hasValidDashboardMutationSession,
  isTrustedDashboardRequest,
} from "./access-policy.ts";
import type { DevUiAssetProvider } from "#veryfront/extensions/dev-ui";
import { DASHBOARD_SESSION_PATH } from "#veryfront/extensions/dev-ui/protocol";
import { cancelRejectedLocalControlRequestBody } from "#veryfront/security/http/local-control-request.ts";

const HEADLESS_SESSION_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": "text/plain; charset=utf-8",
});
const DASHBOARD_SHELL_ALLOWED_METHODS = "GET, HEAD";

export class DevDashboardHandler extends BaseHandler {
  private readonly browserBundle?: string;

  constructor(provider?: Readonly<DevUiAssetProvider>) {
    super();
    this.browserBundle = provider?.browserBundle;
  }

  metadata: HandlerMetadata = {
    name: "DevDashboardHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [{ pattern: "/_dev", exact: false }],
    enabled: (ctx) => !!ctx.isLocalProject,
  };

  protected override shouldHandle(req: Request, _ctx: HandlerContext): boolean {
    const { pathname } = new URL(req.url);
    return pathname === "/_dev" || pathname.startsWith("/_dev/");
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return this.continue();
    if (!ctx.isLocalProject) return this.continue();
    if (!isTrustedDashboardRequest(req)) {
      cancelRejectedLocalControlRequestBody(req, "Dashboard request rejected");
      const response = errorResponse(DASHBOARD_ACCESS_DENIED_MESSAGE, 403);
      response.headers.set("Cache-Control", "no-store");
      return this.respond(omitHeadResponseBody(req, response));
    }

    const { pathname } = new URL(req.url);

    if (pathname === DASHBOARD_SESSION_PATH) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        cancelRejectedLocalControlRequestBody(req, "Dashboard session method rejected");
        return this.respond(
          new Response("Method not allowed", {
            status: 405,
            headers: { ...HEADLESS_SESSION_HEADERS, Allow: "GET, HEAD" },
          }),
        );
      }
      return this.respond(
        new Response(null, {
          status: 204,
          headers: {
            ...HEADLESS_SESSION_HEADERS,
            "Set-Cookie": createDashboardSessionCookie(req),
          },
        }),
      );
    }

    if (pathname === "/_dev" || pathname === "/_dev/") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        cancelRejectedLocalControlRequestBody(req, "Dashboard shell method rejected");
        return this.respond(
          new Response("Method not allowed", {
            status: 405,
            headers: {
              ...HEADLESS_SESSION_HEADERS,
              Allow: DASHBOARD_SHELL_ALLOWED_METHODS,
            },
          }),
        );
      }
      if (this.browserBundle === undefined) {
        return this.respond(
          omitHeadResponseBody(req, createDevUiAssetsUnavailableResponse()),
        );
      }
      return this.respond(
        omitHeadResponseBody(
          req,
          this.createResponseBuilder(ctx)
            .withCache("no-store")
            .withHeaders({ "Set-Cookie": createDashboardSessionCookie(req) })
            .withContentType(
              "text/html; charset=utf-8",
              createDashboardShellHtml(getDashboardSessionToken()),
              HTTP_OK,
            ),
        ),
      );
    }

    if (pathname.startsWith("/_dev/ui/")) {
      const response = handleDashboardUI(req, this.browserBundle);
      if (response) return this.respond(omitHeadResponseBody(req, response));
      return this.respond(omitHeadResponseBody(req, createDevNotFoundResponse()));
    }

    if (pathname.startsWith("/_dev/api/")) {
      // Gate every method that is not a plain read. Only POST routes exist
      // today, but keying the session check to "not GET/HEAD" (rather than
      // "is POST") makes the fail-closed property structural: a future
      // PUT/PATCH/DELETE route — and unrouted methods such as OPTIONS —
      // cannot silently bypass the double-submit mutation session.
      const isReadMethod = req.method === "GET" || req.method === "HEAD";
      if (!isReadMethod && !hasValidDashboardMutationSession(req)) {
        cancelRejectedLocalControlRequestBody(req, "Dashboard mutation session rejected");
        const response = errorResponse("Dashboard mutation requires a valid session", 403);
        response.headers.set("Cache-Control", "no-store");
        return this.respond(omitHeadResponseBody(req, response));
      }
      const response = await handleDashboardAPI(req, ctx);
      if (response) return this.respond(omitHeadResponseBody(req, response));
      return this.respond(omitHeadResponseBody(req, createDevNotFoundResponse()));
    }

    return this.respond(omitHeadResponseBody(req, createDevNotFoundResponse()));
  }
}
