import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import {
  generateProdHydrationModule,
  getProdHydrationModuleHash,
  getProdHydrationModulePath,
  isVersionedProdHydrationModulePath,
  PROD_HYDRATION_MODULE_PATH,
  PROD_HYDRATION_MODULE_VERSIONED_PATH_PATTERN,
} from "#veryfront/html/hydration-script-builder/prod-scripts.ts";
import { hasMatchingEtag } from "../utils/etag.ts";
import { HTTP_OK, PRIORITY_HIGH_DEV } from "#veryfront/utils/constants/index.ts";

const HTTP_TEMPORARY_REDIRECT = 307;

let cachedModule: { js: string; etag: string } | null = null;

function getProdHydrationModuleBundle(): { js: string; etag: string } {
  if (cachedModule) return cachedModule;

  const js = generateProdHydrationModule();
  cachedModule = {
    js,
    etag: `"${getProdHydrationModuleHash()}"`,
  };
  return cachedModule;
}

export class ProdHydrationModuleHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "ProdHydrationModuleHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [
      { pattern: PROD_HYDRATION_MODULE_PATH, exact: true, method: "GET" },
      { pattern: PROD_HYDRATION_MODULE_PATH, exact: true, method: "HEAD" },
      { pattern: PROD_HYDRATION_MODULE_VERSIONED_PATH_PATTERN, method: "GET" },
      { pattern: PROD_HYDRATION_MODULE_VERSIONED_PATH_PATTERN, method: "HEAD" },
    ],
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return this.continue();
    }

    const method = req.method.toUpperCase();
    const pathname = new URL(req.url).pathname;
    const isVersionedPath = isVersionedProdHydrationModulePath(pathname);
    const builder = this.createResponseBuilder(ctx).withCORS(req, ctx.securityConfig?.cors);

    if (isVersionedPath) {
      const canonicalPath = getProdHydrationModulePath();
      if (pathname !== canonicalPath) {
        // A versioned URL is an immutable content identity. Never publish the
        // current module under a different hash: a CDN could retain those bytes
        // under the wrong key for a year. The current runtime carries the
        // legacy-router compatibility bridge, so redirecting preserves
        // availability while keeping the immutable response correctly keyed.
        return this.respond(
          builder
            .withSecurity(ctx.securityConfig ?? undefined, req)
            .withCache("no-store")
            .withHeaders({ location: canonicalPath })
            .build(null, HTTP_TEMPORARY_REDIRECT),
        );
      }
    }

    const cacheStrategy = isVersionedPath ? "immutable" : "no-cache";
    const { js, etag } = getProdHydrationModuleBundle();

    if (hasMatchingEtag(req, etag)) {
      return this.respond(
        builder
          .withSecurity(ctx.securityConfig ?? undefined, req)
          .withCache(cacheStrategy)
          .notModified(etag),
      );
    }

    return this.respond(
      builder
        .withSecurity(ctx.securityConfig ?? undefined, req)
        .withCache(cacheStrategy)
        .withETag(etag)
        .withContentType(
          "application/javascript; charset=utf-8",
          method === "HEAD" ? null : js,
          HTTP_OK,
        ),
    );
  }
}
