import { buildRenderCachePrefix } from "../../cache/keys.js";
export function buildEnrichedContext(options) {
    // Validate contentSourceId is provided (computed by proxy or fallback path)
    // The computeContentSourceId() function already validates releaseId requirements
    if (!options.contentSourceId) {
        throw new Error(`Missing contentSourceId for ${options.projectSlug}`);
    }
    const releaseKey = options.environment === "production"
        ? (options.releaseId ?? "unknown")
        : (options.branch ?? "main");
    return {
        projectId: options.projectId,
        projectSlug: options.projectSlug,
        projectDir: options.projectDir,
        token: options.token,
        environment: options.environment,
        branch: options.branch,
        isLocalDev: options.isLocalDev,
        mode: options.isLocalDev ? "development" : "production",
        contentSourceId: options.contentSourceId,
        releaseId: options.releaseId,
        environmentName: options.environmentName,
        parsedDomain: options.parsedDomain,
        projectData: options.projectData,
        adapter: options.adapter,
        config: options.config,
        cachePrefix: buildRenderCachePrefix(options.projectId, options.environment, releaseKey),
        moduleServerUrl: options.moduleServerUrl,
        nonce: options.nonce,
        debug: options.debug,
        createdAt: Date.now(),
    };
}
export function toRequestContext(enriched) {
    return {
        token: enriched.token,
        slug: enriched.projectSlug,
        branch: enriched.branch,
        mode: enriched.environment,
        isLocalDev: enriched.isLocalDev,
    };
}
export function shouldEnableCacheFromEnriched(enriched) {
    return !enriched.isLocalDev && enriched.environment !== "preview";
}
export function shouldUseNoCacheHeadersFromEnriched(enriched) {
    return enriched.isLocalDev || enriched.environment === "preview";
}
export function shouldUseNoCacheHeadersFromHandler(ctx) {
    if (ctx.enriched)
        return shouldUseNoCacheHeadersFromEnriched(ctx.enriched);
    if (ctx.requestContext?.isLocalDev)
        return true;
    const environment = ctx.resolvedEnvironment ?? ctx.requestContext?.mode;
    return environment === "preview";
}
