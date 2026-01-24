import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { getCSSByHashAsync } from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { HTTP_NOT_FOUND, HTTP_OK, PRIORITY_HIGH } from "#veryfront/utils/constants/index.ts";
import {
  extractCacheKeyContext,
  runWithCacheKeyContext,
} from "#veryfront/cache/cache-key-builder.ts";

/** Pattern to match hashed CSS URLs: /_vf/css/[8-char-hash].css */
const CSS_URL_PATTERN = /^\/_vf\/css\/([a-z0-9-]{1,16})\.css$/;

export class CSSHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "CSSHandler",
    priority: PRIORITY_HIGH as HandlerPriority,
    patterns: [
      { pattern: CSS_URL_PATTERN, method: "GET" },
      { pattern: CSS_URL_PATTERN, method: "HEAD" },
    ],
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") return this.continue();

    const cssHash = new URL(req.url).pathname.match(CSS_URL_PATTERN)?.[1];
    if (!cssHash) return this.continue();

    // Set cache context for project-scoped distributed cache lookup
    const cacheCtx = extractCacheKeyContext(ctx);
    const css = await runWithCacheKeyContext(cacheCtx, () => getCSSByHashAsync(cssHash));

    if (!css) this.logDebug(`CSS hash not found: ${cssHash}`, {}, ctx);

    const response = this.createResponseBuilder(ctx)
      .withCORS(req, ctx.securityConfig?.cors)
      .withCache(css ? "immutable" : "no-cache")
      .withContentType(
        "text/css; charset=utf-8",
        method === "HEAD" ? null : css ?? `/* CSS ${cssHash} not found - page may need refresh */`,
        css ? HTTP_OK : HTTP_NOT_FOUND,
      );

    return this.respond(response);
  }
}
