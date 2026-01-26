/****
 * Runtime Configuration
 *
 * Combines file-based config (veryfront.config.ts) with runtime environment.
 * This is the primary config type that should be used throughout the application.
 *
 * @module
 */
import { createTestRuntimeEnv, getRuntimeEnv } from "./runtime-env.js";
/**
 * Default configuration values.
 * Used when no config file is found.
 */
export const DEFAULT_CONFIG = {
    title: "Veryfront App",
    description: "Built with Veryfront",
    experimental: {
        esmLayouts: true,
    },
    router: undefined,
    theme: {
        colors: {
            primary: "#3B82F6",
        },
    },
    build: {
        outDir: "dist",
        trailingSlash: false,
    },
    cache: {
        dir: ".veryfront",
        render: {
            type: "memory",
            maxEntries: 500,
        },
    },
    dev: {
        port: 3001,
        host: "localhost",
        open: false,
    },
};
function createRuntimeInfo(env) {
    return {
        env,
        isProduction: env.nodeEnv === "production",
        isDevelopment: env.nodeEnv === "development",
        isTest: env.nodeEnv === "test" || env.denoTesting,
        isCI: env.ci,
        isDebug: env.debug,
    };
}
function mergeConfigWithEnv(fileConfig, env) {
    return {
        ...fileConfig,
        projectSlug: env.projectSlug || fileConfig.projectSlug,
        experimental: {
            ...fileConfig.experimental,
            rsc: fileConfig.experimental?.rsc ?? env.experimentalRsc,
        },
        cache: {
            ...fileConfig.cache,
            dir: env.cacheDir || fileConfig.cache?.dir,
            render: {
                ...fileConfig.cache?.render,
                redisUrl: env.redisUrl || fileConfig.cache?.render?.redisUrl,
            },
        },
        dev: {
            ...fileConfig.dev,
            port: env.port || fileConfig.dev?.port,
        },
        observability: {
            tracing: {
                enabled: env.otelEnabled || fileConfig.observability?.tracing?.enabled,
                endpoint: env.otelEndpoint || fileConfig.observability?.tracing?.endpoint,
                serviceName: env.otelServiceName || fileConfig.observability?.tracing?.serviceName,
                ...fileConfig.observability?.tracing,
            },
            metrics: {
                enabled: env.otelMetricsEnabled || fileConfig.observability?.metrics?.enabled,
                endpoint: env.otelMetricsEndpoint || fileConfig.observability?.metrics?.endpoint,
                ...fileConfig.observability?.metrics,
            },
        },
    };
}
export function createRuntimeConfig(fileConfig = {}, env = getRuntimeEnv()) {
    const mergedConfig = mergeConfigWithEnv({ ...DEFAULT_CONFIG, ...fileConfig }, env);
    return {
        ...mergedConfig,
        runtime: createRuntimeInfo(env),
    };
}
// ============================================================================
// Global Config Singleton
// ============================================================================
let runtimeConfig = null;
export function initRuntimeConfig(fileConfig = {}) {
    if (runtimeConfig)
        return runtimeConfig;
    runtimeConfig = createRuntimeConfig(fileConfig);
    return runtimeConfig;
}
export function getRuntimeConfig() {
    return runtimeConfig ?? initRuntimeConfig();
}
export function isRuntimeConfigInitialized() {
    return runtimeConfig !== null;
}
export function updateRuntimeConfig(fileConfig) {
    runtimeConfig = createRuntimeConfig(fileConfig);
    return runtimeConfig;
}
// ============================================================================
// Test Utilities
// ============================================================================
export function createTestConfig(overrides = {}) {
    const { runtime: runtimeOverrides, ...configOverrides } = overrides;
    const testEnv = createTestRuntimeEnv(runtimeOverrides?.env);
    const fileConfig = { ...DEFAULT_CONFIG, ...configOverrides };
    return createRuntimeConfig(fileConfig, testEnv);
}
export function _setRuntimeConfigForTesting(config) {
    if ("runtime" in config && config.runtime) {
        runtimeConfig = config;
        return;
    }
    runtimeConfig = createTestConfig(config);
}
export function _resetRuntimeConfig() {
    runtimeConfig = null;
}
