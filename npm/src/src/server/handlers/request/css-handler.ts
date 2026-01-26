import * as dntShim from "../../../../_dnt.shims.js";
import { BaseHandler } from "../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.js";
import {
  getCSSByHashAsync,
  regenerateCSSByHash,
} from "../../../html/styles-builder/tailwind-compiler.js";
import { HTTP_OK, PRIORITY_HIGH } from "../../../utils/constants/index.js";
import {
  extractCacheKeyContext,
  runWithCacheKeyContext,
} from "../../../cache/cache-key-builder.js";

/** Pattern to match hashed CSS URLs: /_vf/css/[8-char-hash].css */
const CSS_URL_PATTERN = /^\/_vf\/css\/([a-z0-9-]{1,16})\.css$/;

/**
 * Get CSS by hash with JIT regeneration fallback.
 *
 * Flow:
 * 1. Check local + distributed cache for CSS
 * 2. If not found, attempt JIT regeneration using cached inputs
 * 3. JIT regeneration allows any pod to regenerate CSS without fetching project files
 */
async function getCSSWithJITFallback(cssHash: string): Promise<string | undefined> {
  // Fast path: check caches
  const cached = await getCSSByHashAsync(cssHash);
  if (cached) return cached;

  // Slow path: JIT regeneration using cached inputs
  // This works because we store {candidates, stylesheet} alongside the CSS hash
  const regenerated = await regenerateCSSByHash(cssHash);
  return regenerated;
}

export class CSSHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "CSSHandler",
    priority: PRIORITY_HIGH as HandlerPriority,
    patterns: [
      { pattern: CSS_URL_PATTERN, method: "GET" },
      { pattern: CSS_URL_PATTERN, method: "HEAD" },
    ],
  };

  async handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult> {
    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") return this.continue();

    const cssHash = new URL(req.url).pathname.match(CSS_URL_PATTERN)?.[1];
    if (!cssHash) return this.continue();

    // Set cache context for project-scoped distributed cache lookup
    const cacheCtx = extractCacheKeyContext(ctx);

    // Try cache first, then JIT regeneration if cache miss
    const css = await runWithCacheKeyContext(cacheCtx, () => getCSSWithJITFallback(cssHash));

    if (!css) {
      // CSS not found and JIT regeneration failed (no cached inputs)
      // This only happens if inputs cache also failed - very rare
      this.logInfo(`CSS not found and JIT regeneration failed: ${cssHash}`, {}, ctx);
    }

    // Always return 200 to prevent browser blocking on 404
    // If CSS is not found, return minimal placeholder
    const fallbackCSS = `/* CSS ${cssHash} not found - refresh page to regenerate styles */`;

    const response = this.createResponseBuilder(ctx)
      .withCORS(req, ctx.securityConfig?.cors)
      .withCache(css ? "immutable" : "no-cache")
      .withContentType(
        "text/css; charset=utf-8",
        method === "HEAD" ? null : css ?? fallbackCSS,
        HTTP_OK,
      );

    return this.respond(response);
  }
}
