import type { HandlerContext, HandlerResult } from "../../types.ts";
import { computeEtag, hasMatchingEtag } from "../../utils/etag.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { getRendererForProject } from "../../../shared/renderer-factory.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { serverLogger } from "#veryfront/utils";
import {
  resolveRequestedDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { createHandlerDependencyPinningSource } from "#veryfront/server/handlers/utils/dependency-pinning-source.ts";
import { resolveSSRControlOutcome } from "#veryfront/rendering/ssr-outcome.ts";

const DEPENDENCY_PINNING_HEADER = "x-veryfront-dependency-pins";

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
        const rawSlug = pathname.replace("/_veryfront/data/", "").replace(/\.json$/, "");
        const encSlug = rawSlug === "index" ? "" : rawSlug;
        const requestUrl = new URL(req.url);
        const requestedPinKey = req.headers.get(DEPENDENCY_PINNING_HEADER);
        const dependencySource = createHandlerDependencyPinningSource(ctx);
        const dependencySnapshot = requestedPinKey !== null &&
            !requestedPinKey.startsWith("on:")
          ? undefined
          : await resolveRequestedDependencyPinningSnapshot(
            dependencySource,
            requestedPinKey,
          );

        const isMissingEnabledSnapshot = requestedPinKey === null &&
          dependencySnapshot?.cacheKey.startsWith("on:");
        if (!dependencySnapshot || isMissingEnabledSnapshot) {
          const builder = createResponseBuilder(ctx)
            .withCORS(req, ctx.securityConfig?.cors)
            .withSecurity(ctx.securityConfig ?? undefined, req)
            .withCache("no-store");
          withDependencyPinningVary(builder);
          return respond(
            builder.json({ error: "Unknown dependency snapshot", status: 409 }, 409),
          );
        }

        // The transport token must participate in framework caches without
        // leaking into application-visible request/query state.
        const applicationUrl = new URL(requestUrl);
        applicationUrl.pathname = encSlug ? `/${encSlug}` : "/";
        const applicationHeaders = new Headers(req.headers);
        applicationHeaders.delete(DEPENDENCY_PINNING_HEADER);
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
        withDependencyPinningVary(builder);
        if (dependencySnapshot.cacheKey.startsWith("on:")) {
          builder.withHeaders({
            [DEPENDENCY_PINNING_HEADER]: dependencySnapshot.cacheKey,
          });
        }

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
        withDependencyPinningVary(builder);
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

function withDependencyPinningVary(builder: ResponseBuilder): void {
  const existing = builder.headers.get("vary");
  const values = existing?.split(",").map((value) => value.trim().toLowerCase()) ?? [];
  if (values.includes(DEPENDENCY_PINNING_HEADER)) return;
  builder.withHeaders({
    vary: existing ? `${existing}, ${DEPENDENCY_PINNING_HEADER}` : DEPENDENCY_PINNING_HEADER,
  });
}
