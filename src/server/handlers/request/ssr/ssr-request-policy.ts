import type { HandlerContext } from "../../types.ts";
import type { SSRRenderOptions } from "../../../services/rendering/ssr.service.ts";
import { shouldUseNoCacheHeadersFromHandler } from "../../../context/enriched-context.ts";

/** Determine whether a request resolves released production content. */
export function isProductionMode(ctx: HandlerContext, _url?: URL): boolean {
  if (ctx.config?.fs?.veryfront?.productionMode === true) return true;
  return (ctx.resolvedEnvironment ?? ctx.requestContext?.mode) === "production";
}

/** Build renderer options while restricting request-controlled Studio overrides. */
export function buildSSRRenderOptions(
  request: Request,
  ctx: HandlerContext,
  url: URL,
  slug: string,
  nonce: string,
): SSRRenderOptions {
  const requestEnvironment = ctx.resolvedEnvironment ?? ctx.requestContext?.mode;
  const allowRenderOverrides = ctx.isLocalProject === true || requestEnvironment === "preview";
  const readOverride = (camelCase: string, snakeCase: string): boolean =>
    allowRenderOverrides &&
    (url.searchParams.get(camelCase) === "1" || url.searchParams.get(snakeCase) === "1");

  return {
    request,
    url,
    slug,
    nonce,
    studioEmbed: allowRenderOverrides && url.searchParams.get("studio_embed") === "true",
    projectId: ctx.projectId ||
      (allowRenderOverrides ? url.searchParams.get("project_id") ?? undefined : undefined) ||
      ctx.projectSlug || undefined,
    pageId: allowRenderOverrides ? url.searchParams.get("page_id") || undefined : undefined,
    noHmr: readOverride("noHmr", "no_hmr"),
    forceProductionScripts: readOverride(
      "forceProductionScripts",
      "force_production_scripts",
    ),
    useNoCache: shouldUseNoCacheHeadersFromHandler(ctx),
  };
}
