import type { HandlerContext, HandlerResult } from "../../types.ts";
import { computeEtag, hasMatchingEtag } from "../../utils/etag.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { getRendererForProject } from "../../../shared/renderer-factory.ts";
import { shouldUseNoCacheHeadersFromHandler } from "../../../context/enriched-context.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { serverLogger } from "#veryfront/utils";
import { VeryfrontError } from "#veryfront/errors";
import { resolveRequestedDependencyPinningSnapshot } from "#veryfront/transforms/esm/package-registry.ts";
import { createHandlerDependencyPinningSource } from "#veryfront/server/handlers/utils/dependency-pinning-source.ts";

const DEPENDENCY_PIN_PATTERN = /^on:[A-Za-z0-9._-]+$/;

function isPageModuleNotFound(error: unknown): boolean {
  return error instanceof VeryfrontError &&
    (error.status === 404 || error.slug === "file-not-found" || error.slug === "page-not-found");
}

export function handlePageModule(
  req: Request,
  pathname: string,
  ctx: HandlerContext,
  createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
  getErrorMessage: (error: unknown) => string,
): Promise<HandlerResult> {
  return withSpan(
    "module.page.handle",
    async () => {
      try {
        const slugPath = pathname
          .replace("/_veryfront/pages/", "")
          .replace(/\.js$/, "")
          .replace(/\/$/, "");
        const slug = slugPath || "index";

        const requestUrl = new URL(req.url);
        const requestedPinKeys = requestUrl.searchParams.getAll("pins");
        const requestedPinKey = requestedPinKeys[0];
        if (
          requestedPinKeys.length > 1 ||
          (requestedPinKey !== undefined &&
            !DEPENDENCY_PIN_PATTERN.test(requestedPinKey))
        ) {
          return respondDependencyConflict(req, ctx, createResponseBuilder, respond);
        }

        const dependencyPinningSource = createHandlerDependencyPinningSource(ctx);
        const dependencySnapshot = await resolveRequestedDependencyPinningSnapshot(
          dependencyPinningSource,
          requestedPinKey,
        );
        if (
          !dependencySnapshot ||
          (requestedPinKey === undefined &&
            dependencySnapshot.cacheKey.startsWith("on:"))
        ) {
          return respondDependencyConflict(req, ctx, createResponseBuilder, respond);
        }

        const applicationUrl = new URL(requestUrl);
        if (requestedPinKey !== undefined) applicationUrl.searchParams.delete("pins");
        const renderer = await getRendererForProject(ctx);
        const { pageModule } = await renderer.renderPage(slug, {
          params: undefined,
          props: undefined,
          url: applicationUrl,
          dependencyPinningCacheKey: dependencySnapshot.cacheKey,
          dependencyPinningDependencies: dependencySnapshot.dependencies,
          dependencyPinningSource,
        });

        const code = pageModule?.code;
        if (!code) {
          return respond(
            ResponseBuilder.error(404, "Module not found", req, {
              securityConfig: ctx.securityConfig,
              corsConfig: ctx.securityConfig?.cors,
            }),
          );
        }

        const etag = computeEtag(code);
        const builder = createResponseBuilder(ctx)
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined, req);

        if (hasMatchingEtag(req, etag)) {
          return respond(builder.notModified(etag));
        }

        const cacheMode = shouldUseNoCacheHeadersFromHandler(ctx) ? "no-cache" : "short";

        return respond(
          builder.withCache(cacheMode).withETag(etag).javascript(code, 200),
        );
      } catch (error) {
        if (isPageModuleNotFound(error)) {
          return respond(
            ResponseBuilder.error(404, "Module not found", req, {
              securityConfig: ctx.securityConfig,
              corsConfig: ctx.securityConfig?.cors,
            }),
          );
        }

        // Log the full error server-side but return a generic message
        // to avoid leaking internal details (Babel/TS errors, file paths, etc.)
        serverLogger.error("[page-module] Failed to generate module", {
          pathname,
          error: getErrorMessage(error),
        });

        return respond(
          ResponseBuilder.error(
            500,
            "Failed to generate module",
            req,
            {
              securityConfig: ctx.securityConfig,
              corsConfig: ctx.securityConfig?.cors,
            },
          ),
        );
      }
    },
    {
      "module.page.pathname": pathname,
      "module.page.projectSlug": ctx.projectSlug || "unknown",
    },
  );
}

function respondDependencyConflict(
  req: Request,
  ctx: HandlerContext,
  createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
): HandlerResult {
  return respond(
    createResponseBuilder(ctx)
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined, req)
      .withCache("no-store")
      .text("Unknown dependency snapshot", 409),
  );
}
