import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { parseProjectDomain } from "../utils/domain-parser.ts";

export interface RequestContext {
  token: string;
  slug: string;
  branch: string | null;
  mode: "preview" | "production";
}

export function createRequestContext(req: Request): RequestContext {
  const { hostname } = new URL(req.url);
  const forwardedHost = req.headers.get("x-forwarded-host");
  const hostHeader = req.headers.get("host");

  // In proxy mode, req.url hostname may be 127.0.0.1 while the real domain
  // is in the Host header (e.g., "flow-ops.lvh.me:3010"). Prefer Host header.
  const effectiveHost = forwardedHost ?? hostHeader ?? hostname;
  const parsed = parseProjectDomain(effectiveHost);

  const xEnvironment = req.headers.get("x-environment");

  const mode: "preview" | "production" = parsed.environment === "preview" ||
      effectiveHost.includes(".preview.") ||
      xEnvironment === "preview"
    ? "preview"
    : "production";

  return {
    // Framework-owned token: bypass project env overlay so proxy mode works
    // when a remote project overlay is active.
    token: req.headers.get("x-token") ?? getHostEnv("VERYFRONT_API_TOKEN") ?? "",
    slug: req.headers.get("x-project-slug") ?? parsed.slug ?? "",
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
