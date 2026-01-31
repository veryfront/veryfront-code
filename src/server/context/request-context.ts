import { getEnv } from "#veryfront/platform/compat/process.ts";
import { parseProjectDomain } from "../utils/domain-parser.ts";

export interface EnvConfig {
  isLocalDev: boolean;
}

export function createEnvConfig(): EnvConfig {
  const env = getEnv("NODE_ENV") ?? getEnv("DENO_ENV") ?? "development";
  return { isLocalDev: env !== "production" };
}

export interface RequestContext {
  token: string;
  slug: string;
  branch: string | null;
  mode: "preview" | "production";
  isLocalDev: boolean;
}

const DEFAULT_ENV_CONFIG = createEnvConfig();

export function createRequestContext(
  req: Request,
  envConfig: EnvConfig = DEFAULT_ENV_CONFIG,
): RequestContext {
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
    isLocalDev: envConfig.isLocalDev,
  };
}

export function getCacheStrategy(
  ctx: RequestContext,
): "none" | "invalidate" | "immutable" {
  if (ctx.isLocalDev) return "none";
  if (ctx.mode === "preview") return "invalidate";
  return "immutable";
}

export function shouldEnableCache(ctx: RequestContext): boolean {
  return getCacheStrategy(ctx) === "immutable";
}

export function shouldUseNoCacheHeaders(ctx?: RequestContext): boolean {
  if (!ctx || ctx.isLocalDev) return true;
  return ctx.mode === "preview";
}
