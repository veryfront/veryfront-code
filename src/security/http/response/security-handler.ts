import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { recordSecurityHeaders } from "#veryfront/observability";
import type { SecurityConfig } from "./types.ts";

/** HSTS max-age default: 1 year in seconds */
const HSTS_MAX_AGE_SECONDS = 31_536_000;

/** Number of random bytes used to generate CSP nonces */
const NONCE_BYTE_LENGTH = 16;

export function generateNonce(): string {
  const array = new Uint8Array(NONCE_BYTE_LENGTH);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array));
}

/**
 * Studio origins permitted to embed veryfront-hosted apps. Used to derive a
 * `frame-ancestors` allowlist for pages served from veryfront-managed
 * domains so the Studio preview iframe still works while non-Studio
 * embedders are blocked.
 */
const VERYFRONT_FRAME_ANCESTORS = [
  "'self'",
  "https://veryfront.com",
  "https://*.veryfront.com",
  "https://veryfront.org",
  "https://*.veryfront.org",
  "https://veryfront.dev",
  "https://*.veryfront.dev",
];

/**
 * Build a default CSP that works for typical veryfront apps.
 *
 * - Scripts: nonce-based + cdn.jsdelivr.net + esm.sh (Scalar API docs,
 *   html2canvas, legacy/browser ESM hydration)
 * - Styles:
 *   - style-src: 'self' + 'unsafe-inline' + Google Fonts + cdn.veryfront.com
 *     so React style="" attributes and framework inline styles remain
 *     compatible. Do not include a nonce in style-src here: browsers ignore
 *     'unsafe-inline' when a nonce/hash is present on the directive, which
 *     breaks React style attributes.
 *   - style-src-elem: nonce-based + Google Fonts + cdn.veryfront.com for
 *     inline <style> tags and stylesheet elements
 *   - style-src-attr: 'unsafe-inline' for modern browsers with directive-level
 *     style attribute support
 * - Images/media/fonts: 'self' + data: + https: + cdn.veryfront.com
 * - Connections: 'self' + wss: + https: (WebSocket for HMR/live reload, API calls)
 * - Objects: 'none' (block Flash/plugins)
 * - Frames: 'self' (allows same-origin iframes; apps embedding external
 *   content like YouTube or OAuth popups should add those origins via
 *   security.csp.frameSrc in veryfront.config.ts)
 * - Frame-ancestors: `'none'` for customer apps, or a Studio allowlist for
 *   veryfront-managed deployments. Supersedes X-Frame-Options in modern
 *   browsers and provides clickjacking protection even when X-Frame-Options
 *   can't be expressive enough (e.g. when Studio embedding is required).
 * - Base-uri/form-action: 'self' (prevent base tag hijack and form redirect)
 */
function buildDefaultCSP(nonce: string, isVeryfrontDomain: boolean): string {
  const frameAncestors = isVeryfrontDomain
    ? `frame-ancestors ${VERYFRONT_FRAME_ANCESTORS.join(" ")}`
    : `frame-ancestors 'none'`;

  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net https://esm.sh`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.veryfront.com`,
    `style-src-elem 'self' 'nonce-${nonce}' https://fonts.googleapis.com https://cdn.veryfront.com`,
    `style-src-attr 'unsafe-inline'`,
    `img-src 'self' data: https:`,
    `font-src 'self' data: https://fonts.gstatic.com https://cdn.veryfront.com`,
    `connect-src 'self' wss: https:`,
    `media-src 'self' https:`,
    `object-src 'none'`,
    `frame-src 'self'`,
    frameAncestors,
    `base-uri 'self'`,
    `form-action 'self'`,
  ].join("; ");
}

export function serializeCSPDirectives(
  csp: SecurityConfig["csp"],
  nonce?: string,
): string | null {
  if (!csp || typeof csp !== "object") return null;

  const pieces: string[] = [];

  for (const [key, value] of Object.entries(csp)) {
    if (value === undefined) continue;

    const directive = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
    const sources = Array.isArray(value) ? value.join(" ") : String(value);
    const serialized = `${directive} ${sources}`;
    pieces.push(nonce ? serialized.replace(/{NONCE}/g, nonce) : serialized);
  }

  return pieces.length ? pieces.join("; ") : null;
}

export function buildCSP(
  isDev: boolean,
  nonce: string,
  cspUserHeader: string | null,
  config?: SecurityConfig | null,
  adapter?: RuntimeAdapter,
  isVeryfrontDomain?: boolean,
): string {
  const envCsp = adapter?.env?.get?.("VERYFRONT_CSP");
  if (envCsp?.trim()) return envCsp.replace(/{NONCE}/g, nonce);

  if (cspUserHeader?.trim()) return cspUserHeader.replace(/{NONCE}/g, nonce);

  const cfgCsp = config?.csp;
  const serializedConfigCsp = serializeCSPDirectives(cfgCsp, nonce);
  if (serializedConfigCsp) return serializedConfigCsp;

  // No explicit CSP configured — apply a secure default in production.
  // Dev mode skips the default to avoid blocking HMR and dev tooling.
  if (!isDev) {
    return buildDefaultCSP(nonce, isVeryfrontDomain ?? false);
  }

  return "";
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

  // X-Frame-Options is the legacy clickjacking control. Modern browsers
  // honor `frame-ancestors` from CSP (set below) instead, so this is mainly
  // a fallback for older browsers. Always emit DENY in production — when
  // Studio embedding is required, the CSP `frame-ancestors` allowlist
  // (set in buildDefaultCSP for isVeryfrontDomain) takes precedence in
  // modern browsers and grants the necessary exception. Legacy browsers
  // would block Studio embedding, which is acceptable since they don't
  // support modern Studio features.
  if (!isDev) {
    headers.set("X-Frame-Options", getHeaderOverride("x-frame-options") ?? "DENY");
  }

  headers.set("X-XSS-Protection", getHeaderOverride("x-xss-protection") ?? "1; mode=block");

  const csp = buildCSP(isDev, nonce, cspUserHeader, config, adapter, isVeryfrontDomain);
  if (csp) headers.set("Content-Security-Policy", csp);

  if (!isDev) {
    const hstsMaxAge = config?.hsts?.maxAge ?? HSTS_MAX_AGE_SECONDS;
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
