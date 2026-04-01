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
  const effectiveHost = getEffectiveRequestHost(req);
  const parsed = parseProjectDomain(effectiveHost);
  const headerProjectSlug = req.headers.get("x-project-slug")?.trim() || undefined;

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
