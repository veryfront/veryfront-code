import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import {
  getCSSByHashAsync,
  regenerateCSSByHash,
} from "#veryfront/html/styles-builder/css-compiler.ts";
import { HTTP_OK, PRIORITY_HIGH } from "#veryfront/utils/constants/index.ts";
import {
  extractCacheKeyContext,
  runWithCacheKeyContext,
} from "#veryfront/cache/cache-key-builder.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { MAX_CSS_OUTPUT_FILE_BYTES } from "#veryfront/utils/constants/css.ts";
import { assertCSSOutputContent } from "#veryfront/utils/css-content-admission.ts";
import { getRequestTokenProvenance } from "../../context/request-context.ts";
import {
  createCSSAssetPathPattern,
  extractCSSAssetHash,
  hashCSS,
} from "#veryfront/html/styles-builder/css-identity.ts";

const CSS_URL_PATTERN = createCSSAssetPathPattern();

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

  let fileInfo: Awaited<ReturnType<typeof ctx.adapter.fs.stat>>;
  try {
    fileInfo = await ctx.adapter.fs.stat(builtCSSPath);
  } catch (error) {
    if (isNotFoundError(error)) return undefined;
    throw error;
  }

  if (!fileInfo.isFile) return undefined;
  if (
    !Number.isSafeInteger(fileInfo.size) ||
    fileInfo.size < 0 ||
    fileInfo.size > MAX_CSS_OUTPUT_FILE_BYTES
  ) {
    throw new TypeError(
      `Built CSS output exceeds ${MAX_CSS_OUTPUT_FILE_BYTES} bytes: ${builtCSSPath}`,
    );
  }

  let css: string;
  try {
    css = await ctx.adapter.fs.readFile(builtCSSPath);
  } catch (error) {
    // A file can disappear between stat and read. That remains an ordinary
    // cache miss; permission, transport, and integrity failures must surface.
    if (isNotFoundError(error)) return undefined;
    throw error;
  }

  assertCSSOutputContent(css, "Built CSS output");
  return hashCSS(css) === cssHash ? css : undefined;
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

    const cssHash = extractCSSAssetHash(new URL(req.url).pathname);
    if (!cssHash) return this.continue();

    const cacheCtx = extractCacheKeyContext(ctx);

    // CSS requests are lightweight paths that skip proxy header validation,
    // so the multi-project adapter's AsyncLocalStorage is empty. Without it,
    // the distributed API cache backend can't authenticate and silently returns
    // null — causing cross-pod cache misses. Wrap the lookup in request context
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

    const css = ctx.projectSlug
      ? await runWithRequestContext(
        {
          projectSlug: ctx.projectSlug,
          token: effectiveToken,
          projectId: ctx.projectId,
          productionMode: ctx.resolvedEnvironment === "production",
          releaseId: ctx.releaseId,
          tokenProvenance: getRequestTokenProvenance(ctx.requestContext, effectiveToken),
        },
        lookup,
      )
      : await lookup();

    const resolvedCSS = css ?? await getBuiltCSSFallback(cssHash, ctx);

    if (resolvedCSS === undefined) {
      this.logInfo(
        `CSS not found and JIT regeneration failed: ${cssHash}. ` +
          `Server restart or cache expiry. Reload page to regenerate.`,
        {},
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

    // getCSSWithJITFallback returns both cache hits and regenerated output, so
    // this single admission check protects every in-memory response source.
    assertCSSOutputContent(resolvedCSS, "Cached or regenerated CSS output");

    const body = method === "HEAD" ? null : resolvedCSS;

    const response = this.createResponseBuilder(ctx)
      .withCORS(req, ctx.securityConfig?.cors)
      .withCache("immutable")
      .withContentType("text/css; charset=utf-8", body, HTTP_OK);

    return this.respond(response);
  }
}
