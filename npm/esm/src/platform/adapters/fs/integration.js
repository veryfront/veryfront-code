import { createFSAdapter } from "./factory.js";
import { wrapFSAdapter } from "./wrapper.js";
import { logger } from "../../../utils/index.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
function isLocalFS(config) {
    return !config.fs?.type || config.fs.type === "local";
}
export function enhanceAdapterWithFS(adapter, config, projectDir) {
    if (isLocalFS(config)) {
        logger.debug("[FSIntegration] Using local filesystem (default)");
        return Promise.resolve(adapter);
    }
    const fsType = config.fs.type ?? "unknown";
    return withSpan("platform.fs.enhanceAdapterWithFS", async () => {
        try {
            logger.debug("[FSIntegration] Initializing FSAdapter", {
                type: fsType,
                projectSlug: config.fs?.veryfront?.projectSlug,
            });
            const fsAdapterConfig = {
                ...config.fs,
                projectDir,
            };
            const fsAdapter = await createFSAdapter(fsAdapterConfig);
            const wrappedFS = wrapFSAdapter(fsAdapter);
            const enhancedAdapter = new Proxy(adapter, {
                get(target, prop, receiver) {
                    if (prop === "fs")
                        return wrappedFS;
                    const value = Reflect.get(target, prop, receiver);
                    return typeof value === "function" ? value.bind(target) : value;
                },
            });
            logger.debug("[FSIntegration] FSAdapter initialized successfully", {
                type: fsType,
            });
            return enhancedAdapter;
        }
        catch (error) {
            logger.error("[FSIntegration] Failed to initialize FSAdapter", {
                error: error instanceof Error ? error.message : String(error),
                type: fsType,
            });
            logger.warn("[FSIntegration] Falling back to local filesystem");
            return adapter;
        }
    }, { "fs.adapter.type": fsType });
}
export function createFSAdapterFromConfig(config) {
    if (isLocalFS(config))
        return Promise.resolve(null);
    const fsType = config.fs.type ?? "unknown";
    return withSpan("platform.fs.createFSAdapterFromConfig", () => createFSAdapter(config.fs), { "fs.adapter.type": fsType });
}
export function isFSAdapterConfigured(config) {
    return !!config.fs?.type && config.fs.type !== "local";
}
export function getFSAdapterType(config) {
    return config.fs?.type ?? "local";
}
