import type { HandlerContext } from "../../types.ts";
import {
  applySecurityHeaders as coreApplySecurityHeaders,
  buildCSP as coreBuildCSP,
  generateNonce,
  getSecurityHeader as coreGetSecurityHeader,
} from "#veryfront/security/http/response/security-handler.ts";

function isDev(ctx: HandlerContext): boolean {
  return !!ctx.isLocalProject;
}

export function buildCSP(ctx: HandlerContext): string {
  return coreBuildCSP(
    isDev(ctx),
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
  coreApplySecurityHeaders(
    headers,
    isDev(ctx),
    generateNonce(),
    ctx.cspUserHeader ?? null,
    ctx.securityConfig,
    ctx.adapter,
    ctx.parsedDomain?.allowIframeEmbed ?? false,
  );
}
