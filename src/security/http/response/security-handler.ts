/**
 * Security headers handler (CSP, COOP, CORP, COEP) with nonce-based CSP
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { recordSecurityHeaders } from "#veryfront/observability";
import type { SecurityConfig } from "./types.ts";

/** Generate cryptographic nonce for CSP */
export function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array));
}

/** Build Content Security Policy header with nonce */
export function buildCSP(
  _isDev: boolean,
  nonce: string,
  cspUserHeader: string | null,
  config?: SecurityConfig | null,
  adapter?: RuntimeAdapter,
): string {
  const envCsp = adapter?.env?.get?.("VERYFRONT_CSP");
  if (envCsp?.trim()) return envCsp.replace(/{NONCE}/g, nonce);

  if (cspUserHeader?.trim()) {
    return cspUserHeader.replace(/{NONCE}/g, nonce);
  }

  const cfgCsp = config?.csp;
  if (cfgCsp && typeof cfgCsp === "object") {
    const pieces: string[] = [];

    for (const [k, v] of Object.entries(cfgCsp)) {
      if (v === undefined) continue;

      const key = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      const val = Array.isArray(v) ? v.join(" ") : String(v);
      pieces.push(`${key} ${val}`.replace(/{NONCE}/g, nonce));
    }

    if (pieces.length) return pieces.join("; ");
  }

  // Return empty string - CSP disabled by default
  return "";
}

/** Get security header value from config or environment */
export function getSecurityHeader(
  headerName: string,
  defaultValue: string,
  config?: SecurityConfig | null,
  adapter?: RuntimeAdapter,
): string {
  const configKey = headerName.toLowerCase() as keyof SecurityConfig;
  const configValue = config?.[configKey];
  const envValue = adapter?.env?.get?.(`VERYFRONT_${headerName}`);

  return (typeof configValue === "string" ? configValue : undefined) ?? envValue ?? defaultValue;
}

/** Apply security headers to Headers object with nonce */
export function applySecurityHeaders(
  headers: Headers,
  isDev: boolean,
  nonce: string,
  cspUserHeader: string | null,
  config?: SecurityConfig | null,
  adapter?: RuntimeAdapter,
  isVeryfrontDomain?: boolean,
): void {
  const getHeaderOverride = (name: string): string | undefined => {
    const overrides = config?.headers;
    if (!overrides) return undefined;

    const lower = name.toLowerCase();
    for (const [key, value] of Object.entries(overrides)) {
      if (key.toLowerCase() === lower) return value;
    }

    return undefined;
  };

  headers.set("X-Content-Type-Options", getHeaderOverride("x-content-type-options") ?? "nosniff");

  // X-Frame-Options: Block iframe embedding by default for security
  // Allow embedding on veryfront domains (for Studio) and in development
  // Projects can customize via config.headers["x-frame-options"]
  if (!isDev && !isVeryfrontDomain) {
    headers.set("X-Frame-Options", getHeaderOverride("x-frame-options") ?? "DENY");
  }

  headers.set("X-XSS-Protection", getHeaderOverride("x-xss-protection") ?? "1; mode=block");

  const csp = buildCSP(isDev, nonce, cspUserHeader, config, adapter);
  if (csp) headers.set("Content-Security-Policy", csp);

  // Set HSTS (Strict-Transport-Security) for HTTPS connections
  // Only set in production to enforce HTTPS
  if (!isDev) {
    const hstsMaxAge = config?.hsts?.maxAge ?? 31536000; // 1 year default
    const hstsIncludeSubDomains = config?.hsts?.includeSubDomains ?? true;
    const hstsPreload = config?.hsts?.preload ?? false;

    let hstsValue = `max-age=${hstsMaxAge}`;
    if (hstsIncludeSubDomains) hstsValue += "; includeSubDomains";
    if (hstsPreload) hstsValue += "; preload";

    headers.set(
      "Strict-Transport-Security",
      getHeaderOverride("strict-transport-security") ?? hstsValue,
    );
  }

  // Set COOP, CORP, COEP (skip COOP in dev - browsers ignore it for non-trustworthy origins)
  const coop = isDev ? "" : getSecurityHeader("COOP", "same-origin", config, adapter);
  const corp = getSecurityHeader("CORP", "same-origin", config, adapter);
  const coep = getSecurityHeader("COEP", "", config, adapter);

  if (coop) headers.set("Cross-Origin-Opener-Policy", coop);
  headers.set("Cross-Origin-Resource-Policy", corp);
  if (coep) headers.set("Cross-Origin-Embedder-Policy", coep);

  const extraHeaders = config?.headers;
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      if (value === undefined) continue;
      headers.set(key, value);
    }
  }

  recordSecurityHeaders();
}
