/**
 * Security Headers
 *
 * Handles security-related HTTP headers (CSP, COOP, CORP, COEP).
 */

import type { HandlerContext } from "../../types.ts";

/**
 * Builds a Content Security Policy string
 *
 * @param ctx - Handler context containing configuration
 * @returns CSP string
 *
 * @example
 * ```ts
 * const csp = buildCSP(ctx);
 * // Returns "default-src 'self'; script-src 'self' 'unsafe-inline'; ..."
 * ```
 */
export function buildCSP(ctx: HandlerContext): string {
  const envCsp = ctx.adapter.env.get("VERYFRONT_CSP");
  if (envCsp?.trim()) return envCsp;

  const isDev = ctx.mode === "development";
  // Note: 'self' covers /_vf_modules/ (same-origin module server)
  const DEV_CSP = [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.veryfront.com https://cdn.tailwindcss.com",
    "img-src 'self' data: https://cdn.veryfront.com https://cdnjs.cloudflare.com",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://esm.sh https://cdn.tailwindcss.com",
    "connect-src 'self' ws://localhost:* wss://localhost:*",
    "font-src 'self' data: https://cdnjs.cloudflare.com",
  ].join("; ");

  const PROD_CSP = [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "connect-src 'self'",
  ].join("; ");

  const DEFAULT_CSP = isDev ? DEV_CSP : PROD_CSP;

  if (ctx.cspUserHeader?.trim()) {
    return `${ctx.cspUserHeader}; ${DEFAULT_CSP}`;
  }

  return DEFAULT_CSP;
}

/**
 * Gets a security header value from config or environment
 *
 * @param headerName - The header name (e.g., "COOP", "CORP", "COEP")
 * @param defaultValue - Default value if not configured
 * @param ctx - Handler context
 * @returns The header value
 *
 * @example
 * ```ts
 * const coop = getSecurityHeader("COOP", "same-origin", ctx);
 * ```
 */
export function getSecurityHeader(
  headerName: string,
  defaultValue: string,
  ctx: HandlerContext,
): string {
  const configKey = headerName.toLowerCase();
  const configValue = ctx.securityConfig?.[configKey as keyof typeof ctx.securityConfig];
  return (
    (typeof configValue === "string" ? configValue : undefined) ||
    ctx.adapter.env.get(`VERYFRONT_${headerName}`) ||
    defaultValue
  );
}

/**
 * Applies all security headers to a response
 *
 * Includes:
 * - X-Content-Type-Options
 * - Content-Security-Policy
 * - Cross-Origin-Opener-Policy (COOP)
 * - Cross-Origin-Resource-Policy (CORP)
 * - Cross-Origin-Embedder-Policy (COEP)
 *
 * @param headers - Headers object to modify
 * @param ctx - Handler context
 *
 * @example
 * ```ts
 * const headers = new Headers();
 * applySecurityHeaders(headers, ctx);
 * ```
 */
export function applySecurityHeaders(
  headers: Headers,
  ctx: HandlerContext,
): void {
  headers.set("x-content-type-options", "nosniff");

  // Build CSP
  const csp = buildCSP(ctx);
  headers.set("content-security-policy", csp);

  // COOP, CORP, COEP
  const coop = getSecurityHeader("COOP", "same-origin", ctx);
  const corp = getSecurityHeader("CORP", "same-origin", ctx);
  const coep = getSecurityHeader("COEP", "", ctx);

  headers.set("cross-origin-opener-policy", coop);
  headers.set("cross-origin-resource-policy", corp);
  if (coep) {
    headers.set("cross-origin-embedder-policy", coep);
  }
}
