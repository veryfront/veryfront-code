/****
 * Centralized environment accessors.
 *
 * Runtime code should depend on these helpers rather than calling getEnv directly.
 * All functions accept an optional RuntimeEnv parameter for test isolation.
 *
 * @module
 */
import { type RuntimeEnv } from "./runtime-env.js";
export declare function getDisableLruIntervalEnv(env?: RuntimeEnv): boolean;
export declare function getApiBaseUrlEnv(env?: RuntimeEnv): string;
export declare function getSsrMaxConcurrentTransformsEnv(defaultValue?: number, env?: RuntimeEnv): number;
export declare function getRedisUrlEnv(env?: RuntimeEnv): string | undefined;
export declare function getV8FlagsEnv(env?: RuntimeEnv): string;
export declare function getCacheDirEnv(env?: RuntimeEnv): string | undefined;
export declare function isPerfEnabledEnv(env?: RuntimeEnv): boolean;
export declare function getGithubEnvConfig(env?: RuntimeEnv): {
    token?: string;
    owner?: string;
    repo?: string;
    ref?: string;
};
export declare function getApiTokenEnv(env?: RuntimeEnv): string | undefined;
export declare function getOpenAIEnvConfig(env?: RuntimeEnv): {
    apiKey?: string;
    baseURL?: string;
    organizationId?: string;
};
export declare function getAnthropicEnvConfig(env?: RuntimeEnv): {
    apiKey?: string;
    baseURL?: string;
};
export declare function getGoogleGenAIEnvConfig(env?: RuntimeEnv): {
    apiKey?: string;
};
export declare function isDebugEnvEnabled(env?: RuntimeEnv): boolean;
export declare function isCiEnv(env?: RuntimeEnv): boolean;
export declare function isDenoTestingEnv(env?: RuntimeEnv): boolean;
export declare function getNoColorEnv(env?: RuntimeEnv): string | undefined;
export declare function getForceColorEnv(env?: RuntimeEnv): string | undefined;
export declare function isRscExperimentalEnabled(env?: RuntimeEnv): boolean;
export declare function getVeryfrontVersion(env?: RuntimeEnv): string | undefined;
export declare function getEnvironmentFromEnv(env?: RuntimeEnv): string | undefined;
export declare function getOtelTracingConfig(env?: RuntimeEnv): {
    enabledFlag?: string;
    veryfrontFlag?: string;
    serviceName?: string;
    endpoint?: string;
    tracesEndpoint?: string;
    exporter?: string;
    headers?: string;
    tracesHeaders?: string;
};
export declare function getOtelMetricsConfig(env?: RuntimeEnv): {
    enabledFlag?: string;
    veryfrontFlag?: string;
    endpoint?: string;
    metricsEndpoint?: string;
    exporter?: string;
};
//# sourceMappingURL=env.d.ts.map