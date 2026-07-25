import type { HandlerContext } from "../types.ts";
import { ResponseBuilder } from "#veryfront/security";
import { HTTP_UNAVAILABLE } from "#veryfront/utils/constants/index.ts";
import { isExplicitlyLocalProject } from "#veryfront/security/project-locality.ts";

export const OPENAPI_UNAVAILABLE_MESSAGE = "OpenAPI specification unavailable";

export function snapshotOpenAPIRequestLocality(ctx: HandlerContext): boolean {
  return isExplicitlyLocalProject(ctx);
}

export function createOpenAPIResponseBuilder(
  ctx: HandlerContext,
  isLocalProject: boolean,
): ResponseBuilder {
  return new ResponseBuilder({
    securityConfig: ctx.securityConfig ?? undefined,
    isDev: isLocalProject,
    cspUserHeader: ctx.cspUserHeader,
    adapter: ctx.adapter,
    isVeryfrontDomain: ctx.parsedDomain?.allowIframeEmbed ?? false,
  });
}

export function createOpenAPIUnavailableResponse(
  req: Request,
  ctx: HandlerContext,
): Response {
  return createOpenAPIResponseBuilder(ctx, false)
    .withCache("no-store")
    .withCORS(req, ctx.securityConfig?.cors)
    .withSecurity(ctx.securityConfig ?? undefined, req)
    .text(OPENAPI_UNAVAILABLE_MESSAGE, HTTP_UNAVAILABLE);
}
