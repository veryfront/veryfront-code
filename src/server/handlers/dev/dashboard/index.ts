/**
 * Dev - Dashboard
 *
 * @module server/handlers/dev/dashboard
 */

import { BaseHandler } from "../../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../../types.ts";
import {
  HTTP_METHOD_NOT_ALLOWED,
  HTTP_OK,
  HTTP_UNAUTHORIZED,
  PRIORITY_HIGH_DEV,
} from "#veryfront/utils/constants/index.ts";
import type { HandlerPriority } from "#veryfront/types";
import { DASHBOARD_SHELL_HTML } from "./html-shell.ts";
import { getDashboardApiRoutePaths, handleDashboardAPI } from "./api.ts";
import { handleDashboardUI } from "./ui-handler.ts";
import { createDevNotFoundResponse } from "../shared/not-found-response.ts";
import { isAuthorizedDevControlRequest } from "../access-policy.ts";

const DASHBOARD_GET_API_PATHS = new Set(getDashboardApiRoutePaths("GET"));
const DASHBOARD_POST_API_PATHS = new Set(getDashboardApiRoutePaths("POST"));

function hasSameBrowserOrigin(req: Request): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  const origin = req.headers.get("origin");
  return origin === null || origin === new URL(req.url).origin;
}

function getAllowedMethods(pathname: string): string[] | null {
  if (pathname === "/_dev" || pathname === "/_dev/" || pathname.startsWith("/_dev/ui/")) {
    return ["GET"];
  }

  if (pathname.startsWith("/_dev/api/")) {
    const methods: string[] = [];
    if (DASHBOARD_GET_API_PATHS.has(pathname)) methods.push("GET");
    if (DASHBOARD_POST_API_PATHS.has(pathname)) methods.push("POST");
    return methods.length > 0 ? methods : null;
  }

  return null;
}

function withPrivateDashboardHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export class DevDashboardHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "DevDashboardHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [{ pattern: "/_dev", exact: false }],
    enabled: (ctx) => !!ctx.isLocalProject,
  };

  protected override shouldHandle(req: Request, ctx: HandlerContext): boolean {
    if (!this.metadata.enabled?.(ctx)) return false;
    const { pathname } = new URL(req.url);
    return pathname === "/_dev" || pathname.startsWith("/_dev/");
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return this.continue();

    const { pathname } = new URL(req.url);
    if (!isAuthorizedDevControlRequest(req, ctx) || !hasSameBrowserOrigin(req)) {
      return this.respond(
        this.createPrivateResponseBuilder(ctx).text("Unauthorized", HTTP_UNAUTHORIZED),
      );
    }

    const allowedMethods = getAllowedMethods(pathname);
    if (allowedMethods && !allowedMethods.includes(req.method.toUpperCase())) {
      return this.respond(
        this.createPrivateResponseBuilder(ctx)
          .withAllow(allowedMethods)
          .text("Method Not Allowed", HTTP_METHOD_NOT_ALLOWED),
      );
    }

    if (pathname === "/_dev" || pathname === "/_dev/") {
      return this.respond(
        this.createPrivateResponseBuilder(ctx).withContentType(
          "text/html; charset=utf-8",
          DASHBOARD_SHELL_HTML,
          HTTP_OK,
        ),
      );
    }

    if (pathname.startsWith("/_dev/ui/")) {
      const response = await handleDashboardUI(req);
      if (response) return this.respond(withPrivateDashboardHeaders(response));
      return this.respond(withPrivateDashboardHeaders(createDevNotFoundResponse()));
    }

    if (pathname.startsWith("/_dev/api/")) {
      const response = await handleDashboardAPI(req, ctx);
      if (response) return this.respond(withPrivateDashboardHeaders(response));
      return this.respond(withPrivateDashboardHeaders(createDevNotFoundResponse()));
    }

    return this.respond(withPrivateDashboardHeaders(createDevNotFoundResponse()));
  }

  private createPrivateResponseBuilder(ctx: HandlerContext) {
    return this.createResponseBuilder(ctx)
      .withCache("no-store")
      .withHeaders({ "X-Content-Type-Options": "nosniff" });
  }
}
