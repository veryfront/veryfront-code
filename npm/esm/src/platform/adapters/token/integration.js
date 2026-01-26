import * as dntShim from "../../../../_dnt.shims.js";
import { logger } from "../../../utils/index.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
import { createTokenStorageAdapter } from "./factory.js";
let tokenStorageAdapter = null;
export function getTokenStorageAdapter() {
    if (tokenStorageAdapter)
        return Promise.resolve(tokenStorageAdapter);
    return withSpan("platform.token.getTokenStorageAdapter", async () => {
        const adapterConfig = buildAdapterConfigFromEnv();
        tokenStorageAdapter = await createTokenStorageAdapter(adapterConfig);
        return tokenStorageAdapter;
    }, { "token.storage.type": getTokenStorageType() });
}
export function isTokenStorageConfigured() {
    return Boolean(getEnvVar("VERYFRONT_API_TOKEN") && getEnvVar("VERYFRONT_PROJECT_SLUG"));
}
export function getTokenStorageType() {
    return isTokenStorageConfigured() ? "veryfront-api" : "memory";
}
export function resetTokenStorageAdapter() {
    tokenStorageAdapter?.dispose?.();
    tokenStorageAdapter = null;
}
function buildAdapterConfigFromEnv() {
    const apiToken = getEnvVar("VERYFRONT_API_TOKEN");
    const projectSlug = getEnvVar("VERYFRONT_PROJECT_SLUG");
    const baseUrl = getEnvVar("VERYFRONT_API_URL");
    if (!apiToken || !projectSlug) {
        logger.debug("[TokenAdapterIntegration] Using in-memory storage (development)");
        return { type: "memory" };
    }
    logger.debug("[TokenAdapterIntegration] Using Veryfront Cloud storage", { projectSlug });
    return {
        type: "veryfront-api",
        veryfront: {
            apiToken,
            projectSlug,
            baseUrl,
        },
    };
}
function getEnvVar(name) {
    return (dntShim.dntGlobalThis.Deno?.env?.get(name) ??
        (typeof process !== "undefined" ? process.env?.[name] : undefined));
}
