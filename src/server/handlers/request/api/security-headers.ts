/**
 * Security Headers
 *
 * Thin wrapper around core security module for handler context.
 * Delegates to @veryfront/security for actual implementation.
 *
 * @module server/handlers/request/api/security-headers
 */

import type { HandlerContext } from "../../types.ts";
import {
  applySecurityHeaders as coreApplySecurityHeaders,
  buildCSP as coreBuildCSP,
  generateNonce,
  getSecurityHeader as coreGetSecurityHeader,
} from "#veryfront/security/http/response/security-handler.ts";

/**
 * Builds a Content Security Policy string from handler context
 *
 * @param ctx - Handler context containing configuration
 * @returns CSP string
 */
export function buildCSP(ctx: HandlerContext): string {
  const isDev = ctx.requestContext?.isLocalDev ?? false;
  const nonce = generateNonce();
  return coreBuildCSP(isDev, nonce, ctx.cspUserHeader ?? null, ctx.securityConfig, ctx.adapter);
}

/**
 * Gets a security header value from config or environment
 *
 * @param headerName - The header name (e.g., "COOP", "CORP", "COEP")
 * @param defaultValue - Default value if not configured
 * @param ctx - Handler context
 * @returns The header value
 */
export function getSecurityHeader(
  headerName: string,
  defaultValue: string,
  ctx: HandlerContext,
): string {
  return coreGetSecurityHeader(headerName, defaultValue, ctx.securityConfig, ctx.adapter);
}

/**
 * Applies all security headers to a response using handler context
 *
 * @param headers - Headers object to modify
 * @param ctx - Handler context
 */
export function applySecurityHeaders(
  headers: Headers,
  ctx: HandlerContext,
): void {
  const isDev = ctx.requestContext?.isLocalDev ?? false;
  const nonce = generateNonce();
  coreApplySecurityHeaders(
    headers,
    isDev,
    nonce,
    ctx.cspUserHeader ?? null,
    ctx.securityConfig,
    ctx.adapter,
    ctx.parsedDomain?.allowIframeEmbed ?? false,
  );
}
