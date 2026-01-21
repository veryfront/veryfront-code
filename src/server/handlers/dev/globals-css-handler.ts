/**
 * Globals CSS Handler
 *
 * Serves globals.css as a file for proper HMR support.
 * CSS served via <link> tags can be hot-reloaded by updating the href.
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { HTTP_NOT_FOUND, HTTP_OK, PRIORITY_HIGH_DEV } from "#veryfront/utils/constants/index.ts";
import { joinPath } from "#veryfront/utils/path-utils.ts";

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

    try {
      // Load globals.css from project root
      const filePath = joinPath(ctx.projectDir, "globals.css");
      let css = await ctx.adapter.fs.readFile(filePath);

      // Strip Tailwind v4 directives - these are build-time only
      // Browser CDN doesn't support @plugin or @import "tailwindcss"
      css = css
        .replace(/@import\s+["']tailwindcss["'];?\s*/g, "")
        .replace(/@plugin\s+["'][^"']+["'](\s*\{[^}]*\})?;?\s*/g, "");

      const response = this.createResponseBuilder(ctx)
        .withCache("no-cache") // No caching for HMR to work
        .withContentType("text/css; charset=utf-8", css, HTTP_OK);

      return this.respond(response);
    } catch (error) {
      this.logDebug("globals.css not found", { error: this.getErrorMessage(error) }, ctx);

      // Return empty CSS if file doesn't exist
      const response = this.createResponseBuilder(ctx)
        .withCache("no-cache")
        .withContentType("text/css; charset=utf-8", "/* globals.css not found */", HTTP_NOT_FOUND);

      return this.respond(response);
    }
  }
}
