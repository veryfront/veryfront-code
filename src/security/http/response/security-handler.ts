import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { recordSecurityHeaders } from "#veryfront/observability";
import { HOSTED_STUDIO_ORIGINS } from "#veryfront/security/http/studio-origin-policy.ts";
import { isCorsPolicyResponseHeaderName } from "#veryfront/utils/cors-policy-limits.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import {
  PLATFORM_IMAGE_ORIGINS,
  PLATFORM_SCRIPT_ORIGINS,
} from "#veryfront/security/http/platform-asset-origins.ts";
import { toCspDirectiveName } from "#veryfront/security/http/csp-directives.ts";
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
 * The structural half of the platform floor: sources a project can never drop.
 *
 * Every entry is here because the renderer writes that URL into the documents
 * it serves — the ESM CDN for React imports, the platform image origins for
 * optimized image URLs. A project that removed them would break only its own
 * site, which is exactly what happened when the policy was `'self'`-only while
 * the renderer emitted `esm.sh` and no hosted page hydrated.
 *
 * The rule this encodes: the floor contains what the platform emits, never a
 * guess at what a project needs. Project-specific origins (fonts, analytics,
 * embeds) belong in `security.csp`, which is merged on top.
 *
 * Notes on individual directives:
 * - script-src carries the nonce. Style directives must not: browsers ignore
 *   'unsafe-inline' when a nonce or hash is present, which would break the
 *   runtime-created styles framework components rely on.
 * - `style-src-elem` is deliberately absent. It would duplicate `style-src`
 *   exactly, and because it takes precedence for `<link>` elements its only
 *   live effect was to make a project's `styleSrc` addition silently fail to
 *   admit a stylesheet.
 * - connect-src includes the script origins so browsers may fetch the source
 *   maps the CDN's own modules reference. The CDN is already trusted for code
 *   execution via script-src, so this grants strictly less than it already has.
 * - frame-ancestors is `'none'` for customer apps, or a Studio allowlist for
 *   veryfront-managed domains so the Studio preview iframe works. It supersedes
 *   X-Frame-Options in modern browsers.
 * - object-src 'none' blocks plugins; base-uri and form-action prevent base tag
 *   hijack and form redirection.
 */
function requiredDirectives(
  nonce: string,
  isVeryfrontDomain: boolean,
): Record<string, string[]> {
  return {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, ...PLATFORM_SCRIPT_ORIGINS],
    "style-src": ["'self'"],
    "style-src-attr": [],
    "img-src": ["'self'", ...PLATFORM_IMAGE_ORIGINS],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...PLATFORM_SCRIPT_ORIGINS],
    "media-src": ["'self'"],
    "worker-src": ["'self'"],
    "object-src": ["'none'"],
    "frame-src": ["'self'"],
    "frame-ancestors": isVeryfrontDomain ? [...VERYFRONT_FRAME_ANCESTORS] : ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };
}

/**
 * Convenience sources a project may drop with `null` when it knows it does not
 * need them. Nothing here is structural, so removing any of it can only affect
 * the project's own content — never the platform's.
 */
const BASELINE_DIRECTIVES: ReadonlyMap<string, readonly string[]> = new Map([
  ["style-src", ["'unsafe-inline'"]],
  ["style-src-attr", ["'unsafe-inline'"]],
  ["img-src", ["data:"]],
  ["font-src", ["data:"]],
  ["media-src", ["blob:"]],
  ["worker-src", ["blob:"]],
]);

/** Directives that carry no source list; emitting one with sources is invalid. */
const VALUELESS_DIRECTIVES: ReadonlySet<string> = new Set([
  "upgrade-insecure-requests",
  "block-all-mixed-content",
]);

/**
 * `'none'` means "no sources" and is only meaningful alone. Any real source a
 * project adds supersedes it, so a floor of `'none'` never blocks an addition.
 */
function normalizeSources(sources: readonly string[]): string[] {
  const unique = [...new Set(sources)];
  return unique.length > 1 ? unique.filter((source) => source !== "'none'") : unique;
}

/**
 * Merge project sources into the platform floor.
 *
 * Project configuration is additive. `null` drops the baseline class for that
 * directive but never the required class, which is how a project hardens past
 * the floor without being able to break its own site.
 */
function mergeCspDirectives(
  required: Record<string, string[]>,
  projectCsp: SecurityConfig["csp"],
  nonce: string,
): Record<string, string[]> {
  const project = new Map<string, readonly string[] | null>();
  for (const [key, value] of Object.entries(projectCsp ?? {})) {
    if (value === undefined) continue;
    const name = toCspDirectiveName(key);
    const sources = value === null
      ? null
      // `{NONCE}` is the same placeholder VERYFRONT_CSP uses, kept so both
      // surfaces spell a nonce the same way.
      : (Array.isArray(value) ? value : [String(value)])
        .map((source) => source.replace(/\{NONCE\}/g, nonce));
    // `fontSrc` and `font-src` name one directive, so both spellings
    // contribute instead of the later key silently dropping the earlier one.
    // An explicit `null` wins whichever side it is written on, which keeps the
    // result independent of key order.
    const existing = project.get(name);
    if (existing === null) continue;
    project.set(
      name,
      existing === undefined || sources === null ? sources : [...existing, ...sources],
    );
  }

  // Keyed by Map rather than object literal: directive names originate in
  // project config, and a key like `__proto__` or `constructor` must not reach
  // Object.prototype in the builder that produces a security header.
  const requiredByName = new Map(Object.entries(required));

  const names = new Set([
    ...requiredByName.keys(),
    ...BASELINE_DIRECTIVES.keys(),
    ...project.keys(),
  ]);

  const merged: Record<string, string[]> = Object.create(null);
  for (const name of names) {
    const configured = project.get(name);
    const baseline = configured === null ? [] : BASELINE_DIRECTIVES.get(name) ?? [];
    const additions = configured ?? [];
    merged[name] = normalizeSources([
      ...(requiredByName.get(name) ?? []),
      ...baseline,
      ...additions,
    ]);
  }

  return merged;
}

function serializeDirectives(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([name, sources]) => {
      if (VALUELESS_DIRECTIVES.has(name)) return name;
      // An empty source list is not valid syntax; `'none'` is how CSP says it.
      return sources.length > 0 ? `${name} ${sources.join(" ")}` : `${name} 'none'`;
    })
    .join("; ");
}

/**
 * Build the served policy: the platform floor with project sources merged in.
 *
 * The floor is enforced, not opt-in — hosting means a project that never
 * configures anything still gets a baseline. Project configuration can only
 * add to it, or drop the baseline class of a directive with `null`. Producing
 * a policy that omits required sources needs `VERYFRONT_CSP`, an ops-level
 * decision that is deliberately unreachable from project config.
 */
export function buildCSP(
  isDev: boolean,
  nonce: string,
  config?: SecurityConfig | null,
  adapter?: RuntimeAdapter,
  isVeryfrontDomain?: boolean,
): string {
  const envCsp = adapter?.env?.get?.("VERYFRONT_CSP");
  if (envCsp?.trim()) return envCsp.replace(/{NONCE}/g, nonce);

  // Dev serves no policy at all, so HMR and dev tooling are never blocked and a
  // development allowance can never widen the production policy.
  if (isDev) return "";

  return serializeDirectives(
    mergeCspDirectives(requiredDirectives(nonce, isVeryfrontDomain ?? false), config?.csp, nonce),
  );
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

  const csp = buildCSP(isDev, nonce, config, adapter, isVeryfrontDomain);
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
