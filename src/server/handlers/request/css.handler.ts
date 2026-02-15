import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import {
  getCSSByHashAsync,
  regenerateCSSByHash,
} from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { HTTP_OK, PRIORITY_HIGH } from "#veryfront/utils/constants/index.ts";
import {
  extractCacheKeyContext,
  runWithCacheKeyContext,
} from "#veryfront/cache/cache-key-builder.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";

/** Pattern to match hashed CSS URLs: /_vf/css/[8-char-hash].css */
const CSS_URL_PATTERN = /^\/_vf\/css\/([a-z0-9-]{1,16})\.css$/;

async function getCSSWithJITFallback(cssHash: string): Promise<string | undefined> {
  const cached = await getCSSByHashAsync(cssHash);
  if (cached) return cached;

  return regenerateCSSByHash(cssHash);
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

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") return this.continue();

    const cssHash = new URL(req.url).pathname.match(CSS_URL_PATTERN)?.[1];
    if (!cssHash) return this.continue();

    const cacheCtx = extractCacheKeyContext(ctx);

    // CSS requests are lightweight paths that skip proxy header validation,
    // so the multi-project adapter's AsyncLocalStorage is empty. Without it,
    // the distributed API cache backend can't authenticate and silently returns
    // null — causing cross-pod cache misses. Wrap the lookup in request context
    // so the API backend can resolve the token and project.
    const effectiveToken = ctx.proxyToken || getEnv("VERYFRONT_API_TOKEN") || "";
    const lookup = () => runWithCacheKeyContext(cacheCtx, () => getCSSWithJITFallback(cssHash));

    const css = ctx.projectSlug
      ? await runWithRequestContext(
        {
          projectSlug: ctx.projectSlug,
          token: effectiveToken,
          projectId: ctx.projectId,
          productionMode: ctx.resolvedEnvironment === "production",
          releaseId: ctx.releaseId,
        },
        lookup,
      )
      : await lookup();

    if (!css) {
      this.logInfo(
        `CSS not found and JIT regeneration failed: ${cssHash}. ` +
          `Server restart or cache expiry. Reload page to regenerate.`,
        {},
        ctx,
      );

      // Return 404 instead of 200 with comment - this is more honest
      // and allows the browser to properly handle the missing resource
      const response = this.createResponseBuilder(ctx)
        .withCORS(req, ctx.securityConfig?.cors)
        .withCache("no-cache")
        .withContentType(
          "text/css; charset=utf-8",
          `/* CSS ${cssHash} not found - reload page to regenerate */`,
          404,
        );

      return this.respond(response);
    }

    const body = method === "HEAD" ? null : css;

    const response = this.createResponseBuilder(ctx)
      .withCORS(req, ctx.securityConfig?.cors)
      .withCache("immutable")
      .withContentType("text/css; charset=utf-8", body, HTTP_OK);

    return this.respond(response);
  }
}
