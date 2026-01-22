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
    patterns: [
      { pattern: "/_vf_styles/globals.css", exact: true, method: "GET" },
    ],
    // Enable in all modes for consistent styling
    enabled: () => true,
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return this.continue();
    }

    // Wrap in proxy context for multi-project mode file resolution
    return await this.withProxyContext(ctx, async () => {
      try {
        // Load globals.css from project root
        const filePath = joinPath(ctx.projectDir, "globals.css");
        const rawCss = await ctx.adapter.fs.readFile(filePath);

        // Compile using Tailwind's API - properly handles @theme, @utility, @variant, etc.
        const css = await compileGlobalsCSS(rawCss);

        const response = this.createResponseBuilder(ctx)
          .withCache("no-cache") // No caching for HMR to work
          .withContentType("text/css; charset=utf-8", css, HTTP_OK);

        return this.respond(response);
      } catch (error) {
        this.logDebug("globals.css not found", { error: this.getErrorMessage(error) }, ctx);

        // Return empty CSS if file doesn't exist
        const response = this.createResponseBuilder(ctx)
          .withCache("no-cache")
          .withContentType(
            "text/css; charset=utf-8",
            "/* globals.css not found */",
            HTTP_NOT_FOUND,
          );

        return this.respond(response);
      }
    });
  }
}
