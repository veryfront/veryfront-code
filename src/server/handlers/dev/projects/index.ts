/**
 * Dev - Projects
 *
 * @module server/handlers/dev/projects
 */

import { BaseHandler } from "../../response/base.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "../../types.ts";
import { HTTP_OK, PRIORITY_HIGH } from "#veryfront/utils/constants/index.ts";
import { PROJECTS_SHELL_HTML } from "./html-shell.ts";
import { handleProjectsAPI } from "./api.ts";
import { handleProjectsUI } from "./ui-handler.ts";
import { createDevNotFoundResponse } from "../shared/not-found-response.ts";
import {
  createDevUiAssetsUnavailableResponse,
  omitHeadResponseBody,
} from "../shared/dev-ui-bundle-response.ts";
import type { DevUiAssetProvider } from "#veryfront/extensions/dev-ui";
import { isTrustedLocalControlRequest } from "#veryfront/security/http/local-control-request.ts";

const PROJECTS_ALLOWED_METHODS = "GET, HEAD";

function cancelRejectedRequestBody(req: Request): void {
  try {
    void req.body?.cancel().catch(() => {});
  } catch {
    // Preserve the deterministic method response if a hostile stream is
    // already locked or fails while cancellation is attempted.
  }
}

export class ProjectsHandler extends BaseHandler {
  private readonly browserBundle?: string;

  constructor(provider?: Readonly<DevUiAssetProvider>) {
    super();
    this.browserBundle = provider?.browserBundle;
  }

  metadata: HandlerMetadata = {
    name: "ProjectsHandler",
    priority: PRIORITY_HIGH as HandlerPriority,
    patterns: [
      { pattern: "/", exact: true },
      { pattern: "/_projects", exact: false },
    ],
    enabled: (ctx) => {
      const isVeryfrontDomain = ctx.parsedDomain?.isVeryfrontDomain === true;
      const hasNoSlug = !ctx.projectSlug;

      // Enable for veryfront domains without a project slug
      // Works in both proxy mode and local multi-project mode
      return isVeryfrontDomain && hasNoSlug;
    },
  };

  protected override shouldHandle(req: Request, ctx: HandlerContext): boolean {
    if (!this.metadata.enabled?.(ctx)) return false;
    if (!isTrustedLocalControlRequest(req)) return false;

    const { pathname } = new URL(req.url);
    return pathname === "/" || pathname.startsWith("/_projects");
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return this.continue();

    if (req.method !== "GET" && req.method !== "HEAD") {
      cancelRejectedRequestBody(req);
      return this.respond(
        new Response("Method Not Allowed", {
          status: 405,
          headers: {
            Allow: PROJECTS_ALLOWED_METHODS,
            "Cache-Control": "no-store",
            "Content-Type": "text/plain; charset=utf-8",
          },
        }),
      );
    }

    const { pathname } = new URL(req.url);

    if (pathname === "/" || pathname === "/_projects" || pathname === "/_projects/") {
      if (this.browserBundle === undefined) {
        return this.respond(
          omitHeadResponseBody(req, createDevUiAssetsUnavailableResponse()),
        );
      }
      return this.respond(
        omitHeadResponseBody(
          req,
          this.createResponseBuilder(ctx).withCache("no-store").withContentType(
            "text/html; charset=utf-8",
            PROJECTS_SHELL_HTML,
            HTTP_OK,
          ),
        ),
      );
    }

    if (pathname.startsWith("/_projects/ui/")) {
      const response = handleProjectsUI(req, this.browserBundle);
      if (response) return this.respond(omitHeadResponseBody(req, response));
      return this.respond(omitHeadResponseBody(req, createDevNotFoundResponse()));
    }

    if (pathname.startsWith("/_projects/api/")) {
      const response = await handleProjectsAPI(req, ctx);
      if (response) return this.respond(omitHeadResponseBody(req, response));
      return this.respond(omitHeadResponseBody(req, createDevNotFoundResponse()));
    }

    return this.respond(omitHeadResponseBody(req, createDevNotFoundResponse()));
  }
}
