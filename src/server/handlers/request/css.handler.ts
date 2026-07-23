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
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { getSafeErrorName } from "../../utils/error-name.ts";

/** Pattern to match hashed CSS URLs: /_vf/css/[8-char-hash].css */
const CSS_URL_PATTERN = /^\/_vf\/css\/([a-z0-9-]{1,16})\.css$/;

async function getCSSWithJITFallback(
  cssHash: string,
  projectSlug: string | undefined,
): Promise<string | undefined> {
  const cached = await getCSSByHashAsync(cssHash);
  if (cached !== undefined) return cached;

  return regenerateCSSByHash(cssHash, projectSlug);
}

async function getBuiltCSSFallback(
  cssHash: string,
  ctx: HandlerContext,
): Promise<string | undefined> {
  const builtCSSPath = join(ctx.projectDir, "dist", "_vf", "css", `${cssHash}.css`);
  const exists = await ctx.adapter.fs.exists(builtCSSPath);
  if (!exists) return undefined;
  return await ctx.adapter.fs.readFile(builtCSSPath);
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
    // null, causing cross-pod cache misses. Wrap the lookup in request context
    // so the API backend can resolve the token and project.
    // Framework-owned token: bypass project env overlay so proxy mode works
    // when a remote project overlay is active.
    const effectiveToken = ctx.proxyToken || getHostEnv("VERYFRONT_API_TOKEN") || "";
    const fetchCSS = () =>
      getCSSWithJITFallback(
        cssHash,
        ctx.projectSlug ?? ctx.projectId,
      );
    // When no scoped cache context can be built (no project identity), fetch
    // without a cache-key context rather than crashing the request.
    const lookup = () => cacheCtx ? runWithCacheKeyContext(cacheCtx, fetchCSS) : fetchCSS();

    let resolvedCSS: string | undefined;
    try {
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
      resolvedCSS = css ?? await getBuiltCSSFallback(cssHash, ctx);
    } catch (error) {
      this.logDebug("CSS lookup failed", { errorName: getSafeErrorName(error) }, ctx);
      const response = this.createResponseBuilder(ctx)
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req)
        .withCache("no-cache")
        .withContentType(
          "text/css; charset=utf-8",
          method === "HEAD" ? null : "",
          500,
        );
      return this.respond(response);
    }

    if (resolvedCSS === undefined) {
      this.logInfo(
        `CSS not found and JIT regeneration failed: ${cssHash}. ` +
          `Server restart or cache expiry. Reload page to regenerate.`,
        {},
        ctx,
      );

      const response = this.createResponseBuilder(ctx)
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req)
        .withCache("no-cache")
        .withContentType(
          "text/css; charset=utf-8",
          method === "HEAD" ? null : "",
          404,
        );

      return this.respond(response);
    }

    const body = method === "HEAD" ? null : resolvedCSS;

    const response = this.createResponseBuilder(ctx)
      .withCORS(req, ctx.securityConfig?.cors)
      .withCache("immutable")
      .withContentType("text/css; charset=utf-8", body, HTTP_OK);

    return this.respond(response);
  }
}
