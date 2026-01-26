export declare const ENV_VARS: {
    readonly DEBUG: "VERYFRONT_DEBUG";
    readonly DEEP_INSPECT: "VERYFRONT_DEEP_INSPECT";
    readonly CACHE_DIR: "VERYFRONT_CACHE_DIR";
    readonly PORT: "VERYFRONT_PORT";
    readonly VERSION: "VERYFRONT_VERSION";
};
type EnvAccessor = {
    get(key: string): string | undefined;
};
export declare function isTruthyEnvValue(value: string | undefined): boolean;
export declare function isDebugEnabled(env: EnvAccessor): boolean;
export declare function isDeepInspectEnabled(env: EnvAccessor): boolean;
export declare function isAnyDebugEnabled(env: EnvAccessor): boolean;
export {};
//# sourceMappingURL=env.d.ts.map