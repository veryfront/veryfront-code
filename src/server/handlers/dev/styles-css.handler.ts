/** Serve the request-scoped development stylesheet. */

import { createErrorResponse, SERVICE_OVERLOADED } from "#veryfront/errors";
import { serverLogger } from "#veryfront/utils";
import { HTTP_OK, PRIORITY_HIGH_DEV } from "#veryfront/utils/constants/index.ts";
import { getSafeErrorName } from "../../utils/error-name.ts";
import { BaseHandler } from "../response/base.ts";
import {
  ProjectSourceContextUnavailableError,
  runWithProjectSourceContext,
} from "../shared/project-source-context.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { StylesCSSService, toPrivateStyleFailure } from "./styles-css-service.ts";

const logger = serverLogger.component("styles-css-handler");

export class StylesCSSHandler extends BaseHandler {
  readonly #service = new StylesCSSService();

  metadata: HandlerMetadata = {
    name: "StylesCSSHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [{ pattern: "/_vf_styles/styles.css", exact: true, method: "GET" }],
    enabled: () => true,
  };

  /** Keep inherited proxy-context diagnostics free of project-scoped identifiers. */
  protected override logDebug(
    message: string,
    _extra?: Record<string, unknown>,
    _ctx?: HandlerContext,
  ): void {
    logger.debug(message);
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return this.continue();

    try {
      return await runWithProjectSourceContext(ctx, async () => {
        const css = await this.#service.generate(ctx);
        const response = this.createResponseBuilder(ctx)
          .withCache("no-store")
          .withHeaders({ "X-Content-Type-Options": "nosniff" })
          .withContentType("text/css; charset=utf-8", css, HTTP_OK);
        return this.respond(response);
      }, { productionMode: false });
    } catch (error) {
      const failure = error instanceof ProjectSourceContextUnavailableError
        ? SERVICE_OVERLOADED.create()
        : toPrivateStyleFailure(error);
      logger.error("Stylesheet request failed", {
        errorName: getSafeErrorName(error),
        errorSlug: failure.slug,
      });
      return this.respond(createErrorResponse(failure));
    }
  }
}
