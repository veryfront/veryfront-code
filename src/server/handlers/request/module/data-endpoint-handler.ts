import type { HandlerContext, HandlerResult } from "../../types.ts";
import { computeEtag, hasMatchingEtag } from "../../utils/etag.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { getRendererForProject } from "../../../shared/renderer-factory.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { serverLogger } from "#veryfront/utils";
import { createHandlerDependencyPinningSource } from "#veryfront/server/handlers/utils/dependency-pinning-source.ts";
import {
  applySnapshotResponseHeaders,
  readSnapshotHeader,
  resolveSnapshotForRequest,
  snapshotConflictResponse,
  stripSnapshotHeader,
} from "#veryfront/server/handlers/utils/dependency-snapshot-protocol.ts";
import { resolveSSRControlOutcome } from "#veryfront/rendering/ssr-outcome.ts";
import { shouldHideRouteInProduction } from "../route-visibility-policy.ts";

const DATA_ENDPOINT_PREFIX = "/_veryfront/data/";

export function handleDataEndpoint(
  req: Request,
  pathname: string,
  ctx: HandlerContext,
  createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
  getErrorMessage: (error: unknown) => string,
): Promise<HandlerResult> {
  return withSpan(
    "module.data.handle",
    async () => {
      try {
        // Anchored at the prefix rather than replacing its first occurrence,
        // so a slug that repeats the namespace keeps its own path.
        const rawSlug = pathname.slice(DATA_ENDPOINT_PREFIX.length).replace(/\.json$/, "");
        const encSlug = rawSlug === "index" ? "" : rawSlug;

        // Mirrors the dot-segment rejection the SSR handler applies before
        // rendering the same slug; this endpoint reaches renderPage too.
        if (shouldHideRouteInProduction(ctx, encSlug)) {
          serverLogger.warn("[data-endpoint] Dot path blocked in production", { pathname });
          const builder = createResponseBuilder(ctx)
            .withCORS(req, ctx.securityConfig?.cors)
            .withSecurity(ctx.securityConfig ?? undefined, req);
          applySnapshotResponseHeaders(builder.headers);
          return respond(builder.json({ error: "Page not found", status: 404 }, 404));
        }
        const requestUrl = new URL(req.url);
        const dependencySource = createHandlerDependencyPinningSource(ctx);
        const resolution = await resolveSnapshotForRequest(
          dependencySource,
          readSnapshotHeader(req.headers),
        );
        if (resolution.kind === "conflict") {
          return respond(
            snapshotConflictResponse(createResponseBuilder(ctx), req, ctx.securityConfig),
          );
        }
        const dependencySnapshot = resolution.snapshot;

        // The transport token must participate in framework caches without
        // leaking into application-visible request/query state.
        const applicationUrl = new URL(requestUrl);
        applicationUrl.pathname = encSlug ? `/${encSlug}` : "/";
        const applicationHeaders = stripSnapshotHeader(req.headers);
        const applicationRequest = new Request(applicationUrl, {
          method: req.method,
          headers: applicationHeaders,
          signal: req.signal,
        });

        const renderer = await getRendererForProject(ctx);
        const result = await renderer.renderPage(encSlug, {
          request: applicationRequest,
          url: applicationUrl,
          dependencyPinningCacheKey: dependencySnapshot.cacheKey,
          dependencyPinningDependencies: dependencySnapshot.dependencies,
          dependencyPinningSource: dependencySource,
        });

        const data = {
          slug: encSlug,
          frontmatter: result.frontmatter,
          headings: result.headings,
          html: result.html,
          ...(dependencySnapshot.cacheKey === "off"
            ? {}
            : { dependencyPinningCacheKey: dependencySnapshot.cacheKey }),
        };

        const body = JSON.stringify(data);
        const etag = computeEtag(body);

        const builder = createResponseBuilder(ctx).withCORS(req, ctx.securityConfig?.cors);
        applySnapshotResponseHeaders(builder.headers, dependencySnapshot.cacheKey);

        if (hasMatchingEtag(req, etag)) {
          return respond(builder.notModified(etag));
        }

        return respond(
          builder
            .withSecurity(ctx.securityConfig ?? undefined, req)
            .withCache("no-cache")
            .withETag(etag)
            .json(data, 200),
        );
      } catch (e) {
        const errorMessage = getErrorMessage(e);
        const isNotFound = resolveSSRControlOutcome(e)?.kind === "not-found";
        const status = isNotFound ? 404 : 500;

        serverLogger.error("[data-endpoint] Failed to resolve data", {
          pathname,
          error: errorMessage,
          status,
        });

        const builder = createResponseBuilder(ctx)
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined, req);
        applySnapshotResponseHeaders(builder.headers);
        return respond(
          builder.json(
            { error: isNotFound ? "Page not found" : "Internal server error", status },
            status,
          ),
        );
      }
    },
    {
      "module.data.pathname": pathname,
      "module.data.projectSlug": ctx.projectSlug || "unknown",
    },
  );
}
