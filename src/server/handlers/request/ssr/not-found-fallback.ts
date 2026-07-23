import type { HandlerContext } from "../../types.ts";
import type { ResponseBuilder } from "#veryfront/security/index.ts";
import { join as joinPath } from "#veryfront/compat/path/index.ts";
import { computeContentSourceId } from "#veryfront/cache/keys.ts";
import { resolveProjectReactVersion } from "#veryfront/transforms/esm/package-registry.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { getBaseLogger } from "#veryfront/utils";
import { classifyTelemetryError } from "#veryfront/observability/telemetry-safety.ts";
import { isFallbackDefinitionError } from "./fallback-error-classification.ts";

const logger = getBaseLogger("SERVER").component("not-found-fallback");

export async function tryNotFoundFallback(
  req: Request,
  slug: string,
  ctx: HandlerContext,
  builder: ResponseBuilder,
): Promise<Response | null> {
  const appRoot = joinPath(
    ctx.projectDir,
    ctx.config?.directories?.app ?? "app",
  );

  try {
    const st = await ctx.adapter.fs.stat(appRoot);
    if (!st.isDirectory) return null;
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    return null;
  }

  const searchBase = slug ? joinPath(appRoot, slug) : appRoot;

  const { collectAncestorDirs, tryLoadReservedInDirs } = await import(
    "../../../../rendering/app-reserved.ts"
  );

  const dirs = collectAncestorDirs(searchBase, appRoot);
  const reactVersion = await resolveProjectReactVersion({
    projectDir: ctx.projectDir,
    config: ctx.config,
  });
  const contentSourceId = ctx.enriched?.contentSourceId ??
    computeContentSourceId(
      !!ctx.isLocalProject,
      ctx.resolvedEnvironment ?? ctx.requestContext?.mode ?? "preview",
      ctx.requestContext?.branch ?? null,
      ctx.releaseId,
    );

  let NotFoundComp: Awaited<ReturnType<typeof tryLoadReservedInDirs>>;
  try {
    NotFoundComp = await tryLoadReservedInDirs(
      dirs,
      "notFound",
      ctx.projectDir,
      "production",
      ctx.adapter,
      ctx.projectId,
      contentSourceId,
      reactVersion,
    );
  } catch (error) {
    if (!isFallbackDefinitionError(error)) throw error;
    logger.warn("Custom not-found page could not be loaded", {
      errorCategory: classifyTelemetryError(error),
    });
    return null;
  }

  if (!NotFoundComp) return null;

  const { getProjectReact, getReactDOMServer, renderToStringAdapter } = await import(
    "#veryfront/react/compat/ssr-adapter/index.ts"
  );
  const [React] = await Promise.all([
    getProjectReact(reactVersion),
    getReactDOMServer(reactVersion),
  ]);

  const element = React.createElement(NotFoundComp, {});
  let inner: string;

  try {
    inner = await renderToStringAdapter(element, { reactVersion });
  } catch (error) {
    logger.warn("Custom not-found page render failed", {
      errorCategory: classifyTelemetryError(error),
    });
    inner = "<p>Not Found</p>";
  }

  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>404 Not Found</title></head><body>${inner}</body></html>`;

  return builder
    .withCORS(req, ctx.securityConfig?.cors)
    .withSecurity(ctx.securityConfig ?? undefined, req)
    .withCache("no-cache")
    .html(html, 404);
}
