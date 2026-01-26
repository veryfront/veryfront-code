import { createError, toError } from "../../../../errors/index.js";
function resolveContentSource(veryfront) {
    return veryfront.contentSource ?? { type: "branch", branch: "main" };
}
export function createVeryfrontConfig(config) {
    const veryfront = config.veryfront;
    if (!veryfront) {
        throw toError(createError({
            type: "config",
            message: "Veryfront adapter requires veryfront configuration",
        }));
    }
    return {
        apiBaseUrl: veryfront.baseUrl ?? "",
        apiToken: veryfront.apiToken ?? veryfront.apiKey ?? "",
        projectSlug: veryfront.projectSlug ?? "",
        projectId: veryfront.projectId,
        proxyMode: veryfront.proxyMode,
        contentSource: resolveContentSource(veryfront),
        cache: {
            enabled: true,
            ttl: 60_000,
            maxSize: 1000,
            maxMemory: 100 * 1024 * 1024,
            ...veryfront.cache,
        },
        retry: {
            maxRetries: 3,
            initialDelay: 1000,
            maxDelay: 10000,
            ...veryfront.retry,
        },
    };
}
