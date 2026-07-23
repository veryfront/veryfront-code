import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { parseProjectDomain } from "../utils/domain-parser.ts";
import { getEffectiveRequestHost } from "../utils/request-host.ts";

export interface RequestContext {
  token: string;
  /** Where the credential originated. Host credentials are never request-project capabilities. */
  tokenSource?: RequestTokenSource;
  /** Whether the current request has proved that the credential is bound to its resolved project. */
  tokenProvenance?: RequestTokenProvenance;
  slug: string;
  branch: string | null;
  mode: "preview" | "production";
}

export type RequestTokenSource = "request-header" | "host-env" | "none";
export type RequestTokenProvenance = "project-bound" | "untrusted";

export interface CreateRequestContextOptions {
  /** Whether the request has already passed the proxy trust check. */
  proxyTrusted?: boolean;
}

export function createRequestContext(
  req: Request,
  options: CreateRequestContextOptions = {},
): RequestContext {
  // x-forwarded-host is only trustworthy when the operator has explicitly opted
  // into trusting forwarded headers. A direct-access attacker cannot set this
  // env var, so gating on it prevents Host / preview-mode spoofing via a
  // client-supplied x-forwarded-host (VULN-SRV-1 / VULN-SRV-2). Dispatch-JWS
  // trust requires async verification, so the runtime handler passes that
  // request-scoped result through options. Direct callers fail closed unless
  // the operator explicitly trusts forwarded headers.
  const trustProxy = options.proxyTrusted ??
    getHostEnv("VERYFRONT_TRUST_FORWARDED_HEADERS") === "1";
  const effectiveHost = getEffectiveRequestHost(req, undefined, trustProxy);
  const parsed = parseProjectDomain(effectiveHost);
  const headerProjectSlug = req.headers.get("x-project-slug")?.trim() || undefined;
  const requestToken = req.headers.get("x-token");
  const hostToken = getHostEnv("VERYFRONT_API_TOKEN");
  const token = requestToken ?? hostToken ?? "";
  const tokenSource: RequestTokenSource = requestToken !== null
    ? "request-header"
    : hostToken
    ? "host-env"
    : "none";

  // Mode derives from server-trusted signals only. The `x-environment` header
  // is client-controlled and must NOT be able to flip a production request
  // into preview mode (VULN-SRV-1 / VULN-SRV-2). Preview is determined by the
  // HTTP Host / X-Forwarded-Host. Those are terminated at the edge proxy and
  // are the same signal used for routing, so they're the correct source of
  // truth.
  const mode: "preview" | "production" =
    parsed.environment === "preview" || effectiveHost.includes(".preview.")
      ? "preview"
      : "production";

  return {
    // Framework-owned token: bypass project env overlay so proxy mode works
    // when a remote project overlay is active.
    token,
    tokenSource,
    // Project resolution happens after this function. A credential cannot be
    // treated as project-bound until that result and proxy trust are both known.
    tokenProvenance: "untrusted",
    slug: headerProjectSlug ?? parsed.slug ?? "",
    branch: parsed.branch,
    mode,
  };
}

/**
 * Promote a request-header credential only after the trusted proxy routing
 * decision has resolved a concrete project. Host-level credentials deliberately
 * remain untrusted: they are process capabilities, not proof that a request is
 * authorized to populate project-scoped distributed caches.
 */
export function bindRequestTokenToProject(
  ctx: RequestContext,
  options: { proxyTrusted: boolean; projectSlug?: string },
): RequestContext {
  const projectBound = options.proxyTrusted &&
    ctx.tokenSource === "request-header" &&
    ctx.token.length > 0 &&
    Boolean(options.projectSlug?.trim());

  return {
    ...ctx,
    tokenProvenance: projectBound ? "project-bound" : "untrusted",
  };
}

/** Fail closed when a caller substitutes a token after request verification. */
export function getRequestTokenProvenance(
  ctx: RequestContext | undefined,
  token: string,
): RequestTokenProvenance {
  return token.length > 0 && ctx?.token === token && ctx.tokenProvenance === "project-bound"
    ? "project-bound"
    : "untrusted";
}

export function getCacheStrategy(
  ctx: RequestContext,
  isLocalProject?: boolean,
): "none" | "invalidate" | "immutable" {
  if (isLocalProject) return "none";
  if (ctx.mode === "preview") return "invalidate";
  return "immutable";
}

export function shouldEnableCache(ctx: RequestContext, isLocalProject?: boolean): boolean {
  return getCacheStrategy(ctx, isLocalProject) === "immutable";
}

export function shouldUseNoCacheHeaders(ctx?: RequestContext, isLocalProject?: boolean): boolean {
  if (!ctx || isLocalProject) return true;
  return ctx.mode === "preview";
}
