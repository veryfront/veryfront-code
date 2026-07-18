import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { parseProjectDomain } from "../utils/domain-parser.ts";
import { getEffectiveRequestHost } from "../utils/request-host.ts";

export interface RequestContext {
  token: string;
  slug: string;
  branch: string | null;
  mode: "preview" | "production";
}

export function createRequestContext(req: Request): RequestContext {
  // x-forwarded-host is only trustworthy when the operator has explicitly opted
  // into trusting forwarded headers. A direct-access attacker cannot set this
  // env var, so gating on it prevents Host / preview-mode spoofing via a
  // client-supplied x-forwarded-host (VULN-SRV-1 / VULN-SRV-2). Dispatch-JWS
  // trust requires async verification and is intentionally not consulted on this
  // synchronous path — such requests fall back to the Host header, which the
  // edge proxy also sets.
  const trustProxy = getHostEnv("VERYFRONT_TRUST_FORWARDED_HEADERS") === "1";
  const effectiveHost = getEffectiveRequestHost(req, undefined, trustProxy);
  const parsed = parseProjectDomain(effectiveHost);
  const headerProjectSlug = req.headers.get("x-project-slug")?.trim() || undefined;

  // Mode derives from server-trusted signals only. The `x-environment` header
  // is client-controlled and must NOT be able to flip a production request
  // into preview mode (VULN-SRV-1 / VULN-SRV-2). Preview is determined by the
  // HTTP Host / X-Forwarded-Host — those are terminated at the edge proxy and
  // are the same signal used for routing, so they're the correct source of
  // truth.
  const mode: "preview" | "production" =
    parsed.environment === "preview" || effectiveHost.includes(".preview.")
      ? "preview"
      : "production";

  return {
    // Framework-owned token: bypass project env overlay so proxy mode works
    // when a remote project overlay is active.
    token: req.headers.get("x-token") ?? getHostEnv("VERYFRONT_API_TOKEN") ?? "",
    slug: headerProjectSlug ?? parsed.slug ?? "",
    branch: parsed.branch,
    mode,
  };
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
