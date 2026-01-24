/**
 * Globals CSS Handler
 *
 * Serves globals.css compiled via Tailwind's API for proper directive support.
 * CSS served via <link> tags can be hot-reloaded by updating the href.
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { HTTP_NOT_FOUND, HTTP_OK, PRIORITY_HIGH_DEV } from "#veryfront/utils/constants/index.ts";
import { joinPath } from "#veryfront/utils/path-utils.ts";
import { compileGlobalsCSS } from "#veryfront/html/styles-builder/tailwind-compiler.ts";

export class GlobalsCSSHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "GlobalsCSSHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [{ pattern: "/_vf_styles/globals.css", exact: true, method: "GET" }],
    // Enable in all modes for consistent styling
    enabled: () => true,
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return this.continue();
    }

    // Wrap in proxy context for multi-project mode file resolution
    return await this.withProxyContext(ctx, async () => {
      // Load stylesheet from project root (configurable via tailwind.stylesheet)
      const stylesheetPath = ctx.config?.tailwind?.stylesheet || "globals.css";
      const filePath = joinPath(ctx.projectDir, stylesheetPath);
      const responseBuilder = this.createResponseBuilder(ctx).withCache("no-cache"); // No caching for HMR to work

      try {
        const rawCss = await ctx.adapter.fs.readFile(filePath);
        const css = await compileGlobalsCSS(rawCss);

        return this.respond(
          responseBuilder.withContentType("text/css; charset=utf-8", css, HTTP_OK),
        );
      } catch (error) {
        this.logDebug(`${stylesheetPath} not found`, { error: this.getErrorMessage(error) }, ctx);

        return this.respond(
          responseBuilder.withContentType(
            "text/css; charset=utf-8",
            `/* ${stylesheetPath} not found */`,
            HTTP_NOT_FOUND,
          ),
        );
      }
    });
  }
}
