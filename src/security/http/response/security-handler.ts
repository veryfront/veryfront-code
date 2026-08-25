import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { recordSecurityHeaders } from "#veryfront/observability";
import { HOSTED_STUDIO_ORIGINS } from "#veryfront/security/http/studio-origin-policy.ts";
import { isCorsPolicyResponseHeaderName } from "#veryfront/utils/cors-policy-limits.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import {
  CSP_REPORT_ENDPOINT_NAME,
  CSP_REPORT_PATH,
} from "#veryfront/security/http/csp-report-endpoint.ts";
import {
  PLATFORM_FONT_FILE_ORIGINS,
  PLATFORM_FONT_STYLE_ORIGINS,
  PLATFORM_IMAGE_ORIGINS,
  PLATFORM_SCRIPT_ORIGINS,
} from "#veryfront/security/http/platform-asset-origins.ts";
import { toCspDirectiveName } from "#veryfront/security/http/csp-directives.ts";
import type { SecurityConfig } from "./types.ts";

const logger = serverLogger.component("security-headers");
const warnedReservedCorsHeaderConfigs = new WeakSet<object>();
// Same suppression as above: applySecurityHeaders runs per response, so an
// unguarded warning would repeat for every request a misconfigured project
// serves.
const warnedReservedCspHeaderConfigs = new WeakSet<object>();

/**
 * Response headers whose values and omissions are owned by the centralized
 * security policy. Server integrations must remove project-provided values
 * before applying policy so development omissions remain authoritative.
 */
export const SECURITY_POLICY_RESPONSE_HEADER_NAMES = Object.freeze(
  [
    "content-security-policy",
    // Owned for the same reason as the enforced header: the floor may be
    // served report-only (see `cspHeaderName`), and a project-provided value
    // must not survive into a response the platform is deciding the policy for.
    "content-security-policy-report-only",
    "cross-origin-embedder-policy",
    "cross-origin-opener-policy",
    "cross-origin-resource-policy",
    "referrer-policy",
    // Names where violation reports go. A project-provided value would send
    // them somewhere else, or nowhere, and the policy would look healthy.
    "reporting-endpoints",
    "strict-transport-security",
    "x-content-type-options",
    "x-frame-options",
    "x-xss-protection",
  ] as const,
);

/** Response header defining the reporting groups the policy refers to. */
const REPORTING_ENDPOINTS_HEADER = "reporting-endpoints";

/** The two names the computed policy may be delivered under. */
const CSP_RESPONSE_HEADER_NAMES: ReadonlySet<string> = new Set([
  "content-security-policy",
  "content-security-policy-report-only",
]);

function isCspResponseHeaderName(name: string): boolean {
  return CSP_RESPONSE_HEADER_NAMES.has(name.toLowerCase());
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
 * clickjacking). Local development hosts (`*.localhost`) are omitted because
 * dev mode skips the default CSP entirely.
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
 * guess at what a project needs. Project-specific origins (analytics, embeds)
 * belong in `security.csp`, which is merged on top. Google Fonts is in the
 * baseline rather than here because the platform does emit it -- but only via
 * `veryfront/fonts`, so a project that never calls it may drop it.
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
    // Both spellings: `report-to` is the current one, `report-uri` is
    // deprecated but still the only one several shipping browsers honour.
    "report-to": [CSP_REPORT_ENDPOINT_NAME],
    "report-uri": [CSP_REPORT_PATH],
  };
}

/**
 * Convenience sources a project may drop with `null` when it knows it does not
 * need them. Nothing here is structural, so removing any of it can only affect
 * the project's own content — never the platform's.
 */
