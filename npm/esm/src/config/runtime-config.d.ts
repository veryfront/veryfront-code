/****
 * Runtime Configuration
 *
 * Combines file-based config (veryfront.config.ts) with runtime environment.
 * This is the primary config type that should be used throughout the application.
 *
 * @module
 */
import type { VeryfrontConfig } from "./types.js";
import type { RuntimeEnv } from "./runtime-env.js";
/**
 * Runtime-specific configuration derived from environment.
 */
export interface RuntimeInfo {
    /** The runtime environment snapshot */
    env: RuntimeEnv;
    /** True if NODE_ENV is "production" */
    isProduction: boolean;
    /** True if NODE_ENV is "development" */
    isDevelopment: boolean;
    /** True if NODE_ENV is "test" or DENO_TESTING=1 */
    isTest: boolean;
    /** True if running in CI environment */
    isCI: boolean;
    /** True if debug mode is enabled */
    isDebug: boolean;
}
/**
 * Full runtime configuration.
 * Combines user config file with runtime environment.
 */
export interface RuntimeConfig extends VeryfrontConfig {
    /**
     * Runtime-specific values computed from environment.
     * Use this for environment-dependent behavior.
     */
    runtime: RuntimeInfo;
}
/**
 * Default configuration values.
 * Used when no config file is found.
 */
export declare const DEFAULT_CONFIG: Partial<VeryfrontConfig>;
export declare function createRuntimeConfig(fileConfig?: VeryfrontConfig, env?: RuntimeEnv): RuntimeConfig;
export declare function initRuntimeConfig(fileConfig?: VeryfrontConfig): RuntimeConfig;
export declare function getRuntimeConfig(): RuntimeConfig;
export declare function isRuntimeConfigInitialized(): boolean;
export declare function updateRuntimeConfig(fileConfig: VeryfrontConfig): RuntimeConfig;
export declare function createTestConfig(overrides?: Partial<VeryfrontConfig> & {
    runtime?: {
        env?: Partial<RuntimeEnv>;
    };
}): RuntimeConfig;
export declare function _setRuntimeConfigForTesting(config: Partial<RuntimeConfig> | RuntimeConfig): void;
export declare function _resetRuntimeConfig(): void;
//# sourceMappingURL=runtime-config.d.ts.map