import { getEnv } from "#veryfront/platform/compat/process.ts";
import { parseProjectDomain } from "../utils/domain-parser.ts";

export interface RequestContext {
  token: string;
  slug: string;
  branch: string | null;
  mode: "preview" | "production";
}

export function createRequestContext(req: Request): RequestContext {
  const { hostname } = new URL(req.url);
  const parsed = parseProjectDomain(hostname);

  const xEnvironment = req.headers.get("x-environment");
  const forwardedHost = req.headers.get("x-forwarded-host");

  const mode: "preview" | "production" = hostname.includes(".preview.") ||
      forwardedHost?.includes(".preview.") ||
      xEnvironment === "preview"
    ? "preview"
    : "production";

  return {
    token: req.headers.get("x-token") ?? getEnv("VERYFRONT_API_TOKEN") ?? "",
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
