import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { recordSecurityHeaders } from "#veryfront/observability";
import type { SecurityConfig } from "./types.ts";

export function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array));
}

export function buildCSP(
  _isDev: boolean,
  nonce: string,
  cspUserHeader: string | null,
  config?: SecurityConfig | null,
  adapter?: RuntimeAdapter,
): string {
  const envCsp = adapter?.env?.get?.("VERYFRONT_CSP");
  if (envCsp?.trim()) return envCsp.replace(/{NONCE}/g, nonce);

  if (cspUserHeader?.trim()) return cspUserHeader.replace(/{NONCE}/g, nonce);

  const cfgCsp = config?.csp;
  if (!cfgCsp || typeof cfgCsp !== "object") return "";

  const pieces: string[] = [];

  for (const [k, v] of Object.entries(cfgCsp)) {
    if (v === undefined) continue;

    const key = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    const val = Array.isArray(v) ? v.join(" ") : String(v);
    pieces.push(`${key} ${val}`.replace(/{NONCE}/g, nonce));
  }

  return pieces.length ? pieces.join("; ") : "";
}

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

  if (!isDev && !isVeryfrontDomain) {
    headers.set("X-Frame-Options", getHeaderOverride("x-frame-options") ?? "DENY");
  }

  headers.set("X-XSS-Protection", getHeaderOverride("x-xss-protection") ?? "1; mode=block");

  const csp = buildCSP(isDev, nonce, cspUserHeader, config, adapter);
  if (csp) headers.set("Content-Security-Policy", csp);

  if (!isDev) {
    const hstsMaxAge = config?.hsts?.maxAge ?? 31536000;
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

  const coop = isDev ? "" : getSecurityHeader("COOP", "same-origin", config, adapter);
  const corp = getSecurityHeader("CORP", "same-origin", config, adapter);
  const coep = getSecurityHeader("COEP", "", config, adapter);

  if (coop) headers.set("Cross-Origin-Opener-Policy", coop);
  headers.set("Cross-Origin-Resource-Policy", corp);
  if (coep) headers.set("Cross-Origin-Embedder-Policy", coep);

  headers.set(
    "Referrer-Policy",
    getHeaderOverride("referrer-policy") ?? "strict-origin-when-cross-origin",
  );

  const extraHeaders = config?.headers;
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      if (value === undefined) continue;
      headers.set(key, value);
    }
  }

  recordSecurityHeaders();
}
