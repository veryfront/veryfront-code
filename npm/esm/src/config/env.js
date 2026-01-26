/****
 * Centralized environment accessors.
 *
 * Runtime code should depend on these helpers rather than calling getEnv directly.
 * All functions accept an optional RuntimeEnv parameter for test isolation.
 *
 * @module
 */
import { getRuntimeEnv } from "./runtime-env.js";
export function getDisableLruIntervalEnv(env = getRuntimeEnv()) {
    return env.disableLruInterval;
}
export function getApiBaseUrlEnv(env = getRuntimeEnv()) {
    return env.apiBaseUrl;
}
export function getSsrMaxConcurrentTransformsEnv(defaultValue = 3, env = getRuntimeEnv()) {
    return env.ssrMaxConcurrentTransforms || defaultValue;
}
export function getRedisUrlEnv(env = getRuntimeEnv()) {
    return env.redisUrl;
}
export function getV8FlagsEnv(env = getRuntimeEnv()) {
    return env.denoV8Flags;
}
export function getCacheDirEnv(env = getRuntimeEnv()) {
    return env.cacheDir;
}
export function isPerfEnabledEnv(env = getRuntimeEnv()) {
    return env.perfEnabled;
}
export function getGithubEnvConfig(env = getRuntimeEnv()) {
    return {
        token: env.githubToken,
        owner: env.githubOwner,
        repo: env.githubRepo,
        ref: env.githubRef,
    };
}
export function getApiTokenEnv(env = getRuntimeEnv()) {
    return env.apiToken;
}
export function getOpenAIEnvConfig(env = getRuntimeEnv()) {
    return {
        apiKey: env.openaiApiKey,
        baseURL: env.openaiBaseUrl,
        organizationId: undefined, // Not in RuntimeEnv, kept for interface compatibility
    };
}
export function getAnthropicEnvConfig(env = getRuntimeEnv()) {
    return {
        apiKey: env.anthropicApiKey,
        baseURL: env.anthropicBaseUrl,
    };
}
export function getGoogleGenAIEnvConfig(env = getRuntimeEnv()) {
    return { apiKey: env.googleApiKey };
}
export function isDebugEnvEnabled(env = getRuntimeEnv()) {
    return env.debug;
}
export function isCiEnv(env = getRuntimeEnv()) {
    return env.ci;
}
export function isDenoTestingEnv(env = getRuntimeEnv()) {
    return env.denoTesting;
}
export function getNoColorEnv(env = getRuntimeEnv()) {
    return env.noColor ? "1" : undefined;
}
export function getForceColorEnv(env = getRuntimeEnv()) {
    return env.forceColor ? "1" : undefined;
}
export function isRscExperimentalEnabled(env = getRuntimeEnv()) {
    return env.experimentalRsc;
}
export function getVeryfrontVersion(env = getRuntimeEnv()) {
    return env.veryfrontVersion;
}
export function getEnvironmentFromEnv(env = getRuntimeEnv()) {
    return env.veryfrontEnv || env.nodeEnv;
}
export function getOtelTracingConfig(env = getRuntimeEnv()) {
    const enabledFlag = env.otelEnabled ? "true" : undefined;
    const veryfrontFlag = env.otelEnabled ? "1" : undefined;
    return {
        enabledFlag,
        veryfrontFlag,
        serviceName: env.otelServiceName,
        endpoint: env.otelEndpoint,
        tracesEndpoint: env.otelTracesEndpoint,
        exporter: env.otelTracesExporter,
        headers: env.otelHeaders,
        tracesHeaders: undefined,
    };
}
export function getOtelMetricsConfig(env = getRuntimeEnv()) {
    return {
        enabledFlag: env.otelMetricsEnabled ? "1" : undefined,
        veryfrontFlag: env.otelEnabled ? "1" : undefined,
        endpoint: env.otelEndpoint,
        metricsEndpoint: env.otelMetricsEndpoint,
        exporter: env.otelMetricsExporter,
    };
}
