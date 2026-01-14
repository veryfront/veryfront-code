/**
 * Security headers handler (CSP, COOP, CORP, COEP) with nonce-based CSP
 */

import type { SecurityConfig } from "./types.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { recordSecurityHeaders } from "@veryfront/observability";

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

  // CSP disabled by default - users can enable via config or env var
  // Projects often use various CDNs, analytics, etc. that would be blocked
  // To enable CSP, set VERYFRONT_CSP env var or use security.csp in config
  //
  // Development mode has relaxed CSP for HMR and dev tools (if CSP is forced)
  // Production mode uses nonce-based CSP (if CSP is forced via env/config)
  const defaultCsp = "";

  // User-provided CSP from config header takes precedence
  if (cspUserHeader?.trim()) {
    return cspUserHeader.replace(/{NONCE}/g, nonce);
  }

  // If config has CSP directives, use them
  const cfgCsp = config?.csp;
  if (cfgCsp && typeof cfgCsp === "object") {
    const pieces: string[] = [];
    for (const [k, v] of Object.entries(cfgCsp)) {
      if (v === undefined) continue;
      const key = String(k).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      const val = Array.isArray(v) ? v.join(" ") : String(v);
      pieces.push(`${key} ${val}`.replace(/{NONCE}/g, nonce));
    }
    if (pieces.length > 0) {
      return pieces.join("; ");
    }
  }

  // Return empty string - CSP disabled by default
  return defaultCsp;
}

/** Get security header value from config or environment */
export function getSecurityHeader(
  headerName: string,
  defaultValue: string,
  config?: SecurityConfig | null,
  adapter?: RuntimeAdapter,
): string {
  const configKey = headerName.toLowerCase();
  const configValue = config?.[configKey as keyof SecurityConfig];
  const envValue = adapter?.env?.get?.(`VERYFRONT_${headerName}`);
  return (typeof configValue === "string" ? configValue : undefined) || envValue || defaultValue;
}

/** Apply security headers to Headers object with nonce */
export function applySecurityHeaders(
  headers: Headers,
  isDev: boolean,
  nonce: string,
  cspUserHeader: string | null,
  config?: SecurityConfig | null,
  adapter?: RuntimeAdapter,
  studioEmbed?: boolean,
): void {
  const getHeaderOverride = (name: string): string | undefined => {
    const overrides = config?.headers;
    if (!overrides) return undefined;
    const lower = name.toLowerCase();
    for (const [key, value] of Object.entries(overrides)) {
      if (key.toLowerCase() === lower) {
        return value;
      }
    }
    return undefined;
  };

  // Always set basic security headers
  const contentTypeOptions = getHeaderOverride("x-content-type-options") ?? "nosniff";
  headers.set("X-Content-Type-Options", contentTypeOptions);

  // X-Frame-Options: Block iframe embedding by default for security
  // Skip when studio_embed=true to allow embedding (e.g., in Veryfront Studio)
  // Projects can customize via config.headers["x-frame-options"]
  if (!isDev && !studioEmbed) {
    const frameOptions = getHeaderOverride("x-frame-options") ?? "DENY";
    headers.set("X-Frame-Options", frameOptions);
  }

  const xssProtection = getHeaderOverride("x-xss-protection") ?? "1; mode=block";
  headers.set("X-XSS-Protection", xssProtection);

  // Build and set CSP with nonce
  const csp = buildCSP(isDev, nonce, cspUserHeader, config, adapter);
  if (csp) {
    headers.set("Content-Security-Policy", csp);
  }

  // Set HSTS (Strict-Transport-Security) for HTTPS connections
  // Only set in production to enforce HTTPS
  if (!isDev) {
    const hstsMaxAge = config?.hsts?.maxAge ?? 31536000; // 1 year default
    const hstsIncludeSubDomains = config?.hsts?.includeSubDomains ?? true;
    const hstsPreload = config?.hsts?.preload ?? false;

    let hstsValue = `max-age=${hstsMaxAge}`;
    if (hstsIncludeSubDomains) {
      hstsValue += "; includeSubDomains";
    }
    if (hstsPreload) {
      hstsValue += "; preload";
    }

    const hstsOverride = getHeaderOverride("strict-transport-security");
    headers.set("Strict-Transport-Security", hstsOverride ?? hstsValue);
  }

  // Set COOP, CORP, COEP
  const coop = getSecurityHeader("COOP", "same-origin", config, adapter);
  const corp = getSecurityHeader("CORP", "same-origin", config, adapter);
  const coep = getSecurityHeader("COEP", "", config, adapter);

  headers.set("Cross-Origin-Opener-Policy", coop);
  headers.set("Cross-Origin-Resource-Policy", corp);
  if (coep) {
    headers.set("Cross-Origin-Embedder-Policy", coep);
  }

  if (config?.headers) {
    for (const [key, value] of Object.entries(config.headers)) {
      if (value === undefined) continue;
      headers.set(key, value);
    }
  }

  // Record metrics for security headers application
  recordSecurityHeaders();
}