const BASELINE_DIRECTIVES: ReadonlyMap<string, readonly string[]> = new Map([
  ["style-src", ["'unsafe-inline'", ...PLATFORM_FONT_STYLE_ORIGINS]],
  ["style-src-attr", ["'unsafe-inline'"]],
  ["img-src", ["data:"]],
  ["font-src", ["data:", ...PLATFORM_FONT_FILE_ORIGINS]],
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
  derived?: SecurityConfig["derivedCsp"],
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
    ...Object.keys(derived ?? {}),
    ...project.keys(),
  ]);

  const merged: Record<string, string[]> = Object.create(null);
  for (const name of names) {
    const configured = project.get(name);
    const baseline = configured === null ? [] : BASELINE_DIRECTIVES.get(name) ?? [];
    // Derived origins sit above the floor and below project config, and follow
    // the baseline's `null` semantics: a project that explicitly drops a
    // directive means it, and static analysis must not put back what the
    // project just said it does not want.
    const derivedForName = configured === null ? [] : derived?.[name as never] ?? [];
    const additions = configured ?? [];
    merged[name] = normalizeSources([
      ...(requiredByName.get(name) ?? []),
      ...baseline,
      ...derivedForName,
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
    mergeCspDirectives(
      requiredDirectives(nonce, isVeryfrontDomain ?? false),
      config?.csp,
      nonce,
      config?.derivedCsp,
    ),
  );
}

/**
 * Whether the whole policy is enforced.
 *
 * Only `VERYFRONT_CSP`, a full policy override, binds everything: setting it is
 * an explicit ops act. Otherwise enforcement is per directive -- see
 * {@link buildEnforcedCSP}.
 */
function isCspEnforced(hasEnvOverride: boolean): boolean {
  return hasEnvOverride;
}

/**
 * Directives enforced for every project, whatever it configured.
 *
 * A report-only policy protects nothing, so the two directives safe to bind
 * unconditionally are bound unconditionally. Both close real injection vectors
 * and neither has a use a project would notice losing: `object-src 'none'`
 * blocks `<object>`/`<embed>` payloads, and `base-uri 'self'` blocks a `<base>`
 * tag rewriting every relative URL on the page.
 *
 * Deliberately excluded, because each breaks working sites: `form-action`
 * (projects post forms to HubSpot and the like), `frame-ancestors` (projects
 * are legitimately embedded), and `script-src` with the asset directives, which
 * are the reason the floor reports rather than binds.
 */
const ALWAYS_ENFORCED_DIRECTIVES: ReadonlySet<string> = new Set([
  "object-src",
  "base-uri",
]);

/**
 * Directives that inherit from another when absent.
 *
 * CSP resolves a missing directive by walking a fallback chain, so a policy
 * containing `script-src` but not `worker-src` does not leave workers
 * unconstrained -- it constrains them *by* `script-src`. Emitting a subset of
 * directives is therefore not the same as emitting those directives alone, and
 * a companion policy that omitted the descendants would silently tighten them:
 * a project declaring only `scriptSrc` would find its `blob:` workers blocked
 * by an enforced `script-src` that never mentioned them, while the reported
 * `worker-src` said they were fine.
 *
 * Keyed by the directive that would absorb the others.
 */
const CSP_FALLBACK_DEPENDENTS: ReadonlyMap<string, readonly string[]> = new Map([
  ["script-src", ["script-src-elem", "script-src-attr", "child-src", "worker-src", "frame-src"]],
  ["child-src", ["worker-src", "frame-src"]],
  ["style-src", ["style-src-elem", "style-src-attr"]],
  ["default-src", [
    "script-src",
    "script-src-elem",
    "script-src-attr",
    "style-src",
    "style-src-elem",
    "style-src-attr",
    "img-src",
    "font-src",
    "connect-src",
    "media-src",
    "object-src",
    "manifest-src",
    "child-src",
    "worker-src",
    "frame-src",
  ]],
]);

/** Every directive that must travel with `names` so none is tightened by fallback. */
function withFallbackDependents(names: Iterable<string>): Set<string> {
  const closed = new Set(names);
  // Fixed point: `default-src` pulls in `script-src`, which pulls in its own.
  for (let changed = true; changed;) {
    changed = false;
    for (const name of [...closed]) {
      for (const dependent of CSP_FALLBACK_DEPENDENTS.get(name) ?? []) {
        if (!closed.has(dependent)) {
          closed.add(dependent);
          changed = true;
        }
      }
    }
  }
  return closed;
}

/**
 * The enforced companion to the reported floor.
 *
 * Carries the always-enforced directives plus every directive the project
 * declared, and then whatever those would otherwise absorb through CSP's
 * fallback chain. Declaring a directive is taken as meaning it -- a project
 * that lists its image origins wants `img-src` to hold -- while directives it
 * never mentioned keep reporting rather than binding. That is the difference
 * between honouring a project's configuration and inferring, from one image
 * origin, that it also wants `script-src` bound across the site.
 *
 * Values come from the same merged policy the reported header carries, so a
 * directive pulled in by fallback is enforced exactly as it was reported.
 *
 * @returns the enforced policy, or "" when the full policy already binds
 */
export function buildEnforcedCSP(
  isDev: boolean,
  nonce: string,
  config?: SecurityConfig | null,
  isVeryfrontDomain?: boolean,
  hasEnvOverride = false,
): string {
  if (isDev || isCspEnforced(hasEnvOverride)) return "";

  // `undefined` means absent, exactly as the merge treats it. Without this a
  // project writing `scriptSrc: undefined` would enforce the merged
  // `script-src` it never configured.
  const declared = Object.entries(config?.csp ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key]) => toCspDirectiveName(key));

  const binding = withFallbackDependents([...ALWAYS_ENFORCED_DIRECTIVES, ...declared]);

  const full = mergeCspDirectives(
    requiredDirectives(nonce, isVeryfrontDomain ?? false),
    config?.csp,
    nonce,
    config?.derivedCsp,
  );

  const enforced = Object.fromEntries(
    Object.entries(full).filter(([name]) => binding.has(name)),
  );

  return Object.keys(enforced).length > 0 ? serializeDirectives(enforced) : "";
}

