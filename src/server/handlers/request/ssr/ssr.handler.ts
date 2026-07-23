/** HTTP selection boundary for server-side rendered pages. */

import { BaseHandler } from "../../response/base.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "../../types.ts";
import { PRIORITY_LOW } from "#veryfront/utils/constants/index.ts";
import { SSRService, type SSRServiceLike } from "../../../services/rendering/ssr.service.ts";
import {
  createProjectCodeUnavailableResponse,
  shouldRejectUnisolatedProjectCode,
} from "../../../utils/project-code-isolation.ts";
import { SSRRequestCoordinator } from "./ssr-request-coordinator.ts";

export { isProductionMode } from "./ssr-request-policy.ts";
import { isProductionMode } from "./ssr-request-policy.ts";

export class SSRHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "SSRHandler",
    priority: PRIORITY_LOW as HandlerPriority,
    patterns: [{ pattern: /^(?!\/_).*/, method: ["GET", "HEAD"] }],
  };

  readonly #coordinator: SSRRequestCoordinator;

  constructor(ssrService: SSRServiceLike = new SSRService()) {
    super();
    this.#coordinator = new SSRRequestCoordinator(ssrService, this.helpers);
  }

  handle(request: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname.startsWith("/_veryfront/")) return Promise.resolve(this.continue());

    const hasFileExtension = /\.[a-zA-Z0-9]+$/.test(pathname) &&
      !pathname.includes("/.veryfront/") && !pathname.startsWith("/.veryfront");
    if (hasFileExtension) return Promise.resolve(this.continue());

    const slug = pathname === "/" ? "" : pathname.replace(/^\//, "").replace(/\/$/, "");
    const hasDotSegment = slug.split("/").some((segment) => segment.startsWith("."));
    if (hasDotSegment && isProductionMode(ctx)) {
      this.logDebug("Dot path blocked in production", undefined, ctx);
      return Promise.resolve(this.continue());
    }

    if (shouldRejectUnisolatedProjectCode(ctx)) {
      return Promise.resolve(this.respond(createProjectCodeUnavailableResponse(request)));
    }

    this.logDebug("SSR attempt", { routeKind: slug ? "page" : "root" }, ctx);
    return this.#coordinator.handle(request, ctx, slug, url);
  }
}
