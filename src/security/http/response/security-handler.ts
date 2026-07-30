import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { recordSecurityHeaders } from "#veryfront/observability";
import { HOSTED_STUDIO_ORIGINS } from "#veryfront/security/http/studio-origin-policy.ts";
import { isCorsPolicyResponseHeaderName } from "#veryfront/utils/cors-policy-limits.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import type { SecurityConfig } from "./types.ts";

const logger = serverLogger.component("security-headers");
const warnedReservedCorsHeaderConfigs = new WeakSet<object>();

/**
 * Response headers whose values and omissions are owned by the centralized
 * security policy. Server integrations must remove project-provided values
 * before applying policy so development omissions remain authoritative.
 */
export const SECURITY_POLICY_RESPONSE_HEADER_NAMES = Object.freeze(
  [
    "content-security-policy",
    "cross-origin-embedder-policy",
    "cross-origin-opener-policy",
    "cross-origin-resource-policy",
    "referrer-policy",
    "strict-transport-security",
    "x-content-type-options",
    "x-frame-options",
    "x-xss-protection",
  ] as const,
);

const SECURITY_POLICY_RESPONSE_HEADER_NAME_SET: ReadonlySet<string> = new Set(
  SECURITY_POLICY_RESPONSE_HEADER_NAMES,
);

export function isSecurityPolicyResponseHeaderName(name: string): boolean {
  return SECURITY_POLICY_RESPONSE_HEADER_NAME_SET.has(name.toLowerCase());
}

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
 *
 * Only explicit Studio hosts are listed — wildcards like `*.veryfront.com`
 * are intentionally excluded because tenant project domains
 * (`{slug}.preview.veryfront.com`, etc.) live under the same suffix and
 * would otherwise be allowed to iframe each other (tenant-vs-tenant
 * clickjacking). Dev hosts (`veryfront.dev`) are omitted because dev mode
 * skips the default CSP entirely.
 */
const VERYFRONT_FRAME_ANCESTORS = ["'self'", ...HOSTED_STUDIO_ORIGINS];

/**
 * Build the dependency-free core production CSP.
 *
 * - Scripts: same-origin and nonce-authorized scripts only
 * - Styles: same-origin plus inline styles required by framework components.
 *   Do not include a nonce in style directives here: browsers ignore
 *   'unsafe-inline' when a nonce/hash is present, which breaks runtime-created
 *   style attributes and style elements.
 *   - style-src-attr: 'unsafe-inline' for modern browsers with directive-level
 *     style attribute support
 * - Images/fonts: same-origin plus inline data resources
 * - Media: same-origin plus blob URLs used by browser media pipelines
 * - Workers: 'self' + blob: for browser libraries that create blob workers
 * - Connections: same-origin only. Development skips this default, so HMR is
 *   not widened into the production policy.
 * - Objects: 'none' (block Flash/plugins)
 * - Frames: 'self' (allows same-origin iframes; apps embedding external
 *   content must add those origins through an extension or explicit project
 *   `security.csp.frameSrc` configuration)
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
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'unsafe-inline'`,
    `style-src-elem 'self' 'unsafe-inline'`,
    `style-src-attr 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `media-src 'self' blob:`,
    `worker-src 'self' blob:`,
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

  // Disable obsolete browser XSS auditors. Legacy filtering could mutate a
  // safe response into an exploitable one; CSP is the active script policy.
  headers.set("X-XSS-Protection", getHeaderOverride("x-xss-protection") ?? "0");

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
    let ignoredCorsPolicyHeader = false;
    for (const [key, value] of Object.entries(extraHeaders)) {
      if (value === undefined) continue;
      if (isCorsPolicyResponseHeaderName(key)) {
        ignoredCorsPolicyHeader = true;
        continue;
      }
      headers.set(key, value);
    }
    if (
      ignoredCorsPolicyHeader &&
      !warnedReservedCorsHeaderConfigs.has(extraHeaders)
    ) {
      warnedReservedCorsHeaderConfigs.add(extraHeaders);
      logger.warn(
        "Ignored reserved Access-Control-* entries in security.headers; configure security.cors instead",
      );
    }
  }

  recordSecurityHeaders();
}
