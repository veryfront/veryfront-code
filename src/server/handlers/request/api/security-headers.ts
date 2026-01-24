import type { HandlerContext } from "../../types.ts";
import {
  applySecurityHeaders as coreApplySecurityHeaders,
  buildCSP as coreBuildCSP,
  generateNonce,
  getSecurityHeader as coreGetSecurityHeader,
} from "#veryfront/security/http/response/security-handler.ts";

export function buildCSP(ctx: HandlerContext): string {
  const isDev = ctx.requestContext?.isLocalDev ?? false;
  return coreBuildCSP(
    isDev,
    generateNonce(),
    ctx.cspUserHeader ?? null,
    ctx.securityConfig,
    ctx.adapter,
  );
}

export function getSecurityHeader(
  headerName: string,
  defaultValue: string,
  ctx: HandlerContext,
): string {
  return coreGetSecurityHeader(headerName, defaultValue, ctx.securityConfig, ctx.adapter);
}

export function applySecurityHeaders(headers: Headers, ctx: HandlerContext): void {
  const isDev = ctx.requestContext?.isLocalDev ?? false;

  coreApplySecurityHeaders(
    headers,
    isDev,
    generateNonce(),
    ctx.cspUserHeader ?? null,
    ctx.securityConfig,
    ctx.adapter,
    ctx.parsedDomain?.allowIframeEmbed ?? false,
  );
}
