import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import {
  generateProdHydrationModule,
  isVersionedProdHydrationModulePath,
  PROD_HYDRATION_MODULE_PATH,
  PROD_HYDRATION_MODULE_VERSIONED_PATH_PATTERN,
} from "#veryfront/html/hydration-script-builder/prod-scripts.ts";
import { computeStrongEtag, hasMatchingEtag } from "../utils/etag.ts";
import { HTTP_OK, PRIORITY_HIGH_DEV } from "#veryfront/utils/constants/index.ts";

let cachedModule: { js: string; etag: string } | null = null;

function getProdHydrationModuleBundle(): { js: string; etag: string } {
  if (cachedModule) return cachedModule;

  const js = generateProdHydrationModule();
  cachedModule = {
    js,
    etag: computeStrongEtag(js),
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
    const cacheStrategy = isVersionedProdHydrationModulePath(pathname) ? "immutable" : "no-cache";
    const { js, etag } = getProdHydrationModuleBundle();
    const builder = this.createResponseBuilder(ctx).withCORS(req, ctx.securityConfig?.cors);

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
