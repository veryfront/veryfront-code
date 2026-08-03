import type { HandlerContext } from "../types.ts";

/** Resolve whether a request is serving released production content. */
export function isProductionMode(ctx: HandlerContext): boolean {
  if (ctx.config?.fs?.veryfront?.productionMode === true) return true;
  return (ctx.resolvedEnvironment ?? ctx.requestContext?.mode) === "production";
}

/** Keep dot-prefixed route segments out of released rendering surfaces. */
export function shouldHideRouteInProduction(
  ctx: HandlerContext,
  slug: string,
): boolean {
  return isProductionMode(ctx) &&
    slug.split("/").some((segment) => segment.startsWith("."));
}
