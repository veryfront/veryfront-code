import type { HandlerContext, HandlerResult } from "../../types.ts";
import { computeEtag, hasMatchingEtag } from "../../utils/etag.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { getRendererForProject } from "../../../shared/renderer-factory.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { serverLogger } from "#veryfront/utils";
import {
  InvalidDataEndpointPathError,
  parseDataEndpointPath,
} from "#veryfront/modules/server/data-endpoint-path.ts";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import { createHandlerDependencyPinningSource } from "#veryfront/server/handlers/utils/dependency-pinning-source.ts";
import {
  applySnapshotResponseHeaders,
  readSnapshotHeader,
  resolveSnapshotForRequest,
  snapshotConflictResponse,
  stripSnapshotHeader,
} from "#veryfront/server/handlers/utils/dependency-snapshot-protocol.ts";
import { resolveSSRControlOutcome } from "#veryfront/rendering/ssr-outcome.ts";

export function handleDataEndpoint(
  req: Request,
  pathname: string,
  ctx: HandlerContext,
  createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
  getErrorMessage: (error: unknown) => string,
): Promise<HandlerResult> {
  const diagnosticPathname = pathname.length <= MAX_PATH_LENGTH_CHARS
    ? pathname
    : `${pathname.slice(0, MAX_PATH_LENGTH_CHARS - 1)}…`;
  return withSpan(
    "module.data.handle",
    async () => {
      try {
        const parsedPath = parseDataEndpointPath(pathname);
        if (!parsedPath.matched) {
          throw new TypeError("Data endpoint handler received an unrelated path");
        }
        const rawSlug = parsedPath.slug;
        const encSlug = rawSlug === "index" ? "" : rawSlug;
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
        const isInvalidRequest = e instanceof InvalidDataEndpointPathError;
        const isNotFound = resolveSSRControlOutcome(e)?.kind === "not-found";
        const status = isInvalidRequest ? 400 : isNotFound ? 404 : 500;

        const logContext = {
          pathname: diagnosticPathname,
          error: errorMessage,
          status,
        };
        if (isInvalidRequest) {
          serverLogger.warn("[data-endpoint] Rejected invalid request", logContext);
        } else {
          serverLogger.error("[data-endpoint] Failed to resolve data", logContext);
        }

        const builder = createResponseBuilder(ctx)
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined, req);
        applySnapshotResponseHeaders(builder.headers);
        return respond(
          builder.json(
            {
              error: isInvalidRequest
                ? "Invalid data request path"
                : isNotFound
                ? "Page not found"
                : "Internal server error",
              status,
            },
            status,
          ),
        );
      }
    },
    {
      "module.data.pathname": diagnosticPathname,
      "module.data.projectSlug": ctx.projectSlug || "unknown",
    },
  );
}
