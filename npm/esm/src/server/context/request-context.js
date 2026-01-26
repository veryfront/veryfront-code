import { getEnv } from "../../platform/compat/process.js";
import { parseProjectDomain } from "../utils/domain-parser.js";
export function createEnvConfig() {
    const env = getEnv("NODE_ENV") ?? getEnv("DENO_ENV") ?? "development";
    return { isLocalDev: env !== "production" };
}
const DEFAULT_ENV_CONFIG = createEnvConfig();
export function createRequestContext(req, envConfig = DEFAULT_ENV_CONFIG) {
    const { hostname } = new URL(req.url);
    const parsed = parseProjectDomain(hostname);
    // Check both hostname and x-environment header for preview mode
    const xEnvironment = req.headers.get("x-environment");
    const forwardedHost = req.headers.get("x-forwarded-host");
    let mode = "production";
    if (hostname.includes(".preview.") ||
        forwardedHost?.includes(".preview.") ||
        xEnvironment === "preview") {
        mode = "preview";
    }
    return {
        token: req.headers.get("x-token") ?? getEnv("VERYFRONT_API_TOKEN") ?? "",
        slug: req.headers.get("x-project-slug") ?? parsed.slug ?? "",
        branch: parsed.branch,
        mode,
        isLocalDev: envConfig.isLocalDev,
    };
}
export function getCacheStrategy(ctx) {
    if (ctx.isLocalDev)
        return "none";
    if (ctx.mode === "preview")
        return "invalidate";
    return "immutable";
}
export function shouldEnableCache(ctx) {
    return getCacheStrategy(ctx) === "immutable";
}
export function shouldUseNoCacheHeaders(ctx) {
    if (!ctx)
        return true;
    if (ctx.isLocalDev)
        return true;
    return ctx.mode === "preview";
}