/** Header name carrying the policy, per {@link isCspEnforced}. */
function cspHeaderName(
  hasEnvOverride = false,
): "Content-Security-Policy" | "Content-Security-Policy-Report-Only" {
  return isCspEnforced(hasEnvOverride)
    ? "Content-Security-Policy"
    : "Content-Security-Policy-Report-Only";
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
  if (csp) {
    const hasEnvOverride = Boolean(adapter?.env?.get?.("VERYFRONT_CSP")?.trim());
    const headerName = cspHeaderName(hasEnvOverride);
    headers.set(headerName, csp);

    // A report-only floor protects nothing on its own, so the directives that
    // are safe to bind for everyone are served enforced beside it.
    if (headerName === "Content-Security-Policy-Report-Only") {
      const enforced = buildEnforcedCSP(isDev, nonce, config, isVeryfrontDomain, hasEnvOverride);
      if (enforced) headers.set("Content-Security-Policy", enforced);
    }
    // Names the group the policy's `report-to` refers to. Without this header
    // the directive names nothing and the browser sends no reports at all.
    headers.set(
      REPORTING_ENDPOINTS_HEADER,
      `${CSP_REPORT_ENDPOINT_NAME}="${CSP_REPORT_PATH}"`,
    );
  }

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
    let ignoredCspHeader = false;
    for (const [key, value] of Object.entries(extraHeaders)) {
      if (value === undefined) continue;
      if (isCorsPolicyResponseHeaderName(key)) {
        ignoredCorsPolicyHeader = true;
        continue;
      }
      // The policy is computed above and is not a project-settable header.
      // Every other name here has a deliberate override path through
      // `getHeaderOverride`; CSP has none, so a value arriving via
      // `security.headers` would silently replace the merged platform floor --
      // and, now that the floor may be delivered report-only, could also flip
      // which mode is served. Header names are case-insensitive, so match that
      // way.
      const headerName = key.toLowerCase();
      if (isCspResponseHeaderName(headerName) || headerName === REPORTING_ENDPOINTS_HEADER) {
        ignoredCspHeader = true;
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
    if (
      ignoredCspHeader &&
      !warnedReservedCspHeaderConfigs.has(extraHeaders)
    ) {
      warnedReservedCspHeaderConfigs.add(extraHeaders);
      logger.warn(
        "Ignored Content-Security-Policy entries in security.headers; configure security.csp instead",
      );
    }
  }

  recordSecurityHeaders();
}
