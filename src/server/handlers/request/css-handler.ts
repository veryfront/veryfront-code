/**
 * Hashed CSS Handler
 *
 * Serves Tailwind CSS by hash at /_vf/css/[hash].css
 *
 * In production, CSS is generated during SSR and cached by hash.
 * The browser requests the hashed URL and receives the cached CSS
 * with immutable caching headers for optimal performance.
 *
 * Flow:
 * 1. SSR generates HTML with <link href="/_vf/css/[hash].css">
 * 2. cacheCSSAsync() stores CSS in memory + distributed cache
 * 3. Browser requests /_vf/css/[hash].css
 * 4. This handler retrieves CSS by hash and serves it
 *
 * Note: The distributed cache (API) is project-scoped, so we must set up
 * the cache context from HandlerContext before looking up CSS.
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { getCSSByHashAsync } from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { HTTP_NOT_FOUND, HTTP_OK, PRIORITY_HIGH } from "#veryfront/utils/constants/index.ts";
import { extractCacheKeyContext, runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";

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
    if (method !== "GET" && method !== "HEAD") {
      return this.continue();
    }

    const url = new URL(req.url);
    const match = url.pathname.match(CSS_URL_PATTERN);

    const cssHash = match?.[1];
    if (!cssHash) {
      return this.continue();
    }

    // Extract cache context from handler context for distributed cache lookup.
    // The distributed cache (API) is project-scoped, so we need context to find
    // CSS that was stored during SSR (which may have been on a different pod).
    const cacheCtx = extractCacheKeyContext(ctx);

    // Retrieve CSS from cache by hash (checks local then distributed cache)
    const css = await runWithCacheKeyContext(cacheCtx, () => getCSSByHashAsync(cssHash));

    if (!css) {
      // Cache miss - CSS was either never cached or evicted
      // This can happen if server restarted between SSR and CSS request
      this.logDebug(`CSS hash not found: ${cssHash}`, {}, ctx);

      const builder = this.createResponseBuilder(ctx);
      return this.respond(
        builder
          .withCORS(req, ctx.securityConfig?.cors)
          .withCache("no-cache")
          .withContentType(
            "text/css; charset=utf-8",
            method === "HEAD" ? null : `/* CSS ${cssHash} not found - page may need refresh */`,
            HTTP_NOT_FOUND,
          ),
      );
    }

    // Serve CSS with immutable caching (hash-based URLs never change)
    const builder = this.createResponseBuilder(ctx);
    return this.respond(
      builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withCache("immutable")
        .withContentType(
          "text/css; charset=utf-8",
          method === "HEAD" ? null : css,
          HTTP_OK,
        ),
    );
  }
}
