import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import {
  generateProdHydrationModule,
  getProdHydrationModulePath,
  isVersionedProdHydrationModulePath,
  PROD_HYDRATION_MODULE_PATH,
  PROD_HYDRATION_MODULE_VERSIONED_PATH_PATTERN,
} from "#veryfront/html/hydration-script-builder/prod-scripts.ts";
import { hasImmutableReleaseHydrationRuntime } from "#veryfront/html/hydration-script-builder/prod-runtime-selection.ts";
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

    const pathname = new URL(req.url).pathname;
    const isVersioned = isVersionedProdHydrationModulePath(pathname);

    // Legacy releases have no content-addressed runtime. Their HTML selects the
    // release-baked legacy file, so StaticHandler must serve that file rather
    // than this process's generated runtime.
    if (
      pathname === PROD_HYDRATION_MODULE_PATH &&
      hasImmutableReleaseHydrationRuntime(ctx.releaseId)
    ) {
      return this.continue();
    }

    // Serve only the current content address dynamically. Non-current hashes
    // may name valid release-baked assets, so StaticHandler owns their lookup
    // and returns the final non-cacheable 404 when no stored asset matches.
    if (isVersioned && pathname !== getProdHydrationModulePath()) {
      return this.continue();
    }

    const method = req.method.toUpperCase();
    const cacheStrategy = isVersioned ? "immutable" : "no-cache";
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
